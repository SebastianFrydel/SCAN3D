import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { ScannedPlane } from './ARScanner';
import { Button } from './ui/button';
import { 
  ArrowLeft, Layers, Box, Paintbrush, Download, Map, Sparkles, 
  SlidersHorizontal, Eye, Minimize2, Compass, Grid, Camera, Trash, Ruler
} from 'lucide-react';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RawPlane, RoomLighting, DetectedObject } from '../core/models/types';
import { AIDesignInsights } from './AIDesignInsights';
import { ARProjectionViewer } from './ARProjectionViewer';

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
  const [isProjectionActive, setIsProjectionActive] = useState(false);
  const sceneGroupRef = useRef<THREE.Group | null>(null);

  // High precision interactive visibility layers & debug options states
  const [showFloor, setShowFloor] = useState(true);
  const [showCeiling, setShowCeiling] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [showObjects, setShowObjects] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showNormals, setShowNormals] = useState(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showPanel, setShowPanel] = useState(true);

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

  const modelData = useMemo(() => {
    const rawPlanes: RawPlane[] = planes.map(p => ({
        ...p,
        polygon: p.polygon,
        position: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
        quaternion: new THREE.Quaternion(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w)
    }));

    const model = RoomReconstruction.buildRoomModel(rawPlanes);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    model.floorHullPoints.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
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

  const metrics = useMemo(() => {
    let areaM2 = 0;
    let perimeterM = 0;
    
    if (floorHullPoints && floorHullPoints.length >= 3) {
      // Shoelace formula for area
      let areaSum = 0;
      for (let i = 0; i < floorHullPoints.length; i++) {
        const p1 = floorHullPoints[i];
        const p2 = floorHullPoints[(i + 1) % floorHullPoints.length];
        areaSum += (p1.x * p2.z) - (p2.x * p1.z);
      }
      areaM2 = Math.abs(areaSum) / 2;

      // Perimeter
      for (let i = 0; i < floorHullPoints.length; i++) {
        const p1 = floorHullPoints[i];
        const p2 = floorHullPoints[(i + 1) % floorHullPoints.length];
        perimeterM += Math.hypot(p2.x - p1.x, p2.z - p1.z);
      }
    } else {
      // Fallback area/perimeter from walls bounding box or just sum of wall lengths
      const wallLengths = enhancedWalls.map(w => w.width);
      const totalWallLength = wallLengths.reduce((sum, val) => sum + val, 0);
      perimeterM = totalWallLength;
      
      // Rough rectangle fallback area if we have walls but no hull
      if (enhancedWalls.length >= 2) {
         let minW = Infinity, maxW = -Infinity, minD = Infinity, maxD = -Infinity;
         enhancedWalls.forEach(w => {
            minW = Math.min(minW, w.position[0]);
            maxW = Math.max(maxW, w.position[0]);
            minD = Math.min(minD, w.position[2]);
            maxD = Math.max(maxD, w.position[2]);
         });
         const w = maxW - minW;
         const d = maxD - minD;
         if (w > 0.1 && d > 0.1) {
            areaM2 = w * d;
         } else {
            areaM2 = (totalWallLength / 4) ** 2; // rough square
         }
      }
    }

    const heightM = (ceilingY - floorY) || 0;
    const volumeM3 = areaM2 * heightM;

    // Convert to US customary units
    const areaSqFt = areaM2 * 10.7639;
    const perimeterFt = perimeterM * 3.28084;
    const heightFt = heightM * 3.28084;
    const volumeCuFt = volumeM3 * 35.3147;

    return {
      areaM2,
      areaSqFt,
      perimeterM,
      perimeterFt,
      heightM,
      heightFt,
      volumeM3,
      volumeCuFt
    };
  }, [floorHullPoints, enhancedWalls, ceilingY, floorY]);

  const [customObjects, setCustomObjects] = useState<DetectedObject[]>([]);

  useEffect(() => {
    if (objects) {
      setCustomObjects(objects);
    }
  }, [objects]);

  const [showObjectsPanel, setShowObjectsPanel] = useState(true);

  const handleAddObject = (type: string = 'chair') => {
      const newId = `obj_custom_${Date.now()}`;
      const newObj: DetectedObject = {
          id: newId,
          type,
          label: `Custom ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          position: [roomCenter[0], floorY + 0.4, roomCenter[2]], // place at room center on the floor
          width: type === 'table' ? 1.0 : type === 'sofa' ? 1.6 : type === 'tv' ? 1.2 : 0.6,
          depth: type === 'table' ? 1.0 : type === 'sofa' ? 0.8 : type === 'tv' ? 0.1 : 0.6,
          height: type === 'table' ? 0.75 : type === 'sofa' ? 0.85 : type === 'tv' ? 0.7 : 0.8,
          quaternion: [0, 0, 0, 1]
      };
      setCustomObjects(prev => [...(prev || []), newObj]);
      setSelectedMeshId(newId);
  };

  const handleUpdateObjectLabel = (id: string, newLabel: string) => {
      setCustomObjects(prev => prev.map(o => o.id === id ? { ...o, label: newLabel } : o));
  };

  const handleUpdateObjectType = (id: string, type: string) => {
      setCustomObjects(prev => prev.map(o => o.id === id ? { ...o, type } : o));
  };

  const handleUpdateObjectDimensions = (id: string, field: 'width' | 'height' | 'depth', val: number) => {
      setCustomObjects(prev => prev.map(o => o.id === id ? { ...o, [field]: Math.max(0.05, val) } : o));
  };

  const handleUpdateObjectPosition = (id: string, index: number, val: number) => {
      setCustomObjects(prev => prev.map(o => {
          if (o.id === id) {
              const pos = [...o.position] as [number, number, number];
              pos[index] = val;
              return { ...o, position: pos };
          }
          return o;
      }));
  };

  const handleUpdateObjectColor = (id: string, colorHex: number) => {
      setCustomObjects(prev => prev.map(o => o.id === id ? { ...o, color: colorHex } : o));
  };

  const handleDeleteObject = (id: string) => {
      setCustomObjects(prev => prev.filter(o => o.id !== id));
      if (selectedMeshId === id) {
          setSelectedMeshId(null);
      }
  };

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
        if (floorHullPoints.length >= 3 && showFloor) {
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
                side: THREE.DoubleSide,
                wireframe: showWireframe
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

            // Normal Arrow Helper for Floor
            if (showNormals) {
                const normalDir = new THREE.Vector3(0, 1, 0);
                const arrowHelper = new THREE.ArrowHelper(
                    normalDir, 
                    new THREE.Vector3(roomCenter[0], floorY, roomCenter[2]), 
                    0.6, 
                    0x10b981, 
                    0.15, 
                    0.08
                );
                sceneGroupRef.current?.add(arrowHelper);
            }
        }

        // Ceiling Build
        if (floorHullPoints.length >= 3 && showCeiling) {
            const floorShape = new THREE.Shape();
            floorHullPoints.forEach((p, i) => {
                if (i === 0) floorShape.moveTo(p.x, -p.z);
                else floorShape.lineTo(p.x, -p.z);
            });

            const extrudeSettings = { depth: 0.1, bevelEnabled: false };
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
                side: THREE.DoubleSide,
                wireframe: showWireframe
            });
            const ceilMesh = new THREE.Mesh(ceilGeom, ceilMaterial);
            ceilMesh.position.y = ceilingY;
            sceneGroupRef.current?.add(ceilMesh);

            // Normal Arrow Helper for Ceiling
            if (showNormals) {
                const normalDir = new THREE.Vector3(0, -1, 0);
                const arrowHelper = new THREE.ArrowHelper(
                    normalDir, 
                    new THREE.Vector3(roomCenter[0], ceilingY, roomCenter[2]), 
                    0.6, 
                    0x06b6d4, 
                    0.15, 
                    0.08
                );
                sceneGroupRef.current?.add(arrowHelper);
            }
        }

        // Walls Build
        if (showWalls) {
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

                const extrudeSettings = { depth: 0.1, bevelEnabled: false };
                let wallGeom: THREE.BufferGeometry;
                try {
                    wallGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                } catch (e) {
                    wallGeom = new THREE.PlaneGeometry(w.width, w.height);
                }
                wallGeom.translate(0, 0, -0.05);

                const posAttr = wallGeom.attributes.position;
                const uvAttr = wallGeom.attributes.uv;
                if (posAttr && uvAttr) {
                    for (let i = 0; i < posAttr.count; i++) {
                       const x = posAttr.getX(i);
                       const y = posAttr.getY(i);
                       uvAttr.setXY(i, x, y);
                    }
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
                    side: THREE.DoubleSide,
                    wireframe: showWireframe
                });

                const wallGroup = new THREE.Group();
                wallGroup.position.set(w.position[0], w.position[1], w.position[2]);
                wallGroup.quaternion.set(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]);

                const wallMesh = new THREE.Mesh(wallGeom, wallMaterial);
                wallMesh.userData = { id: w.id, type: 'wall' };
                wallGroup.add(wallMesh);
                raycastableMeshes.push(wallMesh);

                const wallEdges = new THREE.EdgesGeometry(wallGeom);
                const wallEdgesLine = new THREE.LineSegments(wallEdges, new THREE.LineBasicMaterial({ color: isSelected ? 0xffffff : 0x000000, linewidth: 2 }));
                wallMesh.add(wallEdgesLine);

                // Normal Arrow Helper for Wall
                if (showNormals) {
                    const normalDir = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...w.quaternion));
                    const arrowHelper = new THREE.ArrowHelper(
                        normalDir, 
                        new THREE.Vector3(w.position[0], w.position[1], w.position[2]), 
                        0.5, 
                        0x3b82f6, 
                        0.12, 
                        0.06
                    );
                    sceneGroupRef.current?.add(arrowHelper);
                }

                if (w.holes && w.holes.length > 0) {
                    w.holes.forEach(hole => {
                        const holeGeom = new THREE.PlaneGeometry(hole.width, hole.height);
                        const holeMat = new THREE.MeshBasicMaterial({
                            color: hole.type === 'door' ? 0x8b5cf6 : 0x38bdf8,
                            transparent: true,
                            opacity: 0.4,
                            side: THREE.DoubleSide,
                            wireframe: showWireframe
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
        }

        // Furniture/Objects placements
        if (customObjects && showObjects) {
            customObjects.forEach(o => {
                let color = o.color || 0xf59e0b;
                if (!o.color) {
                    if (o.type === 'chair') color = 0xf43f5e;
                    if (o.type === 'sofa') color = 0xd946ef;
                    if (o.type === 'wardrobe') color = 0xf97316;
                    if (o.type === 'tv') color = 0x14b8a6;
                }

                const geom = new THREE.BoxGeometry(o.width, o.height, o.depth);
                const isSelected = selectedMeshId === o.id;

                const mat = new THREE.MeshPhysicalMaterial({
                    color: isSelected ? 0x94a3b8 : color,
                    transparent: true,
                    opacity: 0.7,
                    roughness: 0.5,
                    metalness: 0.1,
                    wireframe: showWireframe
                });

                const mesh = new THREE.Mesh(geom, mat);
                mesh.position.set(o.position[0], o.position[1], o.position[2]);
                mesh.quaternion.set(o.quaternion[0], o.quaternion[1], o.quaternion[2], o.quaternion[3]);
                mesh.userData = { id: o.id, type: 'object' };
                sceneGroupRef.current?.add(mesh);
                raycastableMeshes.push(mesh);

                const edges = new THREE.EdgesGeometry(geom);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: isSelected ? 0xffffff : color, linewidth: 2 }));
                mesh.add(line);

                // Normal Arrow Helper pointing up
                if (showNormals) {
                    const normalDir = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...o.quaternion));
                    const arrowHelper = new THREE.ArrowHelper(
                        normalDir, 
                        new THREE.Vector3(o.position[0], o.position[1] + o.height/2, o.position[2]), 
                        0.3, 
                        color, 
                        0.08, 
                        0.04
                    );
                    sceneGroupRef.current?.add(arrowHelper);
                }

                // Glowing Neon Bounding Box Helper
                if (showBoundingBoxes) {
                    const bboxGeom = new THREE.BoxGeometry(o.width + 0.04, o.height + 0.04, o.depth + 0.04);
                    const bboxEdges = new THREE.EdgesGeometry(bboxGeom);
                    const bboxLine = new THREE.LineSegments(
                        bboxEdges, 
                        new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2.5 }) // vibrant emerald
                    );
                    bboxLine.position.set(o.position[0], o.position[1], o.position[2]);
                    bboxLine.quaternion.set(o.quaternion[0], o.quaternion[1], o.quaternion[2], o.quaternion[3]);
                    sceneGroupRef.current?.add(bboxLine);
                }
            });
        }

        // Add Metric overlay lines
        if (maxX !== -Infinity && showDimensions) {
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

    // RAYCASTING click logic
    const handlePointerDown = (event: PointerEvent) => {
        // Calculate canvas coordinates
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        const intersects = raycaster.intersectObjects(raycastableMeshes);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            if (hit.userData && hit.userData.id) {
                setSelectedMeshId(hit.userData.id);
            }
        } else {
            // Did not hit any paintable meshes
            setSelectedMeshId(null);
        }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    // ANIMATION Loop
    let animationFrameId: number;
    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    };
    animate();

    // RESIZE Listener
    const onWindowResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onWindowResize);

    // CLEANUP
    return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('resize', onWindowResize);
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
            renderer.dispose();
            container.removeChild(renderer.domElement);
        }
        scene.clear();
    };
  }, [viewMode, planes, customMaterials, selectedMeshId, roomCenter, ceilingY, floorY, lighting, showFloor, showCeiling, showWalls, showObjects, showWireframe, showNormals, showBoundingBoxes, showDimensions, customObjects]);

  // Handle high precision exports
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
              console.error('GLTF Export Failed', error);
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

  const handleApplyMaterial = (matType: MaterialType) => {
      if (selectedMeshId) {
          setCustomMaterials(prev => ({
              ...prev,
              [selectedMeshId]: matType
          }));
      }
  };

  if (isProjectionActive) {
    return (
      <ARProjectionViewer 
        planes={planes}
        lighting={lighting}
        onClose={() => setIsProjectionActive(false)}
      />
    );
  }

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
          <Button variant="default" className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg border-0 font-semibold" onClick={() => setShowAIInsights(true)}>
            <Sparkles className="w-5 h-5 mr-2" />
            AI Insights
          </Button>
          <Button variant="default" className="bg-purple-600 hover:bg-purple-500 text-white shadow-lg border-0 font-semibold" onClick={() => setIsProjectionActive(true)}>
            <Camera className="w-5 h-5 mr-2" />
            Project in AR Camera
          </Button>
          <Button variant="default" className="bg-[#f59e0b] hover:bg-[#d97706] text-white shadow-lg border-0 font-semibold" onClick={() => setShowObjectsPanel(!showObjectsPanel)}>
            <Box className="w-5 h-5 mr-2" />
            Furniture Planner
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
            <h3 className="font-bold text-lg mb-1">Room Viewer</h3>
            <p className="text-xs text-slate-300 mb-0">Detected {planes.length} surfaces</p>
            
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
      
      {/* Glassmorphic Visual Layers & Debug Panel */}
      {showPanel && viewMode !== 'layout2d' && (
        <div className="absolute top-[180px] left-4 md:left-6 w-72 bg-slate-950/90 backdrop-blur-md rounded-2xl p-4 border border-white/10 text-white pointer-events-auto shadow-2xl z-20 flex flex-col gap-4 animate-in slide-in-from-left duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
              <h3 className="font-bold text-sm tracking-wide uppercase">Display Settings</h3>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 rounded-full hover:bg-white/10 text-slate-400 hover:text-white"
              onClick={() => setShowPanel(false)}
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Visibility Layers Toggle */}
          <div className="space-y-2.5">
            <h4 className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">Visibility Layers</h4>
            
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Eye className="w-3.5 h-3.5 text-blue-400" />
                Walls
              </span>
              <input 
                type="checkbox" 
                checked={showWalls} 
                onChange={(e) => setShowWalls(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                Floor
              </span>
              <input 
                type="checkbox" 
                checked={showFloor} 
                onChange={(e) => setShowFloor(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                Ceiling
              </span>
              <input 
                type="checkbox" 
                checked={showCeiling} 
                onChange={(e) => setShowCeiling(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Eye className="w-3.5 h-3.5 text-[#f59e0b]" />
                Furniture & Objects
              </span>
              <input 
                type="checkbox" 
                checked={showObjects} 
                onChange={(e) => setShowObjects(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Eye className="w-3.5 h-3.5 text-slate-300" />
                Dimensions
              </span>
              <input 
                type="checkbox" 
                checked={showDimensions} 
                onChange={(e) => setShowDimensions(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>
          </div>

          {/* Debug Tools Toggles */}
          <div className="space-y-2.5 pt-3 border-t border-white/10">
            <h4 className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">Debug Systems</h4>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-indigo-300">
                <Grid className="w-3.5 h-3.5" />
                Wireframe Overlay
              </span>
              <input 
                type="checkbox" 
                checked={showWireframe} 
                onChange={(e) => setShowWireframe(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-emerald-300">
                <Compass className="w-3.5 h-3.5" />
                Show Face Normals
              </span>
              <input 
                type="checkbox" 
                checked={showNormals} 
                onChange={(e) => setShowNormals(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-pink-300">
                <Box className="w-3.5 h-3.5" />
                Object Bounds
              </span>
              <input 
                type="checkbox" 
                checked={showBoundingBoxes} 
                onChange={(e) => setShowBoundingBoxes(e.target.checked)}
                className="w-8 h-4 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-3 before:w-3 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-4 before:transition-all pointer-events-auto"
              />
            </div>
          </div>
        </div>
      )}

      {/* Re-open Display Settings Button */}
      {!showPanel && viewMode !== 'layout2d' && (
        <Button 
          variant="outline" 
          className="absolute top-[180px] left-4 md:left-6 z-20 bg-slate-950/80 backdrop-blur border border-white/10 text-white hover:bg-slate-900/90 rounded-xl pointer-events-auto animate-in fade-in duration-200"
          onClick={() => setShowPanel(true)}
        >
          <SlidersHorizontal className="w-4 h-4 mr-2" />
          Display Settings
        </Button>
      )}

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

      <div className="flex-1 w-full h-full relative cursor-move">
        {viewMode === 'layout2d' ? (
             <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-8 overflow-hidden touch-pinch-zoom">
                <svg 
                  viewBox={maxX !== -Infinity ? `${minX - 1} ${minZ - 1} ${maxX - minX + 2} ${maxZ - minZ + 2}` : "0 0 10 10"} 
                  className="w-full h-full max-w-4xl"
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
                                    rx="0.02"
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
                   {customObjects && customObjects.map(o => {
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
                                    {o.label || (o.type.charAt(0).toUpperCase() + o.type.slice(1))}
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
        ) : (
             <div ref={containerRef} className="w-full h-full text-slate-100" />
        )}
      </div>
      
      {/* Room Dimensions & Metrics Display Panel */}
      <div className="absolute bottom-6 left-4 md:left-6 w-80 bg-slate-950/90 backdrop-blur-md rounded-2xl p-4 border border-white/10 text-white pointer-events-auto shadow-2xl z-20 flex flex-col gap-3 animate-in slide-in-from-left duration-200">
         <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
               <Ruler className="w-4 h-4 text-emerald-400" />
               <h3 className="font-bold text-xs tracking-wide uppercase text-slate-200">Room Dimensions</h3>
            </div>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-bold px-2 py-0.5 rounded-full uppercase">
               LiDAR Metrics
            </span>
         </div>
         
         <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-white/5 rounded-xl p-2 border border-white/5 flex flex-col justify-between">
               <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Total Area</span>
               <div>
                  <div className="text-lg font-black text-emerald-400 font-mono tracking-tight leading-none mb-1">
                     {metrics.areaSqFt.toFixed(1)} <span className="text-[10px] font-normal text-slate-300">sq ft</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono block leading-none">{metrics.areaM2.toFixed(2)} m²</span>
               </div>
            </div>

            <div className="bg-white/5 rounded-xl p-2 border border-white/5 flex flex-col justify-between">
               <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Perimeter</span>
               <div>
                  <div className="text-lg font-black text-indigo-400 font-mono tracking-tight leading-none mb-1">
                     {metrics.perimeterFt.toFixed(1)} <span className="text-[10px] font-normal text-slate-300">ft</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono block leading-none">{metrics.perimeterM.toFixed(2)} m</span>
               </div>
            </div>

            <div className="bg-white/5 rounded-xl p-2 border border-white/5 flex flex-col justify-between">
               <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Ceiling Height</span>
               <div>
                  <div className="text-lg font-black text-cyan-400 font-mono tracking-tight leading-none mb-1">
                     {metrics.heightFt.toFixed(1)} <span className="text-[10px] font-normal text-slate-300">ft</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono block leading-none">{metrics.heightM.toFixed(2)} m</span>
               </div>
            </div>

            <div className="bg-white/5 rounded-xl p-2 border border-white/5 flex flex-col justify-between">
               <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Est. Volume</span>
               <div>
                  <div className="text-lg font-black text-pink-400 font-mono tracking-tight leading-none mb-1">
                     {metrics.volumeCuFt.toFixed(0)} <span className="text-[10px] font-normal text-slate-300">cu ft</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono block leading-none">{metrics.volumeM3.toFixed(1)} m³</span>
               </div>
            </div>
         </div>

         {/* Visual Aspect Ratio helper/shape hint */}
         <div className="flex items-center justify-between text-[10px] text-slate-400 bg-slate-900/50 px-2 py-1.5 rounded-lg border border-white/5">
            <span className="font-semibold text-slate-400">Layout Details:</span>
            <span className="font-mono text-slate-300">
               {enhancedWalls.length} Walls • {features.length} Openings
            </span>
         </div>
      </div>
      
      {viewMode !== 'layout2d' && (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none text-slate-400 text-xs tracking-wide bg-black/40 px-6 py-2 rounded-full border border-white/5 backdrop-blur z-10">
        Drag to rotate • Pinch/Scroll to zoom • Click surface to select
      </div>
      )}

      {showObjectsPanel && (
        <div className="absolute top-[180px] right-4 md:right-6 max-h-[calc(100vh-220px)] w-80 md:w-88 bg-slate-950/90 backdrop-blur-md rounded-2xl p-4 border border-white/10 text-white pointer-events-auto shadow-2xl z-20 flex flex-col gap-3 animate-in slide-in-from-right duration-200 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Box className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-sm tracking-wide uppercase">Identified Objects</h3>
            </div>
            <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-mono font-bold">
              {(customObjects || []).length} items
            </span>
          </div>

          {/* ADD OBJECT CONTROLS */}
          <div className="space-y-2">
            <h4 className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">Add Object Anchor</h4>
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" onClick={() => handleAddObject('chair')} className="bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/20 text-[11px] h-8 font-medium">
                + Chair
              </Button>
              <Button size="sm" onClick={() => handleAddObject('table')} className="bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/20 text-[11px] h-8 font-medium">
                + Table
              </Button>
              <Button size="sm" onClick={() => handleAddObject('sofa')} className="bg-fuchsia-600/30 hover:bg-fuchsia-600/50 text-fuchsia-200 border border-fuchsia-500/20 text-[11px] h-8 font-medium">
                + Sofa
              </Button>
              <Button size="sm" onClick={() => handleAddObject('tv')} className="bg-teal-600/30 hover:bg-teal-600/50 text-teal-200 border border-teal-500/20 text-[11px] h-8 font-medium">
                + TV
              </Button>
              <Button size="sm" onClick={() => handleAddObject('wardrobe')} className="bg-orange-600/30 hover:bg-orange-600/50 text-orange-200 border border-orange-500/20 text-[11px] h-8 font-medium col-span-2">
                + Wardrobe
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {customObjects && customObjects.length === 0 ? (
              <div className="h-32 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl text-slate-500 p-4 text-center">
                <p className="text-xs">No objects placed yet.</p>
                <p className="text-[10px] text-slate-600 mt-1">Simulate scanning or tap custom item buttons above to plan your space!</p>
              </div>
            ) : (
              customObjects && customObjects.map(o => {
                const isSelected = selectedMeshId === o.id;
                let strokeColor = 'border-amber-500/20 bg-amber-500/5';
                let iconBg = 'bg-amber-500/20 text-amber-400';
                if (o.type === 'chair') { strokeColor = isSelected ? 'border-rose-500 bg-rose-500/10' : 'border-rose-500/20 bg-rose-500/5'; iconBg = 'bg-rose-500/20 text-rose-400'; }
                else if (o.type === 'sofa') { strokeColor = isSelected ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-fuchsia-500/20 bg-fuchsia-500/5'; iconBg = 'bg-fuchsia-500/20 text-fuchsia-400'; }
                else if (o.type === 'wardrobe') { strokeColor = isSelected ? 'border-orange-500 bg-orange-500/10' : 'border-orange-500/20 bg-orange-500/5'; iconBg = 'bg-orange-500/20 text-orange-400'; }
                else if (o.type === 'tv') { strokeColor = isSelected ? 'border-teal-500 bg-teal-500/10' : 'border-teal-500/20 bg-teal-500/5'; iconBg = 'bg-teal-500/20 text-teal-400'; }
                else if (isSelected) { strokeColor = 'border-indigo-500 bg-indigo-500/10'; }

                return (
                  <div 
                    key={o.id} 
                    className={`p-3 rounded-xl border transition-all cursor-pointer text-left space-y-2 ${strokeColor}`}
                    onClick={() => {
                        setSelectedMeshId(isSelected ? null : o.id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-lg ${iconBg} flex items-center justify-center text-xs font-bold font-mono`}>
                          {o.type.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <p className="text-xs font-bold truncate max-w-[120px] text-white">
                            {o.label || (o.type.charAt(0).toUpperCase() + o.type.slice(1))}
                          </p>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                            {o.type}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex gap-1">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg animate-none shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteObject(o.id);
                          }}
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* EXPANDED INTERACTIVE DETAILS WHEN CHOSEN */}
                    {isSelected && (
                      <div className="pt-2 border-t border-white/10 space-y-3 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                        {/* UPDATE NAME FIELD */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Custom Label</label>
                          <input 
                            type="text" 
                            className="w-full text-xs bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 animate-none"
                            value={o.label || ''} 
                            placeholder={o.type.charAt(0).toUpperCase() + o.type.slice(1)}
                            onChange={(e) => handleUpdateObjectLabel(o.id, e.target.value)}
                          />
                        </div>

                        {/* TYPE SWITCHES */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Class Type</label>
                          <div className="flex flex-wrap gap-1">
                            {['chair', 'table', 'sofa', 'tv', 'wardrobe'].map(t => (
                              <button
                                key={t}
                                className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${o.type === t ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                                onClick={() => handleUpdateObjectType(o.id, t)}
                              >
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* DIMENSIONS */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Dimensions (Meters)</label>
                          <div className="grid grid-cols-3 gap-1">
                            <div>
                              <span className="text-[9px] text-slate-400 block">Width</span>
                              <input 
                                type="number" 
                                step="0.05"
                                className="w-full text-[11px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white"
                                value={parseFloat(o.width.toFixed(2))}
                                onChange={(e) => handleUpdateObjectDimensions(o.id, 'width', parseFloat(e.target.value) || 0.1)}
                              />
                            </div>
                            <div>
                              <span className="text-[9px] text-slate-400 block">Depth</span>
                              <input 
                                type="number" 
                                step="0.05"
                                className="w-full text-[11px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white"
                                value={parseFloat(o.depth.toFixed(2))}
                                onChange={(e) => handleUpdateObjectDimensions(o.id, 'depth', parseFloat(e.target.value) || 0.1)}
                              />
                            </div>
                            <div>
                              <span className="text-[9px] text-slate-400 block">Height</span>
                              <input 
                                type="number" 
                                step="0.05"
                                className="w-full text-[11px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white"
                                value={parseFloat(o.height.toFixed(2))}
                                onChange={(e) => handleUpdateObjectDimensions(o.id, 'height', parseFloat(e.target.value) || 0.1)}
                              />
                            </div>
                          </div>
                        </div>

                        {/* COORDINATE PLACEMENTS */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 flex justify-between h-3">
                            <span>Adjust Position (X, Y, Z)</span>
                            <span className="font-mono text-[9px] text-indigo-300">
                              [{o.position[0].toFixed(1)}, {o.position[1].toFixed(1)}, {o.position[2].toFixed(1)}]
                            </span>
                          </label>
                          
                          <div className="space-y-1.5">
                            {/* X movement */}
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 w-3 font-mono">X</span>
                              <input 
                                type="range" 
                                min={(minX - 1.0).toFixed(2)} 
                                max={(maxX + 1.0).toFixed(2)} 
                                step="0.05"
                                className="flex-1 accent-indigo-500 h-1 bg-slate-900 rounded cursor-pointer"
                                value={o.position[0]}
                                onChange={(e) => handleUpdateObjectPosition(o.id, 0, parseFloat(e.target.value))}
                              />
                            </div>
                            {/* Y Height movement */}
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 w-3 font-mono">Y</span>
                              <input 
                                type="range" 
                                min={floorY.toFixed(2)} 
                                max={ceilingY.toFixed(2)} 
                                step="0.05"
                                className="flex-1 accent-indigo-500 h-1 bg-slate-900 rounded cursor-pointer"
                                value={o.position[1]}
                                onChange={(e) => handleUpdateObjectPosition(o.id, 1, parseFloat(e.target.value))}
                              />
                            </div>
                            {/* Z depth movement */}
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 w-3 font-mono">Z</span>
                              <input 
                                type="range" 
                                min={(minZ - 1.0).toFixed(2)} 
                                max={(maxZ + 1.0).toFixed(2)} 
                                step="0.05"
                                className="flex-1 accent-indigo-500 h-1 bg-slate-900 rounded cursor-pointer"
                                value={o.position[2]}
                                onChange={(e) => handleUpdateObjectPosition(o.id, 2, parseFloat(e.target.value))}
                              />
                            </div>
                          </div>
                        </div>

                        {/* COLOR SELECTION PATTERNS */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Visual Theme Color</label>
                          <div className="flex gap-2">
                            {[0xf43f5e, 0xf59e0b, 0xd946ef, 0x14b8a6, 0xf97316, 0x3b82f6].map(colorHex => (
                              <button
                                key={colorHex}
                                className={`w-5 h-5 rounded-full border transition-all ${o.color === colorHex ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: `#${colorHex.toString(16).padStart(6, '0')}` }}
                                onClick={() => handleUpdateObjectColor(o.id, colorHex)}
                                title={`#${colorHex.toString(16).padStart(6, '0')}`}
                              />
                            ))}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
          
          <div className="border-t border-white/10 pt-2 flex justify-between gap-2">
            <Button size="sm" variant="outline" className="w-full text-xs h-9 bg-slate-900/50 hover:bg-slate-800" onClick={() => setShowObjectsPanel(false)}>
              Hide Panel
            </Button>
          </div>
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
