import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { RoomModel } from '../core/models/types';
import * as THREE from 'three';
import { Map, Box } from 'lucide-react';

function MiniRoomView({ roomModel }: { roomModel: RoomModel }) {
    const floorShape = React.useMemo(() => {
        if (!roomModel) return null;
        const shape = new THREE.Shape();
        if (roomModel.floorHullPoints.length > 0) {
            shape.moveTo(roomModel.floorHullPoints[0].x, -roomModel.floorHullPoints[0].z);
            for (let i = 1; i < roomModel.floorHullPoints.length; i++) {
                shape.lineTo(roomModel.floorHullPoints[i].x, -roomModel.floorHullPoints[i].z);
            }
        }
        return shape;
    }, [roomModel]);

    if (!roomModel) return null;

    // Center the model in the view
    const [cx, cy, cz] = roomModel.roomCenter;

    return (
        <group>
            <group position={[-cx, -cy, -cz]}>
                {/* Walls */}
                {roomModel.enhancedWalls.map(w => (
                    <mesh key={w.id} position={w.position} quaternion={w.quaternion}>
                        <planeGeometry args={[w.width, w.height]} />
                        <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} transparent opacity={0.3} depthWrite={false} />
                        <lineSegments>
                            <edgesGeometry args={[new THREE.PlaneGeometry(w.width, w.height)]} />
                            <lineBasicMaterial color="#38bdf8" linewidth={2} />
                        </lineSegments>
                    </mesh>
                ))}

                {/* Floor surface */}
                {floorShape && (
                    <mesh position={[0, roomModel.floorY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <shapeGeometry args={[floorShape]} />
                        <meshBasicMaterial color="#10b981" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
                        <lineSegments>
                            <edgesGeometry args={[new THREE.ShapeGeometry(floorShape)]} />
                            <lineBasicMaterial color="#10b981" linewidth={2} />
                        </lineSegments>
                    </mesh>
                )}

                {/* Ceiling surface (if bounding hull present) */}
                {floorShape && roomModel.ceilingY > roomModel.floorY + 0.1 && (
                    <mesh position={[0, roomModel.ceilingY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <shapeGeometry args={[floorShape]} />
                        <meshBasicMaterial color="#64748b" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
                        <lineSegments>
                            <edgesGeometry args={[new THREE.ShapeGeometry(floorShape)]} />
                            <lineBasicMaterial color="#64748b" linewidth={1} />
                        </lineSegments>
                    </mesh>
                )}

                {/* Features (Doors/Windows) */}
                {roomModel.features.map(f => (
                    <group key={f.id} position={f.position} quaternion={f.quaternion}>
                        <mesh position={[f.localCenter[0], 0, f.localCenter[1]]} rotation={[-Math.PI / 2, 0, 0]}>
                            <planeGeometry args={[f.width, f.height]} />
                            <meshBasicMaterial color={f.type === 'door' ? "#8b5cf6" : "#fcd34d"} side={THREE.DoubleSide} transparent opacity={0.6} />
                        </mesh>
                    </group>
                ))}
                
                {/* Objects (if any later on) */}
                {roomModel.objects.map(obj => (
                    <mesh key={obj.id} position={obj.position} quaternion={obj.quaternion}>
                        <boxGeometry args={[obj.width, obj.height, obj.depth]} />
                        <meshBasicMaterial color="#f43f5e" transparent opacity={0.5} wireframe />
                    </mesh>
                ))}
            </group>
        </group>
    );
}

export function MiniMap({ roomModel, className = "" }: { roomModel: RoomModel | null, className?: string }) {
    if (!roomModel || (roomModel.enhancedWalls.length === 0 && roomModel.floorHullPoints.length === 0)) {
        return null;
    }

    const [viewMode, setViewMode] = React.useState<'2d' | '3d'>('2d');

    // Determine scale for minimap based on bounding box
    let maxDimension = 3; // Default 3 meters
    let minX = -2, maxX = 2, minZ = -2, maxZ = 2;
    if (roomModel.floorHullPoints.length > 0) {
        minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;
        roomModel.floorHullPoints.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });
        const w = maxX - minX;
        const h = maxZ - minZ;
        const expected = Math.max(w, h, roomModel.ceilingY - roomModel.floorY);
        maxDimension = Math.min(15, Math.max(2, expected));

        const padX = Math.max(0.4, w * 0.15);
        const padZ = Math.max(0.4, h * 0.15);
        minX -= padX;
        maxX += padX;
        minZ -= padZ;
        maxZ += padZ;
    }

    const width = maxX - minX;
    const height = maxZ - minZ;

    const render2DPlan = () => {
        if (!roomModel) return null;
        return (
            <svg 
                viewBox={`${minX} ${minZ} ${width} ${height}`} 
                className="w-full h-full p-2"
                preserveAspectRatio="xMidYMid meet"
            >
                {/* Estimated Room Boundaries (Floor Hull) */}
                {roomModel.floorHullPoints && roomModel.floorHullPoints.length > 0 && (
                    <polygon 
                        points={roomModel.floorHullPoints.map(p => `${p.x},${p.z}`).join(' ')} 
                        fill="rgba(16, 185, 129, 0.12)" 
                        stroke="#10b981" 
                        strokeWidth="0.05" 
                        strokeDasharray="0.08,0.04"
                    />
                )}

                {/* Walls */}
                {roomModel.enhancedWalls && roomModel.enhancedWalls.map(w => {
                    const wallEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...w.quaternion));
                    const angleDeg = wallEuler.y * 180 / Math.PI;
                    return (
                       <g key={w.id} transform={`translate(${w.position[0]}, ${w.position[2]}) rotate(${-angleDeg})`}>
                           <line x1={-w.width/2} y1={0} x2={w.width/2} y2={0} stroke="#38bdf8" strokeWidth="0.12" strokeLinecap="round" />
                       </g>
                    );
                })}

                {/* Openings (Doors/Windows) */}
                {roomModel.features && roomModel.features.map(f => {
                    const featEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...f.quaternion));
                    const angleDeg = featEuler.y * 180 / Math.PI;
                    const color = f.type === 'door' ? '#c084fc' : '#38bdf8';
                    return (
                       <g key={f.id} transform={`translate(${f.position[0]}, ${f.position[2]}) rotate(${-angleDeg})`}>
                           <rect 
                              x={-f.width/2} 
                              y={-0.03} 
                              width={f.width} 
                              height={0.06} 
                              fill={color} 
                              stroke={color}
                              strokeWidth="0.02"
                              rx="0.01"
                           />
                       </g>
                    );
                })}

                {/* Furniture Objects */}
                {roomModel.objects && roomModel.objects.map(o => {
                    const objEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...o.quaternion));
                    const angleDeg = objEuler.y * 180 / Math.PI;
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
                             fillOpacity="0.1"
                             stroke={color}
                             strokeWidth="0.02"
                             strokeDasharray="0.04,0.02"
                             rx="0.02"
                          />
                       </g>
                    );
                })}

                {/* Corners (vertices of floorHullPoints) */}
                {roomModel.floorHullPoints && roomModel.floorHullPoints.map((p, idx) => (
                    <circle 
                        key={`corner-${idx}`} 
                        cx={p.x} 
                        cy={p.z} 
                        r="0.08" 
                        fill="#10b981" 
                        stroke="#ffffff" 
                        strokeWidth="0.02"
                    />
                ))}
            </svg>
        );
    };

    return (
        <div className={`relative ${className} overflow-hidden rounded-xl border border-white/20 bg-black/60 backdrop-blur pointer-events-auto flex flex-col`}>
            {/* Header controls */}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-2 z-10">
                <span className="text-[9px] font-extrabold tracking-wider text-slate-300 uppercase">
                    {viewMode === '2d' ? '2D FLOOR PLAN' : '3D LIVE MODEL'}
                </span>
                
                <div className="flex bg-slate-900/80 border border-white/10 rounded-lg p-0.5">
                    <button
                        onClick={() => setViewMode('2d')}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1 transition-all ${
                            viewMode === '2d' 
                                ? 'bg-indigo-600 text-white shadow' 
                                : 'text-slate-400 hover:text-white bg-transparent'
                        }`}
                        title="2D Floor Plan View"
                    >
                        <Map className="w-2.5 h-2.5" />
                        2D
                    </button>
                    <button
                        onClick={() => setViewMode('3d')}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1 transition-all ${
                            viewMode === '3d' 
                                ? 'bg-indigo-600 text-white shadow' 
                                : 'text-slate-400 hover:text-white bg-transparent'
                        }`}
                        title="3D Orthographic View"
                    >
                        <Box className="w-2.5 h-2.5" />
                        3D
                    </button>
                </div>
            </div>

            {/* View contents */}
            <div className="w-full h-full pt-6 flex items-center justify-center min-h-[140px]">
                {viewMode === '2d' ? (
                    <div className="w-full h-full flex items-center justify-center p-1">
                        {render2DPlan()}
                    </div>
                ) : (
                    <Canvas 
                        camera={{ position: [0, maxDimension, maxDimension], fov: 50 }}
                    >
                        <OrbitControls autoRotate enablePan={false} enableDamping />
                        <MiniRoomView roomModel={roomModel} />
                    </Canvas>
                )}
            </div>
        </div>
    );
}
