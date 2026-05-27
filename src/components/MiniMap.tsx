import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { RoomModel } from '../core/models/types';
import * as THREE from 'three';

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

    // Determine scale for minimap based on bounding box
    let maxDimension = 3; // Default 3 meters
    if (roomModel.floorHullPoints.length > 0) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
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
    }

    return (
        <div className={`relative ${className} overflow-hidden rounded-xl border border-white/20 bg-black/40 backdrop-blur pointer-events-auto`}>
            <div className="absolute inset-x-0 top-0 text-center text-[10px] font-semibold tracking-wider text-slate-300 bg-gradient-to-b from-black/60 to-transparent p-1 z-10">
                LIVE MODEL
            </div>
            <Canvas 
                camera={{ position: [0, maxDimension, maxDimension], fov: 50 }}
            >
                <OrbitControls autoRotate enablePan={false} enableDamping />
                {/* <ambientLight intensity={1} /> */}
                <MiniRoomView roomModel={roomModel} />
            </Canvas>
        </div>
    );
}
