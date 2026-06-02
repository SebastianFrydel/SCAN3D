import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Check, Info, Scan, X } from 'lucide-react';
import { Button } from './ui/button';

export interface ScannedPlane {
  id: number;
  orientation: string;
  semanticLabel?: string;
  polygon: {x: number, y: number, z: number}[];
  position: {x: number, y: number, z: number};
  quaternion: {x: number, y: number, z: number, w: number};
  color: number;
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

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
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
            let mesh = planesMap.get(plane);
            if (!mesh) {
              const orientation = typeof plane.orientation === 'string' ? plane.orientation : 'unknown';
              const isHoriz = orientation.toLowerCase() === 'horizontal';
              const color = isHoriz ? 0x10b981 : 0x3b82f6;
              const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide
              });
              mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
              scene.add(mesh);
              planesMap.set(plane, mesh);
              
              planesDataRef.current.set(plane, {
                id: planeIdCounter++,
                orientation,
                semanticLabel: plane.semanticLabel,
                color: color,
                polygon: [],
                position: {x: 0, y: 0, z: 0},
                quaternion: {x: 0, y: 0, z: 0, w: 1}
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
      onComplete(planesArray);
  };

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 bg-black touch-none" />
      <div id="ar-overlay" className="absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-6">
        <div className="flex justify-between items-start">
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
             <Button onClick={handleFinish} className="bg-indigo-600 hover:bg-indigo-500 text-white pointer-events-auto rounded-full px-6 shadow-[0_0_20px_-5px_rgba(79,70,229,1)] flex items-center gap-2">
                 <Check className="w-5 h-5" />
                 Finish Mapping
             </Button>
           )}
        </div>
        <div className="text-center pb-8 pointer-events-none">
            <p className="bg-black/60 inline-flex items-center gap-2 px-4 py-3 rounded-full text-white text-sm backdrop-blur font-medium border border-white/10">
                <Info className="w-5 h-5 text-indigo-400" />
                Slowly pan device around the room to map walls & floor
            </p>
        </div>
      </div>
    </>
  );
}
