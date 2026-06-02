import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Check, Info, Scan, X } from 'lucide-react';
import { Button } from './ui/button';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RoomLighting, RoomModel } from '../core/models/types';
import { MiniMap } from './MiniMap';

export interface ScannedPlane {
  id: number;
  orientation: string;
  semanticLabel?: string;
  polygon: {x: number, y: number, z: number}[];
  position: {x: number, y: number, z: number};
  quaternion: {x: number, y: number, z: number, w: number};
  color: number;
  lastSeen: number;
}

const SESSION_START_TIMEOUT_MS = 8000;

type XRSessionLike = {
  end: () => Promise<void>;
};

type XRSystemLike = {
  requestSession?: (mode: 'immersive-ar', options: Record<string, unknown>) => Promise<XRSessionLike>;
};

const getXRSystem = () => (navigator as Navigator & { xr?: XRSystemLike }).xr;

const clearSessionStartTimer = (timerRef: React.MutableRefObject<number | null>) => {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

const getSessionErrorMessage = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera/AR permission was denied. Please allow camera access and try again.';
  }

  if (name === 'NotSupportedError') {
    return 'This browser or device does not support the WebXR plane detection needed for scanning.';
  }

  return 'Could not start AR. Please try again on a secure HTTPS page with a WebXR-compatible browser.';
};

const getDetectedPlaneSet = (detectedPlanes: unknown): Set<any> | null => {
  if (!detectedPlanes) return null;
  if (detectedPlanes instanceof Set) return detectedPlanes;

  try {
    return new Set(Array.from(detectedPlanes as Iterable<any>));
  } catch (error) {
    console.warn('Ignoring unsupported detectedPlanes payload', error);
    return null;
  }
};

const disposePlaneMesh = (mesh: THREE.Mesh) => {
  mesh.geometry?.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else {
    material?.dispose();
  }
};

export function ARScanner({ onComplete, onCancel }: { onComplete: (planes: ScannedPlane[]) => void, onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePlanesCount, setActivePlanesCount] = useState(0);
  const planesDataRef = useRef<Map<any, ScannedPlane>>(new Map());
  const startRequestedRef = useRef(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sessionRef = useRef<XRSessionLike | null>(null);
  const sessionStartTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [sessionStartError, setSessionStartError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.xr.enabled = true;
    // renderer.xr.setFramebufferScaleFactor(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const onSessionStart = () => {
      clearSessionStartTimer(sessionStartTimerRef);
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(null);
    };
    const onSessionEnd = () => {
      sessionRef.current = null;
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
    };
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    const planesMap = new Map<any, THREE.Mesh>();
    let currentSession: XRSessionLike | null = null;
    let planeIdCounter = 0;
    let planeSupportChecked = false;
    let lastScanTime = Date.now();
    let lastPlaneCount = 0;
    let slowProgressCount = 0;
    let xrLightProbe: any = null;
    let lightProbeRequested = false;
    
    // Store latest room lighting
    const currentLighting = {
        ambientColor: 0xffffff,
        ambientIntensity: 0.5,
        primaryLightDirection: [0, -1, 0] as [number, number, number],
        primaryLightColor: 0xffffff,
        primaryLightIntensity: 0.0
    };

    onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    const planeGeometryVersion = new Map<any, number>();
    const render = (timestamp: number, frame: any) => {
      if (frame) {
        currentSession = renderer.xr.getSession() as XRSessionLike | null;
        sessionRef.current = currentSession;
        const referenceSpace = renderer.xr.getReferenceSpace();
        if (!referenceSpace) {
          renderer.render(scene, camera);
          return;
        }

        const detectedPlanes = getDetectedPlaneSet(frame.detectedPlanes);
        if (detectedPlanes) {
          detectedPlanes.forEach((plane: any) => {
            const pose = frame.getPose(plane.planeSpace, referenceSpace);
            if (!pose) return;

            const isHoriz = plane.orientation?.toLowerCase() === 'horizontal';
            const isVert = plane.orientation?.toLowerCase() === 'vertical';

            const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.transform.orientation);
            let isValidAngle = true;
            if (isHoriz && Math.abs(normal.y) < 0.85) isValidAngle = false;
            if (isVert && Math.abs(normal.y) > 0.15) isValidAngle = false;

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            let worldMinY = Infinity, worldMaxY = -Infinity;
            for (let i = 0; i < plane.polygon.length; i++) {
              const p = plane.polygon[i];
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);

              const wp = new THREE.Vector3(p.x, p.y, p.z)
                            .applyQuaternion(pose.transform.orientation)
                            .add(new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z));
              worldMinY = Math.min(worldMinY, wp.y);
              worldMaxY = Math.max(worldMaxY, wp.y);
            }
            const areaApprox = (maxX - minX) * (maxZ - minZ);
            
            // Improved detection heuristics based on physical dimensions
            const heightApprox = worldMaxY - worldMinY;
            const widthApprox = areaApprox / Math.max(0.001, heightApprox);

            let semanticClass = plane.semanticLabel?.toLowerCase();
            
            // If missing or just "wall", analyze shape to refine detection
            if (!semanticClass || semanticClass === 'unknown' || semanticClass === 'wall') {
              if (isHoriz) {
                if (pose.transform.position.y < 0.3) semanticClass = 'floor';
                else if (pose.transform.position.y > 1.8) semanticClass = 'ceiling';
                else if (pose.transform.position.y < 0.65 && areaApprox < 0.6) semanticClass = 'chair';
                else if (pose.transform.position.y < 0.65 && areaApprox >= 0.6) semanticClass = 'sofa';
                else if (areaApprox < 3.0) semanticClass = 'table';
                else semanticClass = 'unknown';
              } else if (isVert) {
                // Door: reaches floor, typ. 1.9-2.2m tall, 0.7-1.2m wide
                if (worldMinY < 0.4 && heightApprox > 1.8 && widthApprox >= 0.6 && widthApprox <= 1.4) {
                   semanticClass = 'door';
                } 
                // Window: floating off floor, reasonable size
                else if (worldMinY >= 0.5 && heightApprox >= 0.4 && widthApprox >= 0.4 && widthApprox <= 3.0) {
                   semanticClass = 'window';
                }
                // Wardrobe / Tall Cabinet: thick, not too wide, sitting on floor
                else if (worldMinY < 0.3 && widthApprox >= 0.4 && widthApprox <= 2.5 && heightApprox >= 1.0 && heightApprox <= 2.8) {
                   semanticClass = 'wardrobe';
                }
                // TV / Monitor: floating, very thin
                else if (worldMinY >= 0.5 && widthApprox >= 0.6 && widthApprox <= 2.0 && heightApprox >= 0.4 && heightApprox <= 1.5) {
                   semanticClass = 'tv';
                }
                // Door frame / Pillar / Edge: tall but narrow
                else if (widthApprox < 0.4 && heightApprox > 1.2) {
                   semanticClass = 'door_frame';
                }
                else {
                   semanticClass = 'wall';
                }
              } else {
                 semanticClass = 'unknown';
              }
            }

            let requiredArea = 0.1;
            // Lowered thresholds to detect smaller features like door frames and complex room geometries
            if (semanticClass === 'door_frame') {
               requiredArea = 0.01;
            } else if (['table', 'chair', 'sofa', 'door', 'window'].includes(semanticClass)) {
               requiredArea = 0.02; // Very small for frames and furniture
            } else if (semanticClass === 'floor' || semanticClass === 'ceiling') {
               requiredArea = 0.1; 
            } else if (semanticClass === 'wall') {
               requiredArea = 0.05; // Lowered to catch short partition walls and corners
            }

            if (!isValidAngle || areaApprox < requiredArea) {
               let mesh = planesMap.get(plane);
               if (mesh) mesh.visible = false;
               planesDataRef.current.delete(plane);
               return;
            }

            let color = 0x9ca3af; 
            if (semanticClass === 'floor') color = 0x10b981; 
            else if (semanticClass === 'ceiling') color = 0x06b6d4; 
            else if (semanticClass === 'wall') color = 0x3b82f6; 
            else if (semanticClass === 'door_frame') color = 0xec4899; 
            else if (semanticClass === 'table') color = 0xf59e0b; 
            else if (semanticClass === 'chair') color = 0xf43f5e; 
            else if (semanticClass === 'sofa') color = 0xd946ef; 
            else if (semanticClass === 'door') color = 0x8b5cf6; 
            else if (semanticClass === 'window') color = 0x38bdf8; 
            else if (semanticClass === 'wardrobe') color = 0xf97316; // Orange
            else if (semanticClass === 'tv') color = 0x14b8a6; // Teal 

            let mesh = planesMap.get(plane);
            if (!mesh) {
              const orientation = typeof plane.orientation === 'string' ? plane.orientation : 'unknown';
              const isHoriz = orientation.toLowerCase() === 'horizontal';
              const color = isHoriz ? 0x10b981 : 0x3b82f6;
              const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8,
                linewidth: 2
              });
              const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0)]);
              mesh = new THREE.LineLoop(geom, material) as unknown as THREE.Mesh;
              
              scene.add(mesh);
              planesMap.set(plane, mesh);
            } else {
              mesh.visible = true;
              (mesh.material as THREE.LineBasicMaterial).color.setHex(color);
            }

            mesh.position.copy(pose.transform.position);
            mesh.quaternion.copy(pose.transform.orientation);
            
            // Only rebuild geometry if polygon changed size or every 30 frames to avoid memory exhaustion
            const rebuildGeom = !mesh.userData.lastPolyLength || mesh.userData.lastPolyLength !== plane.polygon.length || (frameCount % 60 === 0);

            const poly = [];
            for (let i = 0; i < plane.polygon.length; i++) {
              const p = plane.polygon[i];
              poly.push({x: p.x, y: p.y, z: p.z});
            }

            if (rebuildGeom) {
                mesh.userData.lastPolyLength = plane.polygon.length;
                const points = [];
                for (let i = 0; i < plane.polygon.length; i++) {
                  const p = plane.polygon[i];
                  points.push(new THREE.Vector3(p.x, 0, p.z));
                }
                const geom = new THREE.BufferGeometry().setFromPoints(points);
                if (mesh.geometry) mesh.geometry.dispose();
                mesh.geometry = geom;
            }

            let data = planesDataRef.current.get(plane);
            if (!data) {
              planesDataRef.current.set(plane, {
                id: planeIdCounter++,
                orientation,
                semanticLabel: plane.semanticLabel,
                color: color,
                polygon: poly,
                position: {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z},
                quaternion: {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w},
                lastSeen: Date.now()
              });
              setActivePlanesCount(planesMap.size);
            }

            let pose = null;
            try {
              pose = plane?.planeSpace ? frame.getPose(plane.planeSpace, referenceSpace) : null;
            } catch (error) {
              console.warn('Skipping plane with unavailable pose', error);
            }

            if (pose && mesh) {
              mesh.position.copy(pose.transform.position);
              mesh.quaternion.copy(pose.transform.orientation);
              
              const poly: {x: number, y: number, z: number}[] = [];
              const polygonPoints = plane?.polygon || [];
              for (let i = 0; i < polygonPoints.length; i++) {
                const p = polygonPoints[i];
                if (Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.z)) {
                  poly.push({x: p.x, y: p.y, z: p.z});
                }
              }

              const currentVersion = plane.lastChangedTime ?? timestamp;
              if (poly.length >= 3 && planeGeometryVersion.get(plane) !== currentVersion) {
                try {
                  const shape = new THREE.Shape();
                  for (let i = 0; i < poly.length; i++) {
                    const p = poly[i];
                    if (i === 0) shape.moveTo(p.x, -p.z);
                    else shape.lineTo(p.x, -p.z);
                  }
                  shape.closePath();
                  const geom = new THREE.ShapeGeometry(shape);
                  geom.rotateX(-Math.PI / 2); // align to WebXR plane local space (Y is normal)
                  mesh.geometry?.dispose();
                  mesh.geometry = geom;
                  planeGeometryVersion.set(plane, currentVersion);
                } catch (error) {
                  console.warn('Skipping invalid plane geometry', error);
                }
              }

              const data = planesDataRef.current.get(plane);
              if (data) {
                data.polygon = poly;
                data.position = {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z};
                data.quaternion = {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w};
              }
            }
          });

          let removedPlane = false;
          planesMap.forEach((mesh, plane) => {
            if (!detectedPlanes.has(plane)) {
              scene.remove(mesh);
              disposePlaneMesh(mesh);
              planesMap.delete(plane);
              planeGeometryVersion.delete(plane);
              planesDataRef.current.delete(plane);
              removedPlane = true;
            }
          });
          if (removedPlane) setActivePlanesCount(planesMap.size);
        }
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(render);

    return () => {
      isMountedRef.current = false;
      clearSessionStartTimer(sessionStartTimerRef);
      const activeSession = currentSession || sessionRef.current;
      rendererRef.current = null;
      sessionRef.current = null;
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      window.removeEventListener('resize', onWindowResize);
      renderer.setAnimationLoop(null);
      if (activeSession) activeSession.end().catch(() => {});
      planesMap.forEach(disposePlaneMesh);
      renderer.dispose();
      scene.clear();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  const handleStartSession = async () => {
    if (startRequestedRef.current || sessionRef.current) return;

    const xr = getXRSystem();
    const renderer = rendererRef.current;
    const overlayDiv = document.getElementById('ar-overlay');

    if (!xr?.requestSession || !renderer) {
      setIsSessionStarting(false);
      setSessionStartError('WebXR AR is not available in this browser.');
      startRequestedRef.current = false;
      return;
    }

    startRequestedRef.current = true;
    setIsSessionStarting(true);
    setSessionStartError(null);

    const sessionInit: Record<string, unknown> = {
      requiredFeatures: ['plane-detection'],
      optionalFeatures: overlayDiv ? ['dom-overlay'] : []
    };
    if (overlayDiv) sessionInit.domOverlay = { root: overlayDiv };

    renderer.xr.setReferenceSpaceType('local');

    sessionStartTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !startRequestedRef.current) return;
      setSessionStartError('Still waiting for AR permission. Please approve the browser prompt to continue.');
    }, SESSION_START_TIMEOUT_MS);

    try {
      const session = await xr.requestSession('immersive-ar', sessionInit);
      sessionRef.current = session;

      try {
        await renderer.xr.setSession(session as any);
      } catch (error) {
        sessionRef.current = null;
        await session.end().catch(() => {});
        throw error;
      }

      clearSessionStartTimer(sessionStartTimerRef);
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(null);
    } catch (error) {
      console.warn('Unable to start AR scan session', error);
      clearSessionStartTimer(sessionStartTimerRef);
      sessionRef.current = null;
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(getSessionErrorMessage(error));
    }
  };

  const handleFinish = () => {
      const planesArray = Array.from(planesDataRef.current.values());
      const lighting = engineApiRef.current?.getCurrentLighting();
      onComplete(planesArray, 1.0, lighting);
  };

  const getQualityColor = () => {
     if (scanQuality === 'low') return 'text-red-400 border-red-500/50 bg-red-500/20 shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)]';
     if (scanQuality === 'medium') return 'text-yellow-400 border-yellow-500/50 bg-yellow-500/20 shadow-[0_0_30px_-5px_rgba(234,179,8,0.3)]';
     return 'text-emerald-400 border-emerald-500/50 bg-emerald-500/20 shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]';
  };

  return (
    <>
      <div ref={containerRef} className="fixed inset-0 w-full h-[100dvh] touch-none" />
      <div 
        id="ar-overlay" 
        className="fixed inset-0 pointer-events-none z-50"
      >
        <div 
          className="w-full h-full flex flex-col justify-between p-6 overflow-hidden box-border"
          style={{ 
            paddingTop: 'calc(env(safe-area-inset-top, 24px) + 1.5rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 1.5rem)'
          }}
        >
          <div className="flex justify-between items-start z-10 w-full">
           <div className="space-y-4 pointer-events-auto">
             <Button
               onClick={handleStartSession}
               disabled={isSessionStarting}
               className="bg-indigo-600 hover:bg-indigo-500 text-white w-full"
             >
               <Scan className="w-5 h-5 mr-2" />
               {isSessionStarting ? 'Starting AR…' : 'Start AR Session'}
             </Button>
             {sessionStartError && (
               <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                 {sessionStartError}
               </p>
             )}
             <div className="bg-black/50 backdrop-blur text-white px-4 py-2 rounded-xl border border-white/10 shadow-lg">
                <div className="text-xs text-slate-300 font-semibold mb-1 uppercase tracking-wider">Detected Surfaces</div>
                <div className="text-3xl font-bold font-mono">
                    {activePlanesCount}
                </div>
             </div>
             
             <Button variant="outline" className="bg-black/50 border-white/10 text-white w-full" onClick={onCancel}>
               <X className="w-5 h-5 mr-2" /> Cancel
             </Button>
           </div>

           {activePlanesCount > 0 && (
             <div className="flex flex-col gap-4 items-end pointer-events-auto">
               <Button onClick={handleFinish} className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full px-6 shadow-[0_0_20px_-5px_rgba(79,70,229,1)] flex items-center gap-2">
                   <Check className="w-5 h-5" />
                   Finish Mapping
               </Button>
               {liveRoomModel && (
                 <MiniMap roomModel={liveRoomModel} className="w-32 h-32 md:w-48 md:h-48 border border-white/20 shadow-2xl" />
               )}
             </div>
           )}
        </div>

        {/* Central Guidance UI */}
        {isSupported && (
           <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-80 backdrop-blur-sm bg-black/10 transition-opacity duration-500">
              <div className={`p-6 rounded-full border mb-6 transition-all duration-1000 ${getQualityColor()}`}>
                 {guidanceIcon}
              </div>
           </div>
        )}

         <div className="text-center pb-8 pointer-events-none z-10 space-y-4">
            {isSupported === null && (
               <Button 
                  onClick={() => {
                     if ((window as any)._startAR) (window as any)._startAR();
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white pointer-events-auto shadow-lg px-8 py-6 rounded-full font-bold text-lg"
               >
                 Tap to Open Camera
               </Button>
            )}
            {isSupported === false ? (
               <p className="bg-red-500/80 inline-flex flex-col items-center gap-2 px-4 py-3 rounded-xl text-white text-sm backdrop-blur font-medium border border-red-400/50 max-w-sm pointer-events-auto">
                   <span className="flex items-center gap-2">
                       <Info className="w-5 h-5 flex-shrink-0" />
                       WebXR AR session failed to start.
                   </span>
                   <span className="text-red-200 text-xs text-center">
                       If you are in a preview window, please open the app in a new tab. Otherwise, check your site permissions.
                   </span>
               </p>
            ) : isSupported === true ? (
                <p className={`inline-flex items-center gap-2 px-6 py-4 rounded-full text-white text-sm md:text-base backdrop-blur font-medium border transition-all duration-500 ${scanQuality === 'high' ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-black/60 border-white/10'}`}>
                    {scanQuality === 'high' ? <Check className="w-5 h-5 text-emerald-400" /> : <Info className="w-5 h-5 text-indigo-400" />}
                    {guidanceTip}
                </p>
            ) : null}
         </div>
        </div>
      </div>
    </>
  );
}
