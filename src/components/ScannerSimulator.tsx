import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Check, X, ArrowDown } from 'lucide-react';
import { Button } from './ui/button';
import { ScannedPlane } from './ARScanner';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RoomLighting, RoomModel } from '../core/models/types';
import { MiniMap } from './MiniMap';
import Webcam from 'react-webcam';

export function ScannerSimulator({ onComplete, onCancel }: { onComplete: (planes: ScannedPlane[], scaleFactor: number, lighting?: RoomLighting) => void, onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePlanesCount, setActivePlanesCount] = useState(0);
  const planesDataRef = useRef<Map<number, ScannedPlane>>(new Map());
  const [scanStats, setScanStats] = useState({ floorArea: 0, wallArea: 0 });
  const [progress, setProgress] = useState(0);
  const [liveRoomModel, setLiveRoomModel] = useState<RoomModel | null>(null);

  const [webcamAvailable, setWebcamAvailable] = useState<boolean>(true);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    // Setup a 3D scene that mimics the scanner but looks around a virtual room
    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    const light = new THREE.HemisphereLight(0xffffff, 0x444455, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    let isMounted = true;

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    const planesMap = new Map<number, THREE.Mesh>();
    const wireframeGroup = new THREE.Group();
    scene.add(wireframeGroup);

    // Simulated target room data
    const mockPlanes: ScannedPlane[] = [
        {
            id: 1, orientation: 'horizontal', semanticLabel: 'floor', color: 0x10b981, lastSeen: Date.now(),
            position: { x: 0, y: -1.5, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            polygon: [ {x: -2, y: 0, z: -2}, {x: 2, y: 0, z: -2}, {x: 2, y: 0, z: 2}, {x: -2, y: 0, z: 2} ]
        },
        {
            id: 2, orientation: 'vertical', semanticLabel: 'wall', color: 0x3b82f6, lastSeen: Date.now(),
            position: { x: 0, y: 0, z: -2 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }, // Front wall
            polygon: [ {x: -2, y: 0, z: -1.5}, {x: 2, y: 0, z: -1.5}, {x: 2, y: 0, z: 1.5}, {x: -2, y: 0, z: 1.5} ]
        },
        {
            id: 3, orientation: 'vertical', semanticLabel: 'wall', color: 0x3b82f6, lastSeen: Date.now(),
            position: { x: 2, y: 0, z: 0 },
            quaternion: { x: 0, y: 0.7071, z: 0, w: 0.7071 }, // Right wall
            polygon: [ {x: -2, y: 0, z: -1.5}, {x: 2, y: 0, z: -1.5}, {x: 2, y: 0, z: 1.5}, {x: -2, y: 0, z: 1.5} ]
        },
        {
            id: 4, orientation: 'vertical', semanticLabel: 'wall', color: 0x3b82f6, lastSeen: Date.now(),
            position: { x: -2, y: 0, z: 0 },
            quaternion: { x: 0, y: -0.7071, z: 0, w: 0.7071 }, // Left wall
            polygon: [ {x: -2, y: 0, z: -1.5}, {x: 2, y: 0, z: -1.5}, {x: 2, y: 0, z: 1.5}, {x: -2, y: 0, z: 1.5} ]
        },
        {
            id: 5, orientation: 'vertical', semanticLabel: 'wall', color: 0x3b82f6, lastSeen: Date.now(),
            position: { x: 0, y: 0, z: 2 },
            quaternion: { x: 0, y: 1, z: 0, w: 0 }, // Back wall
            polygon: [ {x: -2, y: 0, z: -1.5}, {x: 2, y: 0, z: -1.5}, {x: 2, y: 0, z: 1.5}, {x: -2, y: 0, z: 1.5} ]
        }
    ];

    let t = 0;
    let planeIndex = 0;

    const animate = () => {
      if (!isMounted) return;
      requestAnimationFrame(animate);
      
      t += 0.03;
      
      // Camera spins slowly
      camera.position.x = Math.sin(t * 0.5) * 1.5;
      camera.position.y = Math.sin(t * 0.3) * 0.5;
      camera.position.z = Math.cos(t * 0.5) * 1.5;
      camera.lookAt(0, 0, 0);

      // Add planes progressively
      if (t > (planeIndex + 1) * 1 && planeIndex < mockPlanes.length) {
          const plane = mockPlanes[planeIndex];
          planesDataRef.current.set(plane.id, plane);
          
          let color = plane.orientation === 'horizontal' ? 0xff3333 : 0x3366ff;
          
          const material = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
          });
          const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
          
          const solidMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const solidMesh = new THREE.Mesh(new THREE.BufferGeometry(), solidMaterial);
          mesh.add(solidMesh);

          scene.add(mesh);
          
          mesh.position.set(plane.position.x, plane.position.y, plane.position.z);
          mesh.quaternion.set(plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w);
          
          const points: THREE.Vector3[] = [];
          for (let i = 0; i < plane.polygon.length; i++) {
              const p = plane.polygon[i];
              points.push(new THREE.Vector3(p.x, 0, -p.z));
          }
          const geom = new THREE.BufferGeometry().setFromPoints(points);
          mesh.geometry = geom;
          solidMesh.geometry = geom;
          
          // Wireframe
          const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
          const line = new THREE.LineLoop(geom, lineMat);
          mesh.add(line);

          setActivePlanesCount(planesDataRef.current.size);
          setScanStats({ floorArea: 16, wallArea: planeIndex * 12 });
          planeIndex++;
          
          // Dynamically rebuild the 3D connected model wireframe
          if (planesDataRef.current.size >= 2) {
              const planesArray = Array.from(planesDataRef.current.values());
              const roomModel = RoomReconstruction.buildRoomModel(planesArray);
              setLiveRoomModel(roomModel);
              
              const disposeNode = (node: any) => {
                  if (node.geometry) node.geometry.dispose();
                  if (node.material) {
                      if (Array.isArray(node.material)) node.material.forEach((m: any) => m.dispose());
                      else node.material.dispose();
                  }
                  if (node.children) node.children.forEach(disposeNode);
              };
              wireframeGroup.children.forEach(disposeNode);
              wireframeGroup.clear();
              
              // Build wireframe for walls
              roomModel.enhancedWalls.forEach(w => {
                  const geometry = new THREE.PlaneGeometry(w.width, w.height);
                  const edges = new THREE.EdgesGeometry(geometry);
                  const wallMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 3 });
                  const wallLine = new THREE.LineSegments(edges, wallMaterial);
                  wallLine.position.set(w.position[0], w.position[1], w.position[2]);
                  wallLine.quaternion.set(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]);
                  wireframeGroup.add(wallLine);
              });
              
              // Build wireframe for floor
              if (roomModel.floorHullPoints.length > 2) {
                  const floorPoints: THREE.Vector3[] = [];
                  roomModel.floorHullPoints.forEach(p => {
                      floorPoints.push(new THREE.Vector3(p.x, 0, -p.z));
                  });
                  const floorGeom = new THREE.BufferGeometry().setFromPoints(floorPoints);
                  const floorMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3 });
                  
                  const floorLine = new THREE.LineLoop(floorGeom, floorMat);
                  floorLine.position.y = roomModel.floorY;
                  wireframeGroup.add(floorLine);
                  
                  const ceilLine = new THREE.LineLoop(floorGeom, floorMat);
                  ceilLine.position.y = roomModel.ceilingY;
                  wireframeGroup.add(ceilLine);
              }
          }
          setProgress(Math.min(100, Math.floor((planeIndex / mockPlanes.length) * 100)));
      }
      
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isMounted = false;
      window.removeEventListener('resize', onWindowResize);
      renderer.dispose();
      scene.clear();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  const handleFinish = () => {
      const planesArray = Array.from(planesDataRef.current.values());
      onComplete(planesArray, 1.0);
  };

  return (
    <>
      {webcamAvailable ? (
        <Webcam
          audio={false}
          videoConstraints={{ facingMode: "environment" }}
          className="fixed inset-0 w-full h-[100dvh] object-cover pointer-events-none opacity-40"
          onUserMediaError={() => setWebcamAvailable(false)}
        />
      ) : (
        <div className="fixed inset-0 w-full h-[100dvh] bg-slate-900 flex flex-col items-center justify-center">
             <div className="w-16 h-16 border-4 border-slate-700 border-dashed rounded-xl mx-auto mb-4" />
             <p className="text-slate-500 font-medium">Virtual Camera Env</p>
        </div>
      )}
      <div ref={containerRef} className="fixed inset-0 w-full h-[100dvh] touch-none pointer-events-auto" />
      <div 
        id="ar-overlay" 
        className="absolute inset-0 w-full h-full pointer-events-none z-50 flex flex-col justify-between p-6 overflow-hidden box-border"
        style={{ 
          paddingTop: 'calc(env(safe-area-inset-top, 24px) + 1.5rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 1.5rem)'
        }}
      >
        <div className="flex justify-between items-start z-10 w-full">
           <div className="space-y-4 pointer-events-auto">
             <div className="bg-black/50 backdrop-blur w-56 text-white px-4 py-3 rounded-xl border border-indigo-500/30 shadow-[0_0_15px_-3px_rgba(99,102,241,0.4)] flex flex-col gap-2">
                <div className="flex justify-between items-center mb-1">
                   <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Mock Scan</span>
                   <span className="text-xs font-mono">{progress}%</span>
                </div>
                <div className="text-xs text-slate-300 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Planes</span>
                   <span className="text-white font-mono">{activePlanesCount}</span>
                </div>
                <div className="text-xs text-slate-300 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Floor Area</span>
                   <span className="text-emerald-400 font-mono">{scanStats.floorArea} m²</span>
                </div>
                <div className="text-xs text-slate-300 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Wall Area</span>
                   <span className="text-blue-400 font-mono">{scanStats.wallArea} m²</span>
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
        
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-50">
           <div className="w-16 h-16 border-2 border-indigo-500/50 rounded-full animate-spin flex items-center justify-center">
              <div className="w-8 h-8 bg-indigo-500/20 rounded-full"></div>
           </div>
        </div>
      </div>
    </>
  );
}
