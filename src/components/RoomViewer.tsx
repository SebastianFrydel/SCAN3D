import React, { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { ScannedPlane } from './ARScanner';
import { Button } from './ui/button';
import { ArrowLeft, Layers, Box, Paintbrush, Camera, Download, Map, Sparkles } from 'lucide-react';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RawPlane, RoomLighting } from '../core/models/types';
import { AIDesignInsights } from './AIDesignInsights';

const MATERIAL_PRESETS = {
  defaultFloor: { color: 0xffffff, roughness: 0.1, metalness: 0.0, clearcoat: 0.5 },
  defaultWall: { color: 0x3b82f6, roughness: 0.2, metalness: 0.1, clearcoat: 0.0 },
  wood: { color: '#8b5a2b', roughness: 0.8, metalness: 0.1, clearcoat: 0.1 },
  metal: { color: '#b0c4de', roughness: 0.2, metalness: 0.9, clearcoat: 0.5 },
  fabric: { color: '#f0e6d2', roughness: 1.0, metalness: 0.0, clearcoat: 0.0 },
  paint: { color: '#f8f9fa', roughness: 0.9, metalness: 0.0, clearcoat: 0.0 }
};

type MaterialType = keyof typeof MATERIAL_PRESETS;

function WallMesh({ w, isSelected, matProps, map, onClick }: { w: import('../core/models/types').ProcessedWall, isSelected: boolean, matProps: any, map: THREE.Texture | null, onClick: (e: any) => void }) {
    const geometry = useMemo(() => {
        const shape = new THREE.Shape();
        shape.moveTo(-w.width / 2, -w.height / 2);
        shape.lineTo(w.width / 2, -w.height / 2);
        shape.lineTo(w.width / 2, w.height / 2);
        shape.lineTo(-w.width / 2, w.height / 2);
        shape.lineTo(-w.width / 2, -w.height / 2);

        if (w.holes && w.holes.length > 0) {
            w.holes.forEach(hole => {
                const hPath = new THREE.Path();
                const hx = hole.x - hole.width / 2;
                const hy = hole.y - hole.height / 2;
                hPath.moveTo(hx, hy);
                hPath.lineTo(hx, hy + hole.height);
                hPath.lineTo(hx + hole.width, hy + hole.height);
                hPath.lineTo(hx + hole.width, hy);
                hPath.lineTo(hx, hy);
                shape.holes.push(hPath);
            });
        }
        
        // Extrude to give walls architectural thickness
        const extrudeSettings = {
            depth: 0.1, // 10cm thick
            bevelEnabled: false
        };
        let geom;
        try {
            geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        } catch(e) {
            console.warn("Wall extrusion failed", e);
            geom = new THREE.PlaneGeometry(w.width, w.height);
        }
        // Center the extrusion so the original plane is in the middle or outer face
        geom.translate(0, 0, -0.05);

        // Fix UV maps for ExtrudeGeometry on walls
        const posAttribute = geom.attributes.position;
        const uvAttribute = geom.attributes.uv;
        for (let i = 0; i < posAttribute.count; i++) {
           const x = posAttribute.getX(i);
           const y = posAttribute.getY(i);
           uvAttribute.setXY(i, x, y);
        }
        
        return geom;
    }, [w]);

    return (
        <group position={w.position} quaternion={w.quaternion}>
           <mesh onClick={onClick}>
              <primitive object={geometry} attach="geometry" />
              <meshPhysicalMaterial 
                   {...matProps} 
                   map={map}
                   side={THREE.DoubleSide} 
                   transparent={false} 
                   opacity={1} 
                   emissive={isSelected ? new THREE.Color(0x333333) : new THREE.Color(0x000000)}
              />
              <lineSegments>
                <edgesGeometry args={[geometry]} />
                <lineBasicMaterial color={isSelected ? '#fff' : '#000000'} linewidth={2} opacity={0.6} transparent />
              </lineSegments>
           </mesh>
           
           {/* Render coplanar features */}
           {w.holes && w.holes.map((hole, i) => (
                <group key={i} position={[hole.x, hole.y, 0]}>
                   <mesh position={[0, 0, 0]}>
                      <planeGeometry args={[hole.width, hole.height]} />
                      <meshBasicMaterial 
                           color={hole.type === 'door' ? '#8b5cf6' : '#38bdf8'} 
                           transparent 
                           opacity={0.4} 
                           side={THREE.DoubleSide} 
                      />
                      <lineSegments>
                         <edgesGeometry args={[new THREE.PlaneGeometry(hole.width, hole.height)]} />
                         <lineBasicMaterial color={hole.type === 'door' ? '#8b5cf6' : '#38bdf8'} linewidth={2} />
                      </lineSegments>
                   </mesh>
                </group>
           ))}

           {/* Wall length display */}

        </group>
    );
}

export function RoomViewer({ planes, lighting, onBack }: { planes: ScannedPlane[], lighting?: RoomLighting, onBack: () => void }) {
  const [viewMode, setViewMode] = useState<'raw' | 'enhanced' | 'layout2d'>('enhanced');
  const [selectedMeshId, setSelectedMeshId] = useState<string | null>(null);
  const [customMaterials, setCustomMaterials] = useState<Record<string, MaterialType>>({});
  const [showAIInsights, setShowAIInsights] = useState(false);
  const sceneGroupRef = useRef<THREE.Group>(null);

  const tileTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 1024;
     canvas.height = 1024;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         // Grout lines
         ctx.fillStyle = '#94a3b8'; 
         ctx.fillRect(0, 0, 1024, 1024);
         
         // Tile inner base
         ctx.fillStyle = '#f8fafc';
         ctx.fillRect(16, 16, 992, 992);
         
         // Subtle shadow / bevel gradient
         const gradient = ctx.createLinearGradient(16, 16, 1008, 1008);
         gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
         gradient.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
         ctx.fillStyle = gradient;
         ctx.fillRect(16, 16, 992, 992);

         // Add some noise for realism
         const imgData = ctx.getImageData(16, 16, 992, 992);
         for (let i = 0; i < imgData.data.length; i += 4) {
             const noise = (Math.random() - 0.5) * 10;
             imgData.data[i] += noise;
             imgData.data[i+1] += noise;
             imgData.data[i+2] += noise;
         }
         ctx.putImageData(imgData, 16, 16);
     }
     const texture = new THREE.CanvasTexture(canvas);
     texture.wrapS = THREE.RepeatWrapping;
     texture.wrapT = THREE.RepeatWrapping;
     texture.colorSpace = THREE.SRGBColorSpace;
     // 1 unit = 1m. 2 tiles per meter => set repeat to 2
     texture.repeat.set(2, 2);
     // Enable anisotropic filtering for better viewing angle clarity
     texture.anisotropy = 16;
     return texture;
  }, []);

  const woodTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 1024;
     canvas.height = 1024;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         // Base wood color
         ctx.fillStyle = '#b5835a';
         ctx.fillRect(0, 0, 1024, 1024);
         
         // Wood grains
         ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
         for (let i = 0; i < 2000; i++) {
             ctx.fillRect(Math.random() * 1024, Math.random() * 1024, Math.random() * 200 + 50, 4);
         }
         
         // Planks
         ctx.strokeStyle = '#5c4033';
         ctx.lineWidth = 6;
         for (let y = 0; y < 1024; y += 128) {
             ctx.beginPath();
             ctx.moveTo(0, y);
             ctx.lineTo(1024, y);
             ctx.stroke();
             // Vertical plank breaks
             for (let j = 0; j < 3; j++) {
                const bx = (Math.random() * 1024);
                ctx.beginPath();
                ctx.moveTo(bx, y);
                ctx.lineTo(bx, y + 128);
                ctx.stroke();
             }
         }
     }
     const texture = new THREE.CanvasTexture(canvas);
     texture.wrapS = THREE.RepeatWrapping;
     texture.wrapT = THREE.RepeatWrapping;
     texture.colorSpace = THREE.SRGBColorSpace;
     // 1 plank is 0.125 units wide. 
     texture.repeat.set(1, 1);
     texture.anisotropy = 16;
     return texture;
  }, []);

  const plasterTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 512;
     canvas.height = 512;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         ctx.fillStyle = '#f1f5f9';
         ctx.fillRect(0, 0, 512, 512);
         const imgData = ctx.getImageData(0, 0, 512, 512);
         for (let i = 0; i < imgData.data.length; i += 4) {
             const noise = (Math.random() - 0.5) * 15;
             imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + noise));
             imgData.data[i+1] = Math.min(255, Math.max(0, imgData.data[i+1] + noise));
             imgData.data[i+2] = Math.min(255, Math.max(0, imgData.data[i+2] + noise));
         }
         ctx.putImageData(imgData, 0, 0);
     }
     const texture = new THREE.CanvasTexture(canvas);
     texture.wrapS = THREE.RepeatWrapping;
     texture.wrapT = THREE.RepeatWrapping;
     texture.colorSpace = THREE.SRGBColorSpace;
     texture.repeat.set(4, 4);
     texture.anisotropy = 16;
     return texture;
  }, []);

  const getMaterialMap = (matType?: MaterialType) => {
      if (matType === 'wood') return woodTexture;
      if (matType === 'paint') return plasterTexture;
      if (matType === 'defaultFloor') return tileTexture;
      return null;
  };

  const handleExportGLTF = () => {
      if (!sceneGroupRef.current) return;
      const exporter = new GLTFExporter();
      exporter.parse(
          sceneGroupRef.current,
          (gltf) => {
              const output = JSON.stringify(gltf, null, 2);
              const blob = new Blob([output], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'ar_room.gltf';
              a.click();
              URL.revokeObjectURL(url);
          },
          (error) => {
              console.error('An error happened during parsing', error);
          },
          { binary: false }
      );
  };

  const handleExportOBJ = () => {
      if (!sceneGroupRef.current) return;
      const exporter = new OBJExporter();
      const output = exporter.parse(sceneGroupRef.current);
      const blob = new Blob([output], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ar_room.obj';
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleExportSTL = () => {
      if (!sceneGroupRef.current) return;
      const exporter = new STLExporter();
      const output = exporter.parse(sceneGroupRef.current, { binary: true });
      const blob = new Blob([output], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ar_room.stl';
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleExportPLY = () => {
      if (!sceneGroupRef.current) return;
      const exporter = new PLYExporter();
      exporter.parse(sceneGroupRef.current, (output) => {
          const blob = new Blob([output], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ar_room.ply';
          a.click();
          URL.revokeObjectURL(url);
      }, { binary: false });
  };

  // Process data for the enhanced view using our separated processing layer
  const { enhancedWalls, features, objects, floorHullPoints, floorHull, ceilingHull, floorY, ceilingY, roomCenter, minX, maxX, minZ, maxZ } = useMemo(() => {
    // Map ScannedPlane to RawPlane
    const rawPlanes: RawPlane[] = planes.map(p => ({
        ...p,
        polygon: p.polygon,
        position: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
        quaternion: new THREE.Quaternion(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w)
    }));

    const model = RoomReconstruction.buildRoomModel(rawPlanes);

    // Create THREE.js Display Geometry from Model data
    const floorShape = new THREE.Shape();
    const ceilShape = new THREE.Shape();
    
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    model.floorHullPoints.forEach((p, i) => {
        if (i === 0) {
            floorShape.moveTo(p.x, -p.z);
            ceilShape.moveTo(p.x, -p.z);
        } else {
            floorShape.lineTo(p.x, -p.z);
            ceilShape.lineTo(p.x, -p.z);
        }
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    });

    const extrudeSettings = { depth: 0.1, bevelEnabled: false };
    let fGeom;
    let cGeom;
    try {
        fGeom = new THREE.ExtrudeGeometry(floorShape, extrudeSettings);
        fGeom.translate(0, 0, -0.05);
        fGeom.rotateX(-Math.PI / 2);
        fGeom.translate(0, -0.05, 0); // shift down by half thickness
        
        cGeom = new THREE.ExtrudeGeometry(ceilShape, extrudeSettings);
        cGeom.translate(0, 0, -0.05);
        cGeom.rotateX(-Math.PI / 2);
        cGeom.translate(0, 0.05, 0); // shift up by half thickness
    } catch(err) {
        console.warn("ExtrudeGeometry failed, degenerate polygon.", err);
        fGeom = new THREE.PlaneGeometry(maxX - minX || 5, maxZ - minZ || 5);
        fGeom.rotateX(-Math.PI / 2);
        cGeom = new THREE.PlaneGeometry(maxX - minX || 5, maxZ - minZ || 5);
        cGeom.rotateX(-Math.PI / 2);
    }

    return { 
        enhancedWalls: model.enhancedWalls, 
        features: model.features,
        objects: model.objects,
        floorHullPoints: model.floorHullPoints,
        floorHull: fGeom, 
        ceilingHull: cGeom, 
        floorY: model.floorY, 
        ceilingY: model.ceilingY,
        roomCenter: model.roomCenter,
        minX, maxX, minZ, maxZ
    };
  }, [planes]);

  const rawPlaneMeshes = useMemo(() => {
    return planes.map(plane => {
      const shape = new THREE.Shape();
      for (let i = 0; i < plane.polygon.length; i++) {
        const p = plane.polygon[i];
        if (i === 0) shape.moveTo(p.x, -p.z);
        else shape.lineTo(p.x, -p.z);
      }
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      
      return {
        id: plane.id,
        geometry: geom,
        position: [plane.position.x, plane.position.y, plane.position.z] as [number, number, number],
        quaternion: [plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w] as [number, number, number, number],
        color: plane.color,
      };
    });
  }, [planes]);

  const handleApplyMaterial = (matType: MaterialType) => {
      if (selectedMeshId) {
          setCustomMaterials(prev => ({
              ...prev,
              [selectedMeshId]: matType
          }));
      }
  };

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-slate-900 flex flex-col">
      <div 
        className="absolute top-0 inset-x-0 p-4 md:p-6 flex flex-col md:flex-row justify-between items-start z-10 pointer-events-none gap-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 24px) + 1rem)' }}
      >
        <div className="flex gap-2 shrink-0 pointer-events-auto">
          <Button variant="outline" className="bg-black/50 border-white/10 text-white hover:bg-black/70 shadow-lg" onClick={onBack}>
            <ArrowLeft className="w-5 h-5 mr-2" />
            Rescan Room
          </Button>
          <Button variant="default" className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg border-0" onClick={() => setShowAIInsights(true)}>
            <Sparkles className="w-5 h-5 mr-2" />
            AI Insights
          </Button>
        </div>
        
        <div className="flex flex-wrap md:flex-nowrap gap-2 pointer-events-auto w-full md:w-auto">
           <div className="flex gap-2 shrink-0">
               <Button 
                  variant={viewMode === 'raw' ? 'default' : 'outline'} 
                  className={`shadow-lg transition-all ${viewMode === 'raw' ? 'bg-indigo-600 hover:bg-indigo-500 border-0' : 'bg-black/50 border-white/10 text-white hover:bg-black/70'}`}
                  onClick={() => { setViewMode('raw'); setSelectedMeshId(null); }}
               >
                  <Layers className="w-4 h-4 mr-2 hidden sm:block" />
                  Raw
               </Button>
               <Button 
                  variant={viewMode === 'enhanced' ? 'default' : 'outline'} 
                  className={`shadow-lg transition-all ${viewMode === 'enhanced' ? 'bg-indigo-600 hover:bg-indigo-500 border-0' : 'bg-black/50 border-white/10 text-white hover:bg-black/70'}`}
                  onClick={() => setViewMode('enhanced')}
               >
                  <Box className="w-4 h-4 mr-2 hidden sm:block" />
                  Solid
               </Button>
               <Button 
                  variant={viewMode === 'layout2d' ? 'default' : 'outline'} 
                  className={`shadow-lg transition-all ${viewMode === 'layout2d' ? 'bg-indigo-600 hover:bg-indigo-500 border-0' : 'bg-black/50 border-white/10 text-white hover:bg-black/70'}`}
                  onClick={() => { setViewMode('layout2d'); setSelectedMeshId(null); }}
               >
                  <Map className="w-4 h-4 mr-2 hidden sm:block" />
                  2D Layout
               </Button>
               <div className="flex gap-0 ml-auto md:ml-2 shadow-lg rounded-md overflow-hidden bg-emerald-600">
                   <Button 
                      variant="ghost"
                      className="hover:bg-emerald-500 text-white transition-all rounded-none px-3"
                      onClick={handleExportGLTF}
                      title="Export GLTF"
                   >
                      <Download className="w-4 h-4 mr-1 hidden sm:block" />
                      GLTF
                   </Button>
                   <div className="w-[1px] bg-emerald-500 my-2" />
                   <Button 
                      variant="ghost"
                      className="hover:bg-emerald-500 text-white transition-all rounded-none px-3"
                      onClick={handleExportOBJ}
                      title="Export OBJ"
                   >
                      OBJ
                   </Button>
                   <div className="w-[1px] bg-emerald-500 my-2" />
                   <Button 
                      variant="ghost"
                      className="hover:bg-emerald-500 text-white transition-all rounded-none px-3"
                      onClick={handleExportSTL}
                      title="Export STL"
                   >
                      STL
                   </Button>
                   <div className="w-[1px] bg-emerald-500 my-2" />
                   <Button 
                      variant="ghost"
                      className="hover:bg-emerald-500 text-white transition-all rounded-none px-3"
                      onClick={handleExportPLY}
                      title="Export PLY"
                   >
                      PLY
                   </Button>
               </div>
           </div>
        </div>

        <div className="bg-black/50 backdrop-blur rounded-xl p-4 border border-white/10 text-white pointer-events-auto shadow-xl hidden md:block">
            <h3 className="font-bold text-lg mb-1">3D Room Model</h3>
            <p className="text-xs text-slate-300 mb-0">({planes.length} surfaces)</p>
            {viewMode === 'enhanced' && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
                    <Paintbrush className="w-3 h-3" /> Tap to paint
                </p>
                <p className="text-xs text-slate-400">Ceiling: {((ceilingY - floorY) || 0).toFixed(2)}m</p>
              </div>
            )}
        </div>
      </div>
      
      {/* Material Toolbar */}
      {viewMode === 'enhanced' && selectedMeshId && (
          <div 
             className="absolute bottom-0 inset-x-0 mx-auto flex justify-center z-10 pointer-events-none px-4"
             style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 1.5rem)' }}
          >
              <div className="bg-black/60 backdrop-blur border border-white/10 p-3 rounded-2xl flex flex-wrap justify-center gap-2 pointer-events-auto shadow-2xl max-w-full">
                 <Button onClick={() => handleApplyMaterial('wood')} className="bg-[#8b5a2b] hover:bg-[#6b4421] text-white flex-1 min-w-[80px]">Wood</Button>
                 <Button onClick={() => handleApplyMaterial('metal')} className="bg-[#b0c4de] hover:bg-[#90a4be] text-slate-900 border border-slate-400 flex-1 min-w-[80px]">Metal</Button>
                 <Button onClick={() => handleApplyMaterial('fabric')} className="bg-[#f0e6d2] hover:bg-[#d0c6b2] text-slate-900 border border-slate-300 flex-1 min-w-[80px]">Fabric</Button>
                 <Button onClick={() => handleApplyMaterial('paint')} className="bg-[#f8f9fa] hover:bg-[#d8d9da] text-slate-900 border border-slate-300 flex-1 min-w-[80px]">Paint</Button>
                 <div className="w-px bg-white/20 mx-2 my-1 hidden sm:block" />
                 <Button onClick={() => {
                     setCustomMaterials(prev => {
                         const next = {...prev};
                         delete next[selectedMeshId];
                         return next;
                     });
                 }} variant="ghost" className="text-slate-300 hover:text-white flex-1 min-w-[80px]">Reset</Button>
              </div>
          </div>
      )}

      <div className="flex-1 w-full h-full relative cursor-move" onPointerDown={() => {
          // Deselect if clicking the background in enhanced mode
          if (viewMode === 'enhanced' && selectedMeshId) {
             // setSelectedMeshId(null);
          }
      }}>
        {viewMode === 'layout2d' && (
             <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-8 overflow-hidden touch-pinch-zoom">
                <svg 
                  viewBox={maxX !== -Infinity ? `${minX - 1} ${minZ - 1} ${maxX - minX + 2} ${maxZ - minZ + 2}` : "0 0 10 10"} 
                  className="w-full h-full max-w-5xl"
                  preserveAspectRatio="xMidYMid meet"
                >
                   {/* Floor Profile */}
                   <polygon 
                       points={floorHullPoints.map(p => `${p.x},${p.z}`).join(' ')} 
                       fill="#1e293b" 
                       stroke="#475569" 
                       strokeWidth="0.05" 
                   />

                   {/* Walls */}
                   {enhancedWalls.map(w => {
                       const angleDeg = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...w.quaternion)).y * 180 / Math.PI;
                       const isUpsideDown = angleDeg > 90 || angleDeg < -90;
                       
                       return (
                          <g key={w.id} transform={`translate(${w.position[0]}, ${w.position[2]}) rotate(${-angleDeg})`}>
                              {/* Wall line */}
                              <line x1={-w.width/2} y1={0} x2={w.width/2} y2={0} stroke="#94a3b8" strokeWidth="0.15" strokeLinecap="round" />
                              
                              {/* Wall length label */}
                              <g transform={isUpsideDown ? `rotate(180) translate(0, -0.2)` : `translate(0, -0.2)`}>
                                  <text x="0" y="0" fontSize="0.14" fill="#cbd5e1" textAnchor="middle" fontWeight="500">
                                      {w.width.toFixed(2)}m
                                  </text>
                              </g>
                          </g>
                       )
                   })}

                   {/* Features */}
                   {features.map(f => {
                       const angleDeg = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...f.quaternion)).y * 180 / Math.PI;
                       const isUpsideDown = angleDeg > 90 || angleDeg < -90;
                       const color = f.type === 'door' ? '#a78bfa' : '#38bdf8';
                       const label = f.type === 'door' ? 'Door' : 'Window';

                       return (
                          <g key={f.id} transform={`translate(${f.position[0]}, ${f.position[2]}) rotate(${-angleDeg})`}>
                              <g transform={`translate(${f.localCenter[0]}, ${f.localCenter[1]})`}>
                                 <rect 
                                    x={-f.width/2} 
                                    y={-0.08} 
                                    width={f.width} 
                                    height={0.16} 
                                    fill={color} 
                                    fillOpacity="0.2"
                                    stroke={color}
                                    strokeWidth="0.04"
                                    rx="0.02" // slightly rounded
                                 />
                                 <g transform={`rotate(${isUpsideDown ? 180 : 0}) translate(0, ${isUpsideDown ? -0.25 : -0.15})`}>
                                    <text x="0" y="0" fontSize="0.12" textAnchor="middle" fill={color} fontWeight="600">
                                        {label} ({f.width.toFixed(2)}m)
                                    </text>
                                 </g>
                              </g>
                          </g>
                       )
                   })}

                   {/* Objects */}
                   {objects && objects.map(o => {
                       const angleDeg = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...o.quaternion)).y * 180 / Math.PI;
                       const isUpsideDown = angleDeg > 90 || angleDeg < -90;
                       let color = '#f59e0b';
                       if (o.type === 'chair') color = '#f43f5e';
                       if (o.type === 'sofa') color = '#d946ef';
                       if (o.type === 'wardrobe') color = '#f97316';
                       if (o.type === 'tv') color = '#14b8a6';

                       return (
                          <g key={o.id} transform={`translate(${o.position[0]}, ${o.position[2]}) rotate(${-angleDeg})`}>
                             <rect 
                                x={-o.width/2} 
                                y={-o.depth/2} 
                                width={o.width} 
                                height={o.depth} 
                                fill={color} 
                                fillOpacity="0.2"
                                stroke={color}
                                strokeWidth="0.04"
                                strokeDasharray="0.1,0.05"
                                rx="0.05"
                             />
                             <g transform={`rotate(${isUpsideDown ? 180 : 0}) translate(0, ${isUpsideDown ? -o.depth/2 - 0.15 : -o.depth/2 - 0.05})`}>
                                <text x="0" y="0" fontSize="0.12" textAnchor="middle" fill={color} fontWeight="600">
                                    {o.type.charAt(0).toUpperCase() + o.type.slice(1)}
                                </text>
                             </g>
                          </g>
                       )
                   })}
                   
                   {/* Dimensions Overlay */}
                   {maxX !== -Infinity && (
                       <>
                         <line x1={minX} y1={minZ - 0.5} x2={maxX} y2={minZ - 0.5} stroke="#f59e0b" strokeWidth="0.02" />
                         <text x={(minX + maxX)/2} y={minZ - 0.6} fontSize="0.2" fill="#f59e0b" textAnchor="middle">W: {(maxX - minX).toFixed(2)}m</text>
                         
                         <line x1={minX - 0.5} y1={minZ} x2={minX - 0.5} y2={maxZ} stroke="#10b981" strokeWidth="0.02" />
                         <g transform={`translate(${minX - 0.6}, ${(minZ + maxZ)/2}) rotate(-90)`}>
                            <text x={0} y={0} fontSize="0.2" fill="#10b981" textAnchor="middle">L: {(maxZ - minZ).toFixed(2)}m</text>
                         </g>
                       </>
                   )}
                </svg>
             </div>
        )}
        
        {viewMode !== 'layout2d' && (
        <Canvas camera={{ position: [0, 2, 4], fov: 100 }}>
          <color attach="background" args={['#0f172a']} />
          <ambientLight 
              intensity={lighting?.ambientIntensity ?? 0.5} 
              color={lighting?.ambientColor ? new THREE.Color(lighting.ambientColor) : undefined} 
          />
          <directionalLight 
              position={lighting?.primaryLightDirection ? [lighting.primaryLightDirection[0] * 10, lighting.primaryLightDirection[1] * 10, lighting.primaryLightDirection[2] * 10] : [10, 15, 10]} 
              intensity={lighting ? Math.max(1.0, (lighting.primaryLightIntensity ?? 1.5)) : 1.5} 
              color={lighting?.primaryLightColor ? new THREE.Color(lighting.primaryLightColor) : "#ffffff"} 
              castShadow 
          />
          <directionalLight position={[-10, 5, -10]} intensity={0.5} color="#a3b8cc" />
          
          <group ref={sceneGroupRef}>
            {viewMode === 'raw' && rawPlaneMeshes.map((pm, idx) => (
              <mesh key={pm.id} geometry={pm.geometry} position={pm.position} quaternion={pm.quaternion} renderOrder={idx}>
                <meshPhysicalMaterial color={pm.color} side={THREE.DoubleSide} transparent opacity={0.8} roughness={0.2} metalness={0.1} />
                <lineSegments>
                  <edgesGeometry args={[pm.geometry]} />
                  <lineBasicMaterial color="white" linewidth={3} opacity={0.6} transparent />
                </lineSegments>
              </mesh>
            ))}

            {viewMode === 'enhanced' && (
              <React.Suspense fallback={null}>
                {/* Floor */}
                <mesh 
                   geometry={floorHull} 
                   position={[0, floorY, 0]}
                   onClick={(e) => { e.stopPropagation(); setSelectedMeshId('floor'); }}
                >
                   <meshPhysicalMaterial 
                       {...(customMaterials['floor'] ? MATERIAL_PRESETS[customMaterials['floor']] : MATERIAL_PRESETS.defaultFloor)} 
                       map={getMaterialMap(customMaterials['floor'] || 'defaultFloor')}
                       side={THREE.DoubleSide} 
                       transparent={false} 
                       opacity={1} 
                       emissive={(selectedMeshId === 'floor') ? new THREE.Color(0x333333) : new THREE.Color(0x000000)}
                   />
                   <lineSegments>
                     <edgesGeometry args={[floorHull]} />
                     <lineBasicMaterial color={(selectedMeshId === 'floor') ? '#fff' : '#000000'} linewidth={2} opacity={0.6} transparent />
                   </lineSegments>
                </mesh>

                {/* Ceiling */}
                <mesh geometry={ceilingHull} position={[0, ceilingY, 0]}>
                   <meshPhysicalMaterial 
                       color={0xf8fafc} 
                       map={plasterTexture}
                       side={THREE.DoubleSide} 
                       transparent={false} 
                       opacity={1} 
                       roughness={0.9} 
                       metalness={0.0}
                   />
                   <lineSegments>
                     <edgesGeometry args={[ceilingHull]} />
                     <lineBasicMaterial color="#000000" linewidth={2} opacity={0.6} transparent />
                   </lineSegments>
                </mesh>

                {/* Walls */}
                {enhancedWalls.map(w => (
                   <WallMesh 
                       key={w.id}
                       w={w}
                       isSelected={selectedMeshId === w.id}
                       matProps={customMaterials[w.id] ? MATERIAL_PRESETS[customMaterials[w.id]] : MATERIAL_PRESETS.defaultWall}
                       map={getMaterialMap(customMaterials[w.id])}
                       onClick={(e) => { e.stopPropagation(); setSelectedMeshId(w.id); }}
                   />
                ))}

                {/* Objects */}
                {objects && objects.map(o => {
                    let color = '#f59e0b';
                    if (o.type === 'chair') color = '#f43f5e';
                    if (o.type === 'sofa') color = '#d946ef';
                    if (o.type === 'wardrobe') color = '#f97316';
                    if (o.type === 'tv') color = '#14b8a6';
                    const isSelected = selectedMeshId === o.id;

                    return (
                        <group key={o.id} position={o.position} quaternion={o.quaternion}>
                            <mesh onClick={(e) => { e.stopPropagation(); setSelectedMeshId(o.id); }}>
                                <boxGeometry args={[o.width, o.height, o.depth]} />
                                <meshPhysicalMaterial color={color} transparent opacity={0.6} roughness={0.5} metalness={0.1} emissive={isSelected ? new THREE.Color(0x333333) : new THREE.Color(0x000000)} />
                                <lineSegments>
                                    <edgesGeometry args={[new THREE.BoxGeometry(o.width, o.height, o.depth)]} />
                                    <lineBasicMaterial color={isSelected ? '#ffffff' : color} linewidth={2} />
                                </lineSegments>
                            </mesh>
                        </group>
                    );
                })}

                {/* Overall Dimensions Annotations */}
                {maxX !== -Infinity && (
                   <group>
                      {/* Width annotation (along X) */}
                      <group position={[(minX + maxX) / 2, floorY + 0.02, minZ - 0.2]}>
                         <mesh position={[0, 0, 0]}>
                            <boxGeometry args={[maxX - minX, 0.02, 0.02]} />
                            <meshBasicMaterial color="#f59e0b" />
                         </mesh>

                      </group>

                      {/* Length annotation (along Z) */}
                      <group position={[minX - 0.2, floorY + 0.02, (minZ + maxZ) / 2]}>
                         <mesh position={[0, 0, 0]}>
                            <boxGeometry args={[0.02, 0.02, maxZ - minZ]} />
                            <meshBasicMaterial color="#10b981" />
                         </mesh>

                      </group>

                      {/* Height annotation */}
                      <group position={[maxX + 0.2, floorY + (ceilingY - floorY) / 2, (minZ + maxZ) / 2]}>
                         <mesh position={[0, 0, 0]}>
                            <boxGeometry args={[0.02, ceilingY - floorY, 0.02]} />
                            <meshBasicMaterial color="#38bdf8" />
                         </mesh>

                      </group>
                   </group>
                )}
              </React.Suspense>
            )}
          </group>

          {/* @ts-ignore */}
          <OrbitControls 
            target={[roomCenter[0], (ceilingY + floorY) / 2 || 0, roomCenter[2]]}
            makeDefault 
            autoRotate={false} 
            maxPolarAngle={Math.PI / 2 + 0.2}
            enableDamping
            dampingFactor={0.05}
          />
        </Canvas>
        )}
      </div>
      
      {viewMode !== 'layout2d' && (
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none text-slate-400 text-sm tracking-wide bg-black/40 px-6 py-2 rounded-full border border-white/5 backdrop-blur">
        Drag to rotate • Pinch to zoom
      </div>
      )}

      {showAIInsights && (
        <AIDesignInsights 
            roomData={{
                width: maxX !== -Infinity ? maxX - minX : 0,
                length: maxZ !== -Infinity ? maxZ - minZ : 0,
                height: Math.max(0, ceilingY - floorY),
                features: features
            }}
            onClose={() => setShowAIInsights(false)}
        />
      )}
    </div>
  );
}
