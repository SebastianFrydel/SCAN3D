import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Grid, Text, Line, Html, Sphere } from '@react-three/drei';
import { RoomData, RoomFeature, Furniture } from '@/services/geminiService';
import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Download, MousePointer2, Ruler, Triangle, Trash2 } from 'lucide-react';

interface RoomModelProps {
  rooms: RoomData[];
}

interface Measurement {
  id: string;
  type: 'distance' | 'angle';
  points: THREE.Vector3[];
}

function FurnitureItem({ data, roomHeight }: { data: Furniture, roomHeight: number }) {
  const { type, position, rotation } = data;
  const floorY = -roomHeight / 2;

  let content = null;
  if (type === 'chair') {
    content = (
      <group>
        {/* Seat */}
        <Box args={[0.5, 0.05, 0.5]} position={[0, 0.45, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#8B4513" />
        </Box>
        {/* Back */}
        <Box args={[0.5, 0.5, 0.05]} position={[0, 0.7, -0.225]} castShadow receiveShadow>
          <meshStandardMaterial color="#8B4513" />
        </Box>
        {/* Legs */}
        <Box args={[0.05, 0.45, 0.05]} position={[-0.225, 0.225, -0.225]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.45, 0.05]} position={[0.225, 0.225, -0.225]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.45, 0.05]} position={[-0.225, 0.225, 0.225]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.45, 0.05]} position={[0.225, 0.225, 0.225]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
      </group>
    );
  } else if (type === 'table') {
    content = (
      <group>
        {/* Top */}
        <Box args={[1.5, 0.05, 0.8]} position={[0, 0.75, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#D2B48C" />
        </Box>
        {/* Legs */}
        <Box args={[0.05, 0.75, 0.05]} position={[-0.7, 0.375, -0.35]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.75, 0.05]} position={[0.7, 0.375, -0.35]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.75, 0.05]} position={[-0.7, 0.375, 0.35]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
        <Box args={[0.05, 0.75, 0.05]} position={[0.7, 0.375, 0.35]} castShadow receiveShadow><meshStandardMaterial color="#333" /></Box>
      </group>
    );
  } else if (type === 'sofa') {
    content = (
      <group>
        {/* Seat */}
        <Box args={[2, 0.2, 0.8]} position={[0, 0.3, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#4682B4" />
        </Box>
        {/* Back */}
        <Box args={[2, 0.6, 0.2]} position={[0, 0.7, -0.3]} castShadow receiveShadow>
          <meshStandardMaterial color="#4682B4" />
        </Box>
        {/* Arms */}
        <Box args={[0.2, 0.5, 0.8]} position={[-0.9, 0.45, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#4682B4" />
        </Box>
        <Box args={[0.2, 0.5, 0.8]} position={[0.9, 0.45, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#4682B4" />
        </Box>
      </group>
    );
  } else if (type === 'bed') {
    content = (
      <group>
        {/* Mattress */}
        <Box args={[1.6, 0.3, 2]} position={[0, 0.3, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#F0F8FF" />
        </Box>
        {/* Headboard */}
        <Box args={[1.6, 1, 0.1]} position={[0, 0.5, -0.95]} castShadow receiveShadow>
          <meshStandardMaterial color="#8B4513" />
        </Box>
      </group>
    );
  }

  return (
    <group position={[position.x, floorY, position.z]} rotation={[0, rotation * Math.PI / 180, 0]}>
      {content}
    </group>
  );
}

const createTexture = (type: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  
  if (type === 'wood') {
    ctx.fillStyle = '#d2b48c'; ctx.fillRect(0,0,512,512);
    ctx.fillStyle = '#c19a6b';
    for(let i=0; i<512; i+=20) { ctx.fillRect(0, i, 512, 4); }
  } else if (type === 'tile') {
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0,0,512,512);
    ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 8;
    ctx.strokeRect(0,0,256,256); ctx.strokeRect(256,0,256,256);
    ctx.strokeRect(0,256,256,256); ctx.strokeRect(256,256,256,256);
  } else if (type === 'brick') {
    ctx.fillStyle = '#b22222'; ctx.fillRect(0,0,512,512);
    ctx.fillStyle = '#dddddd';
    for(let y=0; y<512; y+=64) {
      ctx.fillRect(0, y, 512, 8);
      for(let x=0; x<512; x+=128) {
        ctx.fillRect(x + (y%128===0?0:64), y, 8, 64);
      }
    }
  } else if (type === 'concrete') {
    ctx.fillStyle = '#95a5a6'; ctx.fillRect(0,0,512,512);
    for(let i=0; i<5000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#7f8c8d' : '#bdc3c7';
      ctx.fillRect(Math.random()*512, Math.random()*512, 4, 4);
    }
  } else if (type === 'paint') {
    ctx.fillStyle = '#f8f9fa'; ctx.fillRect(0,0,512,512);
  } else if (type === 'carpet') {
    ctx.fillStyle = '#e0d6c8'; ctx.fillRect(0,0,512,512);
    for(let i=0; i<10000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#d5caba' : '#ebe3d8';
      ctx.fillRect(Math.random()*512, Math.random()*512, 2, 2);
    }
  }
  
  return canvas.toDataURL();
};

function Room({ data, wallMaterial, floorMaterial, position = [0, 0, 0] }: { data: RoomData, wallMaterial: string, floorMaterial: string, position?: [number, number, number] }) {
  const { width, length, height, features, furniture = [] } = data;

  const textures = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const loadTex = (type: string) => {
      const tex = loader.load(createTexture(type));
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(4, 4);
      return tex;
    };
    return {
      wood: loadTex('wood'),
      tile: loadTex('tile'),
      brick: loadTex('brick'),
      concrete: loadTex('concrete'),
      paint: loadTex('paint'),
      carpet: loadTex('carpet'),
    };
  }, []);

  const [px, py, pz] = position;
  const cx = px;
  const cz = pz;
  const cy = py + height / 2;
  const wallThickness = 0.1;

  const wallTex = textures[wallMaterial as keyof typeof textures] || textures.paint;
  const floorTex = textures[floorMaterial as keyof typeof textures] || textures.wood;

  return (
    <group position={[cx, cy, cz]}>
      {/* Floor */}
      <Plane args={[width, length]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -height / 2, 0]} receiveShadow>
        <meshStandardMaterial map={floorTex} roughness={0.8} />
      </Plane>

      {/* Walls */}
      <Box args={[width, height, wallThickness]} position={[0, 0, -length / 2]} castShadow receiveShadow>
        <meshStandardMaterial map={wallTex} roughness={0.9} />
      </Box>
      <Box args={[width, height, wallThickness]} position={[0, 0, length / 2]} castShadow receiveShadow>
        <meshStandardMaterial map={wallTex} roughness={0.9} transparent opacity={0.3} />
      </Box>
      <Box args={[wallThickness, height, length]} position={[-width / 2, 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial map={wallTex} roughness={0.9} />
      </Box>
      <Box args={[wallThickness, height, length]} position={[width / 2, 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial map={wallTex} roughness={0.9} transparent opacity={0.3} />
      </Box>

      {/* Features */}
      {features.map((feature, idx) => {
        const isDoor = feature.type === 'door';
        const color = isDoor ? "#8B4513" : "#87CEEB";
        const depth = isDoor ? 0.15 : 0.05;
        
        let x = feature.position.x;
        let y = feature.position.y;
        let z = feature.position.z;

        const distToLeft = Math.abs(x - (-width / 2));
        const distToRight = Math.abs(x - (width / 2));
        const distToBack = Math.abs(z - (-length / 2));
        const distToFront = Math.abs(z - (length / 2));

        const min = Math.min(distToLeft, distToRight, distToBack, distToFront);
        let rotation: [number, number, number] = [0, 0, 0];

        if (min === distToLeft) { x = -width / 2; rotation = [0, Math.PI / 2, 0]; }
        else if (min === distToRight) { x = width / 2; rotation = [0, -Math.PI / 2, 0]; }
        else if (min === distToBack) { z = -length / 2; rotation = [0, 0, 0]; }
        else if (min === distToFront) { z = length / 2; rotation = [0, Math.PI, 0]; }

        if (isDoor) {
          y = -height / 2 + feature.size.height / 2;
        }

        return (
          <group key={idx} position={[x, y, z]} rotation={rotation}>
            <Box args={[feature.size.width, feature.size.height, depth]} castShadow>
              <meshStandardMaterial color={color} opacity={isDoor ? 1 : 0.6} transparent={!isDoor} />
            </Box>
            <Text position={[0, feature.size.height / 2 + 0.2, 0]} fontSize={0.2} color="black" anchorX="center" anchorY="middle">
              {feature.type}
            </Text>
          </group>
        );
      })}

      {/* Furniture */}
      {furniture.map(f => (
        <FurnitureItem key={f.id} data={f} roomHeight={height} />
      ))}
    </group>
  );
}

export function RoomModel({ rooms }: RoomModelProps) {
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const roomsGroupRef = React.useRef<THREE.Group>(null);
  const [wallMaterial, setWallMaterial] = useState('paint');
  const [floorMaterial, setFloorMaterial] = useState('wood');

  const [activeTool, setActiveTool] = useState<'view' | 'distance' | 'angle'>('view');
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [currentPoints, setCurrentPoints] = useState<THREE.Vector3[]>([]);

  const handlePointerDown = (e: any) => {
    if (activeTool === 'view') return;
    e.stopPropagation();
    
    // Copy the intersection point precisely 
    const p = e.point.clone();
    
    if (activeTool === 'distance') {
      if (currentPoints.length === 0) {
        setCurrentPoints([p]);
      } else {
        setMeasurements([...measurements, { id: Math.random().toString(), type: 'distance', points: [currentPoints[0], p] }]);
        setCurrentPoints([]);
      }
    } else if (activeTool === 'angle') {
      if (currentPoints.length < 2) {
        setCurrentPoints([...currentPoints, p]);
      } else {
        setMeasurements([...measurements, { id: Math.random().toString(), type: 'angle', points: [currentPoints[0], currentPoints[1], p] }]);
        setCurrentPoints([]);
      }
    }
  };

  const handleDownload = () => {
    if (!roomsGroupRef.current) return;
    const exporter = new OBJExporter();
    const result = exporter.parse(roomsGroupRef.current);
    const blob = new Blob([result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = 'floor_plan.obj';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculate bounding box for camera positioning
  let minX = 0, maxX = 0;
  let minZ = 0, maxZ = 0;
  let maxHeight = 0;
  
  if (rooms.length > 0) {
    minX = rooms[0].position?.x || 0;
    maxX = rooms[0].position?.x || 0;
    minZ = rooms[0].position?.z || 0;
    maxZ = rooms[0].position?.z || 0;

    rooms.forEach(r => {
      const x = r.position?.x || 0;
      const z = r.position?.z || 0;
      minX = Math.min(minX, x - r.width / 2);
      maxX = Math.max(maxX, x + r.width / 2);
      minZ = Math.min(minZ, z - r.length / 2);
      maxZ = Math.max(maxZ, z + r.length / 2);
      maxHeight = Math.max(maxHeight, r.height);
    });
  }

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const totalWidth = maxX - minX || 5;
  const totalLength = maxZ - minZ || 5;
  const camDistance = Math.max(totalWidth, totalLength) * 1.5;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border">
        <div className="space-y-2">
          <Label>Wall Material</Label>
          <Select value={wallMaterial} onValueChange={setWallMaterial}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="paint">Paint</SelectItem>
              <SelectItem value="brick">Brick</SelectItem>
              <SelectItem value="concrete">Concrete</SelectItem>
              <SelectItem value="wood">Wood Paneling</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Floor Material</Label>
          <Select value={floorMaterial} onValueChange={setFloorMaterial}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wood">Hardwood</SelectItem>
              <SelectItem value="tile">Tile</SelectItem>
              <SelectItem value="carpet">Carpet</SelectItem>
              <SelectItem value="concrete">Concrete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-xl border">
        <Button variant={activeTool === 'view' ? 'default' : 'outline'} size="sm" onClick={() => { setActiveTool('view'); setCurrentPoints([]); }}>
          <MousePointer2 className="w-4 h-4 mr-2" /> Orbit & View
        </Button>
        <Button variant={activeTool === 'distance' ? 'default' : 'outline'} size="sm" onClick={() => { setActiveTool('distance'); setCurrentPoints([]); }}>
          <Ruler className="w-4 h-4 mr-2" /> Measure Length
        </Button>
        <Button variant={activeTool === 'angle' ? 'default' : 'outline'} size="sm" onClick={() => { setActiveTool('angle'); setCurrentPoints([]); }}>
          <Triangle className="w-4 h-4 mr-2" /> Measure Angle
        </Button>
        {measurements.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setMeasurements([])} className="ml-auto">
            <Trash2 className="w-4 h-4 mr-2" /> Clear All
          </Button>
        )}
      </div>

      <div className="w-full h-[400px] bg-slate-100 rounded-xl overflow-hidden border">
        <Canvas 
          shadows 
          camera={{ position: [centerX + camDistance * 0.8, Math.max(maxHeight * 2, camDistance * 0.8), centerZ + camDistance * 0.8], fov: 50 }}
          onCreated={({ scene }) => setScene(scene)}
        >
          <React.Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <Grid infiniteGrid fadeDistance={50} cellColor="#cccccc" sectionColor="#aaaaaa" />
            
            <group ref={roomsGroupRef} onPointerDown={handlePointerDown}>
              {rooms.map((room, index) => {
                const xOffset = room.position?.x || 0;
                const zOffset = room.position?.z || 0;
                return (
                  <Room 
                    key={room.id} 
                    data={room} 
                    wallMaterial={wallMaterial} 
                    floorMaterial={floorMaterial} 
                    position={[xOffset, 0, zOffset]} 
                  />
                );
              })}
            </group>

            {/* Display active points being placed */}
            {currentPoints.map((p, i) => (
              <Sphere key={i} args={[0.05]} position={p}>
                <meshBasicMaterial color="red" />
              </Sphere>
            ))}
            {currentPoints.length === 2 && activeTool === 'angle' && (
              <Line points={[currentPoints[0], currentPoints[1]]} color="orange" lineWidth={2} />
            )}

            {/* Display saved measurements */}
            {measurements.map(m => {
              if (m.type === 'distance') {
                const dist = m.points[0].distanceTo(m.points[1]);
                const midPoint = m.points[0].clone().lerp(m.points[1], 0.5);
                return (
                  <group key={m.id}>
                    <Line points={[m.points[0], m.points[1]]} color="magenta" lineWidth={3} />
                    <Sphere args={[0.05]} position={m.points[0]}><meshBasicMaterial color="magenta" /></Sphere>
                    <Sphere args={[0.05]} position={m.points[1]}><meshBasicMaterial color="magenta" /></Sphere>
                    <Html position={midPoint} center zIndexRange={[100, 0]}>
                      <div className="bg-slate-900/90 text-white text-xs font-mono px-2 py-1 rounded shadow pointer-events-none whitespace-nowrap border border-slate-700">
                        {dist.toFixed(2)}m
                      </div>
                    </Html>
                  </group>
                );
              } else if (m.type === 'angle') {
                const p1 = m.points[0];
                const p2 = m.points[1]; // Vertex
                const p3 = m.points[2];
                
                const v1 = p1.clone().sub(p2).normalize();
                const v2 = p3.clone().sub(p2).normalize();
                const angleRad = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
                const angleDeg = (angleRad * 180 / Math.PI).toFixed(1);
                
                // Label positioning slightly outwards from the vertex
                const midDir = v1.clone().add(v2).normalize().multiplyScalar(0.5);
                const labelPos = p2.clone().add(midDir);

                return (
                  <group key={m.id}>
                    <Line points={[p1, p2, p3]} color="orange" lineWidth={3} />
                    <Sphere args={[0.05]} position={p1}><meshBasicMaterial color="orange" /></Sphere>
                    <Sphere args={[0.05]} position={p2}><meshBasicMaterial color="orange" /></Sphere>
                    <Sphere args={[0.05]} position={p3}><meshBasicMaterial color="orange" /></Sphere>
                    <Html position={labelPos} center zIndexRange={[100, 0]}>
                      <div className="bg-slate-900/90 text-white text-xs font-mono px-2 py-1 rounded shadow pointer-events-none whitespace-nowrap border border-slate-700">
                        {angleDeg}°
                      </div>
                    </Html>
                  </group>
                );
              }
              return null;
            })}
            
            <OrbitControls makeDefault target={[centerX, 0, centerZ]} enabled={activeTool === 'view'} />
          </React.Suspense>
        </Canvas>
      </div>
      <Button onClick={handleDownload} variant="outline" className="w-full">
        <Download className="w-4 h-4 mr-2" /> Download 3D Model (.obj)
      </Button>
    </div>
  );
}
