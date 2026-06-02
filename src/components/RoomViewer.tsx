import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { ScannedPlane } from './ARScanner';
import { Button } from './ui/button';
import { ArrowLeft, Layers, Box, Paintbrush, Download, Map, Sparkles } from 'lucide-react';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RawPlane, RoomLighting } from '../core/models/types';
import { AIDesignInsights } from './AIDesignInsights';

const MATERIAL_PRESETS = {
  defaultFloor: { color: 0xe2e8f0, roughness: 0.2, metalness: 0.05, clearcoat: 0.3 },
  defaultWall: { color: 0x3b82f6, roughness: 0.4, metalness: 0.1, clearcoat: 0.0 },
  wood: { color: 0x8b5a2b, roughness: 0.7, metalness: 0.1, clearcoat: 0.2 },
  metal: { color: 0xb0c4de, roughness: 0.1, metalness: 0.9, clearcoat: 0.6 },
  fabric: { color: 0xf0e6d2, roughness: 0.95, metalness: 0.0, clearcoat: 0.0 },
  paint: { color: 0xf8f9fa, roughness: 0.85, metalness: 0.0, clearcoat: 0.0 }
};

type MaterialType = keyof typeof MATERIAL_PRESETS;

export function RoomViewer({ planes, lighting, onBack }: { planes: ScannedPlane[], lighting?: RoomLighting, onBack: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'enhanced' | 'layout2d'>('enhanced');
  const [selectedMeshId, setSelectedMeshId] = useState<string | null>(null);
  const [customMaterials, setCustomMaterials] = useState<Record<string, MaterialType>>({});
  const [showAIInsights, setShowAIInsights] = useState(false);
  const sceneGroupRef = useRef<THREE.Group | null>(null);

  // Textures generator
  const tileTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 512;
     canvas.height = 512;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         ctx.fillStyle = '#cbd5e1'; 
         ctx.fillRect(0, 0, 512, 512);
         ctx.fillStyle = '#f8fafc';
         ctx.fillRect(8, 8, 496, 496);
     }
     const texture = new THREE.CanvasTexture(canvas);
     texture.wrapS = THREE.RepeatWrapping;
     texture.wrapT = THREE.RepeatWrapping;
     texture.colorSpace = THREE.SRGBColorSpace;
     texture.repeat.set(4, 4);
     return texture;
  }, []);

  const woodTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 512;
     canvas.height = 512;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         ctx.fillStyle = '#b5835a';
         ctx.fillRect(0, 0, 512, 512);
         ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
         for (let i = 0; i < 500; i++) {
             ctx.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 100 + 30, 2);
         }
         ctx.strokeStyle = '#5c4033';
         ctx.lineWidth = 3;
         for (let y = 0; y < 512; y += 64) {
             ctx.beginPath();
             ctx.moveTo(0, y);
             ctx.lineTo(512, y);
             ctx.stroke();
         }
     }
     const texture = new THREE.CanvasTexture(canvas);
     texture.wrapS = THREE.RepeatWrapping;
     texture.wrapT = THREE.RepeatWrapping;
     texture.colorSpace = THREE.SRGBColorSpace;
     texture.repeat.set(2, 2);
     return texture;
  }, []);

  const plasterTexture = useMemo(() => {
     const canvas = document.createElement('canvas');
     canvas.width = 256;
     canvas.height = 256;
     const ctx = canvas.getContext('2d');
     if (ctx) {
         ctx.fillStyle = '#f1f5f9';
         ctx.fillRect(0, 0, 256, 256);
         const imgData = ctx.getImageData(0, 0, 256, 256);
         for (let i = 0; i < imgData.data.length; i += 4) {
             const noise = (Math.random() - 0.5) * 8;
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
     return texture;
  }, []);

  const getMaterialMap = (matType?: MaterialType) => {
      if (matType === 'wood') return woodTexture;
      if (matType === 'paint') return plasterTexture;
      if (matType === 'defaultFloor') return tileTexture;
      return null;
  };

  const scanStats = useMemo(() => {
    const confidentPlanes = planes.filter((plane) => (plane.confidence ?? 0) >= 45);
    const averageConfidence = planes.length
      ? planes.reduce((sum, plane) => sum + (plane.confidence ?? 0), 0) / planes.length
      : 0;
    const sensorSamples = planes.filter((plane) => plane.sensor).length;
    const depthSamples = planes.filter((plane) => plane.depthActive).length;

    return {
      confidentPlanes: confidentPlanes.length,
      averageConfidence,
      sensorSamples,
      depthSamples
    };
  }, [planes]);

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

    return { 
        enhancedWalls: model.enhancedWalls, 
        features: model.features,
        objects: model.objects,
        floorHullPoints: model.floorHullPoints,
        floorY: model.floorY, 
        ceilingY: model.ceilingY,
        roomCenter: model.roomCenter,
        minX: minX === Infinity ? -2 : minX,
        maxX: maxX === -Infinity ? 2 : maxX,
        minZ: minZ === Infinity ? -2 : minZ,
        maxZ: maxZ === -Infinity ? 2 : maxZ
    };
  }, [planes]);

  const { minX, maxX, minZ, maxZ, floorHullPoints, enhancedWalls, features, objects, ceilingY, floorY, roomCenter } = modelData;

  // Render standard manual loop
  useEffect(() => {
    if (viewMode === 'layout2d') return;
    if (!containerRef.current) return;
    const container = containerRef.current;

    // SCENE & CAMERA Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneGroupRef.current = new THREE.Group();
    scene.add(sceneGroupRef.current);

    const camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(roomCenter[0], (ceilingY + floorY) / 2 + 1.5, roomCenter[2] + 4.5);

    // LIGHTING System
    const ambientLight = new THREE.AmbientLight(
        lighting?.ambientColor ? new THREE.Color(lighting.ambientColor) : 0xffffff,
        lighting?.ambientIntensity ?? 0.6
    );
    scene.add(ambientLight);

    const mainLightVec = lighting?.primaryLightDirection ? 
        new THREE.Vector3(lighting.primaryLightDirection[0], lighting.primaryLightDirection[1], lighting.primaryLightDirection[2]).normalize() :
        new THREE.Vector3(1, 1.5, 1).normalize();

    const mainLight = new THREE.DirectionalLight(
        lighting?.primaryLightColor ? new THREE.Color(lighting.primaryLightColor) : 0xffffff,
        lighting?.primaryLightIntensity ?? 1.5
    );
    mainLight.position.copy(mainLightVec).multiplyScalar(10);
    mainLight.castShadow = true;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xa3b8cc, 0.4);
    fillLight.position.set(-8, 5, -8);
    scene.add(fillLight);

    // RENDERER Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // CONTROLS setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(roomCenter[0], (ceilingY + floorY) / 2, roomCenter[2]);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;

    // List of clickable elements
    const raycastableMeshes: THREE.Object3D[] = [];

    // --- RENDER SCENARIOS ---
    if (viewMode === 'raw') {
        // Raw Scan Geometry
        planes.forEach((plane, idx) => {
            const shape = new THREE.Shape();
            plane.polygon.forEach((p, i) => {
                if (i === 0) shape.moveTo(p.x, -p.z);
                else shape.lineTo(p.x, -p.z);
            });
            const geom = new THREE.ShapeGeometry(shape);
            geom.rotateX(-Math.PI / 2);

            const mat = new THREE.MeshPhysicalMaterial({
                color: plane.color,
                side: THREE.DoubleSide,
                roughness: 0.3,
                metalness: 0.1,
                transparent: true,
                opacity: 0.8
            });

            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(plane.position.x, plane.position.y, plane.position.z);
            mesh.quaternion.set(plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w);
            sceneGroupRef.current?.add(mesh);

            // Outlines
            const edges = new THREE.EdgesGeometry(geom);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
            const lines = new THREE.LineSegments(edges, lineMat);
            mesh.add(lines);
        });
    } else if (viewMode === 'enhanced') {
        // Floor Build
        if (floorHullPoints.length >= 3) {
            const floorShape = new THREE.Shape();
            floorHullPoints.forEach((p, i) => {
                if (i === 0) floorShape.moveTo(p.x, -p.z);
                else floorShape.lineTo(p.x, -p.z);
            });

            const extrudeSettings = { depth: 0.1, bevelEnabled: false };
            let floorGeom: THREE.BufferGeometry;
            try {
                floorGeom = new THREE.ExtrudeGeometry(floorShape, extrudeSettings);
                floorGeom.translate(0, 0, -0.05);
                floorGeom.rotateX(-Math.PI / 2);
                floorGeom.translate(0, -0.05, 0);
            } catch (e) {
                floorGeom = new THREE.PlaneGeometry(maxX - minX || 5, maxZ - minZ || 5);
                floorGeom.rotateX(-Math.PI / 2);
            }

            const floorMatType = customMaterials['floor'] || 'defaultFloor';
            const floorMatProps = MATERIAL_PRESETS[floorMatType];
            const isSelected = selectedMeshId === 'floor';

            const floorMaterial = new THREE.MeshPhysicalMaterial({
                color: isSelected ? 0x94a3b8 : floorMatProps.color,
                roughness: floorMatProps.roughness,
                metalness: floorMatProps.metalness,
                clearcoat: floorMatProps.clearcoat,
                map: getMaterialMap(floorMatType),
                side: THREE.DoubleSide
            });

            const floorMesh = new THREE.Mesh(floorGeom, floorMaterial);
            floorMesh.position.y = floorY;
            floorMesh.userData = { id: 'floor', type: 'floor' };
            sceneGroupRef.current?.add(floorMesh);
            raycastableMeshes.push(floorMesh);

            // Floor border/edges
            const floorEdges = new THREE.EdgesGeometry(floorGeom);
            const floorLine = new THREE.LineSegments(floorEdges, new THREE.LineBasicMaterial({ color: isSelected ? 0xffffff : 0x000000, linewidth: 2 }));
            floorMesh.add(floorLine);

            // Ceiling build
            let ceilGeom: THREE.BufferGeometry;
            try {
                ceilGeom = new THREE.ExtrudeGeometry(floorShape, extrudeSettings);
                ceilGeom.translate(0, 0, -0.05);
                ceilGeom.rotateX(-Math.PI / 2);
                ceilGeom.translate(0, 0.05, 0);
            } catch (e) {
                ceilGeom = new THREE.PlaneGeometry(maxX - minX || 5, maxZ - minZ || 5);
                ceilGeom.rotateX(-Math.PI / 2);
            }

            const ceilMaterial = new THREE.MeshPhysicalMaterial({
                color: 0xf8fafc,
                roughness: 0.9,
                metalness: 0.0,
                map: plasterTexture,
                side: THREE.DoubleSide
            });
            const ceilMesh = new THREE.Mesh(ceilGeom, ceilMaterial);
            ceilMesh.position.y = ceilingY;
            sceneGroupRef.current?.add(ceilMesh);
        }

        // Walls Build
        enhancedWalls.forEach(w => {
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

            const wMatType = customMaterials[w.id] || 'defaultWall';
            const wMatProps = MATERIAL_PRESETS[wMatType];
            const isSelected = selectedMeshId === w.id;

            const wallMaterial = new THREE.MeshPhysicalMaterial({
                color: isSelected ? 0x94a3b8 : wMatProps.color,
                roughness: wMatProps.roughness,
                metalness: wMatProps.metalness,
                clearcoat: wMatProps.clearcoat,
                map: getMaterialMap(wMatType),
                side: THREE.DoubleSide
            });

            const wallGroup = new THREE.Group();
            wallGroup.position.set(w.position[0], w.position[1], w.position[2]);
            wallGroup.quaternion.set(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]);

            const wallMesh = new THREE.Mesh(wallGeom, wallMaterial);
            wallMesh.userData = { id: w.id, type: 'wall' };
            wallGroup.add(wallMesh);
            raycastableMeshes.push(wallMesh);

            // Wall outer borders
            const wallEdges = new THREE.EdgesGeometry(wallGeom);
            const wallEdgesLine = new THREE.LineSegments(wallEdges, new THREE.LineBasicMaterial({ color: isSelected ? 0xffffff : 0x000000, linewidth: 2 }));
            wallMesh.add(wallEdgesLine);

            // Add windows/doors panels inside wall relative frames
            if (w.holes && w.holes.length > 0) {
                w.holes.forEach(hole => {
                    const holeGeom = new THREE.PlaneGeometry(hole.width, hole.height);
                    const holeMat = new THREE.MeshBasicMaterial({
                        color: hole.type === 'door' ? 0x8b5cf6 : 0x38bdf8,
                        transparent: true,
                        opacity: 0.4,
                        side: THREE.DoubleSide
                    });
                    const hMesh = new THREE.Mesh(holeGeom, holeMat);
                    hMesh.position.set(hole.x, hole.y, 0);
                    wallGroup.add(hMesh);

                    const hEdges = new THREE.EdgesGeometry(holeGeom);
                    const hLine = new THREE.LineSegments(hEdges, new THREE.LineBasicMaterial({ color: hole.type === 'door' ? 0x8b5cf6 : 0x38bdf8, linewidth: 2 }));
                    hMesh.add(hLine);
                });
            }

            sceneGroupRef.current?.add(wallGroup);
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

        // Add Metric overlay lines
        if (maxX !== -Infinity) {
            const annotationsGroup = new THREE.Group();
            sceneGroupRef.current?.add(annotationsGroup);

            // Width Line (Orange)
            const wPts = [new THREE.Vector3(minX, floorY + 0.05, minZ - 0.2), new THREE.Vector3(maxX, floorY + 0.05, minZ - 0.2)];
            const wGeom = new THREE.BufferGeometry().setFromPoints(wPts);
            const wLine = new THREE.Line(wGeom, new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 }));
            annotationsGroup.add(wLine);

            // Length Line (Green)
            const lPts = [new THREE.Vector3(minX - 0.2, floorY + 0.05, minZ), new THREE.Vector3(minX - 0.2, floorY + 0.05, maxZ)];
            const lGeom = new THREE.BufferGeometry().setFromPoints(lPts);
            const lLine = new THREE.Line(lGeom, new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3 }));
            annotationsGroup.add(lLine);

            // Height Line (Blue)
            const hPts = [new THREE.Vector3(maxX + 0.2, floorY, (minZ + maxZ)/2), new THREE.Vector3(maxX + 0.2, ceilingY, (minZ + maxZ)/2)];
            const hGeom = new THREE.BufferGeometry().setFromPoints(hPts);
            const hLine = new THREE.Line(hGeom, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 }));
            annotationsGroup.add(hLine);
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

    // CLEANUP
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
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <div className="text-slate-400">Avg confidence</div>
                <div className="font-semibold text-emerald-300">{scanStats.averageConfidence.toFixed(0)}%</div>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <div className="text-slate-400">Sensor/depth</div>
                <div className="font-semibold text-indigo-300">{scanStats.sensorSamples}/{scanStats.depthSamples}</div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">{scanStats.confidentPlanes} surfaces passed stability filters.</p>
            {viewMode === 'enhanced' && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-xs text-slate-300 mb-1 flex items-center gap-1">
                    <Paintbrush className="w-3 h-3 text-indigo-400" /> Click wall/floor to apply textures
                </p>
                <p className="text-xs text-slate-400">Ceiling height: {((ceilingY - floorY) || 0).toFixed(2)}m</p>
              </div>
            )}
        </div>
      </div>

      {/* Material Toolbar */}
      {viewMode === 'enhanced' && selectedMeshId && (
          <div 
             className="absolute bottom-6 inset-x-0 mx-auto flex justify-center z-10 pointer-events-none px-4"
             style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 1.5rem)' }}
          >
              <div className="bg-black/70 backdrop-blur border border-white/15 p-3 rounded-2xl flex flex-wrap justify-center gap-2 pointer-events-auto shadow-2xl max-w-full">
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
