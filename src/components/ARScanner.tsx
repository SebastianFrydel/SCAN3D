import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
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

export function ARScanner({ onComplete, onCancel }: { onComplete: (planes: ScannedPlane[]) => void, onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePlanesCount, setActivePlanesCount] = useState(0);
  const planesDataRef = useRef<Map<any, ScannedPlane>>(new Map());
  const startRequestedRef = useRef(false);
  const arButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionStartTimerRef = useRef<number | null>(null);
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [sessionStartFailed, setSessionStartFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const overlayDiv = document.getElementById('ar-overlay');
    const arButtonOptions: any = {
      requiredFeatures: ['plane-detection'],
      optionalFeatures: overlayDiv ? ['dom-overlay'] : []
    };
    if (overlayDiv) arButtonOptions.domOverlay = { root: overlayDiv };
    const arButton = ARButton.createButton(renderer, arButtonOptions);
    arButtonRef.current = arButton as HTMLButtonElement;
    
    arButton.style.display = 'none';
    container.appendChild(arButton);
    const clickTimeout = setTimeout(() => {}, 0);
    const onSessionStart = () => {
      if (sessionStartTimerRef.current) window.clearTimeout(sessionStartTimerRef.current);
      setIsSessionStarting(false);
      setSessionStartFailed(false);
    };
    const onSessionEnd = () => {
      startRequestedRef.current = false;
      setIsSessionStarting(false);
    };
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    const planesMap = new Map<any, THREE.Mesh>();
    let currentSession: any = null;
    let planeIdCounter = 0;

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    window.addEventListener('resize', onWindowResize);

    const animate = () => {
      renderer.setAnimationLoop(render);
    };

    const planeGeometryVersion = new Map<any, number>();
    const render = (timestamp: number, frame: any) => {
      if (frame) {
        currentSession = renderer.xr.getSession();
        const referenceSpace = renderer.xr.getReferenceSpace();

        if (frame.detectedPlanes) {
          const detectedPlanes = frame.detectedPlanes;
          
          detectedPlanes.forEach((plane: any) => {
            let mesh = planesMap.get(plane);
            if (!mesh) {
              // 'horizontal' or 'vertical'
              const isHoriz = plane.orientation?.toLowerCase() === 'horizontal'; 
              const color = isHoriz ? 0x10b981 : 0x3b82f6; // emerald for floor/ceiling, blue for walls
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
                orientation: plane.orientation,
                semanticLabel: plane.semanticLabel,
                color: color,
                polygon: [],
                position: {x: 0, y: 0, z: 0},
                quaternion: {x: 0, y: 0, z: 0, w: 1}
              });
              setActivePlanesCount(planesMap.size);
            }

            const pose = frame.getPose(plane.planeSpace, referenceSpace);
            if (pose && mesh) {
              mesh.position.copy(pose.transform.position);
              mesh.quaternion.copy(pose.transform.orientation);
              
              const poly = [];
              for (let i = 0; i < plane.polygon.length; i++) {
                const p = plane.polygon[i];
                poly.push({x: p.x, y: p.y, z: p.z});
              }

              const currentVersion = plane.lastChangedTime || timestamp;
              if (planeGeometryVersion.get(plane) !== currentVersion) {
                const shape = new THREE.Shape();
                for (let i = 0; i < poly.length; i++) {
                  const p = poly[i];
                  if (i === 0) shape.moveTo(p.x, -p.z);
                  else shape.lineTo(p.x, -p.z);
                }
                const geom = new THREE.ShapeGeometry(shape);
                geom.rotateX(-Math.PI / 2); // align to WebXR plane local space (Y is normal)
                if (mesh.geometry) mesh.geometry.dispose();
                mesh.geometry = geom;
                planeGeometryVersion.set(plane, currentVersion);
              }

              const data = planesDataRef.current.get(plane);
              if (data) {
                data.polygon = poly;
                data.position = {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z};
                data.quaternion = {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w};
              }
            }
          });

          // Cleanup stale planes
          planesMap.forEach((mesh, plane) => {
            if (!detectedPlanes.has(plane)) {
              scene.remove(mesh);
              mesh.geometry?.dispose();
              (mesh.material as THREE.Material)?.dispose();
              planesMap.delete(plane);
              planeGeometryVersion.delete(plane);
              planesDataRef.current.delete(plane);
              setActivePlanesCount(planesMap.size);
            }
          });
        }
      }
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      clearTimeout(clickTimeout);
      if (sessionStartTimerRef.current) {
        window.clearTimeout(sessionStartTimerRef.current);
      }
      arButtonRef.current = null;
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      window.removeEventListener('resize', onWindowResize);
      renderer.setAnimationLoop(null);
      if (currentSession) currentSession.end().catch(() => {});
      planesMap.forEach((mesh) => {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose();
      });
      renderer.dispose();
      scene.clear();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (container.contains(arButton)) container.removeChild(arButton);
    };
  }, []);

  const handleStartSession = () => {
    if (startRequestedRef.current) return;
    startRequestedRef.current = true;
    setIsSessionStarting(true);
    setSessionStartFailed(false);
    const startButton = arButtonRef.current;
    if (!startButton) {
      setIsSessionStarting(false);
      setSessionStartFailed(true);
      startRequestedRef.current = false;
      return;
    }
    startButton.click();
    sessionStartTimerRef.current = window.setTimeout(() => {
      if (startRequestedRef.current) {
        setIsSessionStarting(false);
        setSessionStartFailed(true);
        startRequestedRef.current = false;
      }
    }, 1800);
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
             {sessionStartFailed && (
               <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                 Could not start AR session. Please tap again and allow camera access.
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
