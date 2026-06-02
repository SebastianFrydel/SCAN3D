import React, { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { ScannedPlane } from './ARScanner';
import { Button } from './ui/button';
import { ArrowLeft, Layers, Box, Paintbrush, Camera } from 'lucide-react';

function getConvexHull(points: {x: number, z: number}[]): {x: number, z: number}[] {
    if (points.length < 3) return points;
    // Sort points lexicographically
    const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.z - b.z);

    const cross = (o: {x: number, z: number}, a: {x: number, z: number}, b: {x: number, z: number}) => {
        return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    };

    const lower = [];
    for (let i = 0; i < sorted.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
            lower.pop();
        }
        lower.push(sorted[i]);
    }

    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
            upper.pop();
        }
        upper.push(sorted[i]);
    }

    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

const MATERIAL_PRESETS = {
  defaultFloor: { color: 0x10b981, roughness: 0.2, metalness: 0.1, clearcoat: 0.0 },
  defaultWall: { color: 0x3b82f6, roughness: 0.2, metalness: 0.1, clearcoat: 0.0 },
  wood: { color: '#8b5a2b', roughness: 0.8, metalness: 0.1, clearcoat: 0.1 },
  metal: { color: '#b0c4de', roughness: 0.2, metalness: 0.9, clearcoat: 0.5 },
  fabric: { color: '#f0e6d2', roughness: 1.0, metalness: 0.0, clearcoat: 0.0 },
  paint: { color: '#f8f9fa', roughness: 0.9, metalness: 0.0, clearcoat: 0.0 }
};

type MaterialType = keyof typeof MATERIAL_PRESETS;

export function RoomViewer({ planes, onBack }: { planes: ScannedPlane[], onBack: () => void }) {
  const [viewMode, setViewMode] = useState<'raw' | 'enhanced'>('enhanced');
  const [selectedMeshId, setSelectedMeshId] = useState<string | null>(null);
  const [customMaterials, setCustomMaterials] = useState<Record<string, MaterialType>>({});

  // Process data for the enhanced view
  const { enhancedWalls, floorHull, ceilingHull, floorY, ceilingY, roomCenter } = useMemo(() => {
    let globalMinY = Infinity;
    let globalMaxY = -Infinity;

    const globalPlanes = planes.map(plane => {
        const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(plane.position.x, plane.position.y, plane.position.z),
            new THREE.Quaternion(plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w),
            new THREE.Vector3(1, 1, 1)
        );
        const globalPoints = plane.polygon.map(p => {
            return new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(matrix);
        });
        
        let minY = Infinity, maxY = -Infinity;
        globalPoints.forEach(p => {
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        });

        globalMinY = Math.min(globalMinY, minY);
        globalMaxY = Math.max(globalMaxY, maxY);

        return { ...plane, matrix, globalPoints, minY, maxY };
    });

    const horizontalPlanes = globalPlanes.filter(p => p.orientation?.toLowerCase() === 'horizontal');
    const verticalPlanes = globalPlanes.filter(p => p.orientation?.toLowerCase() === 'vertical');

    let fY = 0;
    let cY = 2.5;

    if (horizontalPlanes.length > 0) {
        horizontalPlanes.sort((a, b) => a.position.y - b.position.y);
        fY = horizontalPlanes[0].position.y;
        if (horizontalPlanes.length > 1 && horizontalPlanes[horizontalPlanes.length - 1].position.y > fY + 1.5) {
            cY = horizontalPlanes[horizontalPlanes.length - 1].position.y;
        } else {
            let maxWallY = -Infinity;
            verticalPlanes.forEach(p => { maxWallY = Math.max(maxWallY, p.maxY); });
            cY = maxWallY !== -Infinity ? Math.max(fY + 2.0, maxWallY) : fY + 2.5;
        }
    } else if (verticalPlanes.length > 0) {
        let minWallY = Infinity;
        let maxWallY = -Infinity;
        verticalPlanes.forEach(p => {
            minWallY = Math.min(minWallY, p.minY);
            maxWallY = Math.max(maxWallY, p.maxY);
        });
        fY = minWallY !== Infinity ? minWallY : 0;
        cY = maxWallY !== -Infinity ? Math.max(fY + 2.0, maxWallY) : fY + 2.5;
    } else {
      fY = globalMinY !== Infinity ? globalMinY : 0;
      cY = globalMaxY !== -Infinity ? Math.max(fY + 2.0, globalMaxY) : 2.5;
    }

    const allXZPoints: {x: number, z: number}[] = [];
    globalPlanes.forEach(p => {
        p.globalPoints.forEach(pt => {
            allXZPoints.push({ x: pt.x, z: pt.z });
        });
    });

    const hull = getConvexHull(allXZPoints);
    let rCX = 0, rCZ = 0;
    
    // Create shapes for hull
    let floorShape = new THREE.Shape();
    let ceilShape = new THREE.Shape();
    if (hull.length >= 3) {
        hull.forEach((p, i) => {
            rCX += p.x;
            rCZ += p.z;
            if (i === 0) {
                floorShape.moveTo(p.x, -p.z);
                ceilShape.moveTo(p.x, -p.z);
            } else {
                floorShape.lineTo(p.x, -p.z);
                ceilShape.lineTo(p.x, -p.z);
            }
        });
        rCX /= hull.length;
        rCZ /= hull.length;
    } else { // fallback
       floorShape.moveTo(-1, -1); floorShape.lineTo(1, -1); floorShape.lineTo(1, 1); floorShape.lineTo(-1, 1);
       ceilShape.moveTo(-1, -1); ceilShape.lineTo(1, -1); ceilShape.lineTo(1, 1); ceilShape.lineTo(-1, 1);
    }
    
    const fGeom = new THREE.ShapeGeometry(floorShape);
    fGeom.rotateX(-Math.PI / 2); // local flat to XZ
    const cGeom = new THREE.ShapeGeometry(ceilShape);
    cGeom.rotateX(-Math.PI / 2);

    const enhancedWallsData: { id: string, width: number, height: number, position: [number, number, number], quaternion: [number, number, number, number], color: number }[] = [];
    if (hull.length >= 3) {
        for (let i = 0; i < hull.length; i++) {
            const p1 = hull[i];
            const p2 = hull[(i + 1) % hull.length];
            
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const width = Math.hypot(dx, dz);
            const height = cY - fY;
            
            const midX = (p1.x + p2.x) / 2;
            const midZ = (p1.z + p2.z) / 2;
            const cy = (cY + fY) / 2;
            
            const theta = -Math.atan2(dz, dx);
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);
            
            enhancedWallsData.push({
                id: 'hull_wall_' + i,
                width,
                height,
                position: [midX, cy, midZ] as [number, number, number],
                quaternion: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
                color: 0x3b82f6
            });
        }
    }

    return { 
        enhancedWalls: enhancedWallsData, 
        floorHull: fGeom, 
        ceilingHull: cGeom, 
        floorY: fY, 
        ceilingY: cY,
        roomCenter: [rCX, 0, rCZ] as [number, number, number]
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

  const enhancedWallGeometries = useMemo(() => {
    return enhancedWalls.map(w => ({
      id: w.id,
      geometry: new THREE.PlaneGeometry(w.width, w.height)
    }));
  }, [enhancedWalls]);
  const enhancedWallGeometryMap = useMemo(() => {
    return new Map(enhancedWallGeometries.map((wg) => [wg.id, wg.geometry]));
  }, [enhancedWallGeometries]);

  useEffect(() => {
    return () => {
      floorHull.dispose();
      ceilingHull.dispose();
      rawPlaneMeshes.forEach((pm) => pm.geometry.dispose());
      enhancedWallGeometries.forEach((wg) => {
        wg.geometry.dispose();
      });
    };
  }, [floorHull, ceilingHull, rawPlaneMeshes, enhancedWallGeometries]);

  const handleApplyMaterial = (matType: MaterialType) => {
      if (selectedMeshId) {
          setCustomMaterials(prev => ({
              ...prev,
              [selectedMeshId]: matType
          }));
      }
  };

  return (
    <div className="absolute inset-0 bg-slate-900 flex flex-col">
      <div className="absolute top-0 inset-x-0 p-4 md:p-6 flex flex-col md:flex-row justify-between items-start z-10 pointer-events-none gap-4">
        <Button variant="outline" className="bg-black/50 border-white/10 text-white hover:bg-black/70 pointer-events-auto shadow-lg shrink-0" onClick={onBack}>
          <ArrowLeft className="w-5 h-5 mr-2" />
          Rescan Room
        </Button>
        
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
          <div className="absolute bottom-6 inset-x-0 mx-auto flex justify-center z-10 pointer-events-none px-4">
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
        <Canvas dpr={[1.5, 2.5]} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ position: [roomCenter[0], (ceilingY - floorY) * 1.5 || 3, roomCenter[2] + 4], fov: 100 }}>
          <color attach="background" args={['#0f172a']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 15, 10]} intensity={1.5} color="#ffffff" castShadow />
          <directionalLight position={[-10, 5, -10]} intensity={0.5} color="#a3b8cc" />
          
          <group>
            {viewMode === 'raw' && rawPlaneMeshes.map((pm, idx) => (
              <mesh key={pm.id} geometry={pm.geometry} position={pm.position} quaternion={pm.quaternion} renderOrder={idx}>
                <meshPhysicalMaterial color={pm.color} side={THREE.DoubleSide} transparent opacity={0.8} roughness={0.2} metalness={0.1} />
                <lineSegments>
                  <edgesGeometry args={[pm.geometry]} />
                  <lineBasicMaterial color="white" linewidth={3} opacity={0.6} transparent />
                </lineSegments>
              </mesh>
            ))}

            {viewMode === 'enhanced' && (() => {
                const floorMatProps = customMaterials['floor'] ? MATERIAL_PRESETS[customMaterials['floor']] : MATERIAL_PRESETS.defaultFloor;
                const isFloorSelected = selectedMeshId === 'floor';

                return (
                  <>
                     {/* Floor */}
                     <mesh 
                        geometry={floorHull} 
                        position={[0, floorY, 0]}
                        onClick={(e) => { e.stopPropagation(); setSelectedMeshId('floor'); }}
                     >
                        <meshPhysicalMaterial 
                            {...floorMatProps} 
                            side={THREE.DoubleSide} 
                            transparent={false} 
                            opacity={1} 
                            emissive={isFloorSelected ? new THREE.Color(0x333333) : new THREE.Color(0x000000)}
                        />
                        <lineSegments>
                          <edgesGeometry args={[floorHull]} />
                          <lineBasicMaterial color={isFloorSelected ? '#fff' : '#10b981'} linewidth={3} opacity={isFloorSelected ? 1 : 0.6} transparent />
                        </lineSegments>
                     </mesh>

                     {/* Ceiling */}
                     <mesh geometry={ceilingHull} position={[0, ceilingY, 0]}>
                        <meshPhysicalMaterial color={0x10b981} side={THREE.DoubleSide} transparent opacity={0.1} roughness={0.2} metalness={0.1} />
                     </mesh>

                     {/* Walls */}
                     {enhancedWalls.map(w => {
                        const matProps = customMaterials[w.id] ? MATERIAL_PRESETS[customMaterials[w.id]] : MATERIAL_PRESETS.defaultWall;
                        const isSelected = selectedMeshId === w.id;
                        const wallGeometry = enhancedWallGeometryMap.get(w.id);
                        if (!wallGeometry) return null;

                        return (
                          <group key={w.id} position={w.position} quaternion={w.quaternion}>
                            <mesh 
                                rotation={[-Math.PI / 2, 0, 0]}
                                onClick={(e) => { e.stopPropagation(); setSelectedMeshId(w.id); }}
                                geometry={wallGeometry}
                            >
                               <meshPhysicalMaterial 
                                    {...matProps} 
                                    side={THREE.DoubleSide} 
                                    transparent={false} 
                                    opacity={1} 
                                    emissive={isSelected ? new THREE.Color(0x333333) : new THREE.Color(0x000000)}
                               />
                               <lineSegments>
                                 <edgesGeometry args={[wallGeometry]} />
                                 <lineBasicMaterial color={isSelected ? '#fff' : '#3b82f6'} linewidth={3} opacity={isSelected ? 1 : 0.6} transparent />
                               </lineSegments>
                            </mesh>
                          </group>
                        );
                     })}
                  </>
                );
            })()}
          </group>

          <Grid infiniteGrid fadeDistance={30} sectionColor="#475569" cellColor="#1e293b" position={[0, floorY - 0.1, 0]} />
          
          {/* @ts-ignore */}
          <OrbitControls 
            target={[roomCenter[0], (ceilingY + floorY) / 2 || 0, roomCenter[2]]}
            makeDefault 
            autoRotate={false} 
            maxPolarAngle={Math.PI / 2 + 0.2}
            enableDamping
            dampingFactor={0.05}
          />
          <Environment preset="city" />
        </Canvas>
      </div>
      
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none text-slate-400 text-sm tracking-wide bg-black/40 px-6 py-2 rounded-full border border-white/5 backdrop-blur">
        Drag to rotate • Pinch to zoom
      </div>
    </div>
  );
}
