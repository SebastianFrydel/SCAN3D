import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { 
  ArrowLeft, Camera, RefreshCw, Lock, Unlock, RotateCw, ZoomIn, 
  Layers, Check, Eye, EyeOff, Sliders, Play, Pause, Grid, Box, Map, Download, Info
} from 'lucide-react';
import { Button } from './ui/button';
import { ScannedPlane } from './ARScanner';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RawPlane, RoomLighting } from '../core/models/types';
import { toast } from 'sonner';

export interface ARProjectionViewerProps {
  planes: ScannedPlane[];
  lighting?: RoomLighting;
  onClose: () => void;
}

const MATERIAL_PRESETS = {
  defaultFloor: { color: 0xe2e8f0, roughness: 0.2, metalness: 0.05, clearcoat: 0.3 },
  defaultWall: { color: 0x3b82f6, roughness: 0.4, metalness: 0.1, clearcoat: 0.0 },
  wood: { color: 0x8b5a2b, roughness: 0.7, metalness: 0.1, clearcoat: 0.2 },
  metal: { color: 0xb0c4de, roughness: 0.1, metalness: 0.9, clearcoat: 0.6 },
  fabric: { color: 0xf0e6d2, roughness: 0.95, metalness: 0.0, clearcoat: 0.0 },
  paint: { color: 0xf8f9fa, roughness: 0.85, metalness: 0.0, clearcoat: 0.0 }
};

type ViewStyle = 'xray' | 'solid' | 'wireframe';

export function ARProjectionViewer({ planes, lighting, onClose }: ARProjectionViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Calibration state variables
  const [scale, setScale] = useState<number>(0.3); // default to 0.3x so it sits nicely as a table-top holographic projection initially
  const [rotationY, setRotationY] = useState<number>(0); // angle in degrees
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(-0.5); // lower it slightly so it lands towards the floor
  const [offsetZ, setOffsetZ] = useState<number>(-2.0); // push it in front of the camera feed
  const [viewStyle, setViewStyle] = useState<ViewStyle>('solid');
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(true);
  
  // Visibility filters
  const [showWalls, setShowWalls] = useState<boolean>(true);
  const [showFloor, setShowFloor] = useState<boolean>(true);
  const [showCeiling, setShowCeiling] = useState<boolean>(false); // ceiling hidden by default to look inside model
  const [showObjects, setShowObjects] = useState<boolean>(true);
  const [showGridIndicator, setShowGridIndicator] = useState<boolean>(true);
  const [showNormals, setShowNormals] = useState<boolean>(false);

  // Diagnostic warning
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);

  // Build room reconstruction using the planes passed
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
      objects: model.objects,
      floorHullPoints: model.floorHullPoints,
      floorY: model.floorY,
      ceilingY: model.ceilingY,
      roomCenter: model.roomCenter,
      minX: minX === Infinity ? -1.5 : minX,
      maxX: maxX === -Infinity ? 1.5 : maxX,
      minZ: minZ === Infinity ? -1.5 : minZ,
      maxZ: maxZ === -Infinity ? 1.5 : maxZ
    };
  }, [planes]);

  const { minX, maxX, minZ, maxZ, floorHullPoints, enhancedWalls, objects, ceilingY, floorY, roomCenter } = modelData;

  // Initialize environmental camera stream
  useEffect(() => {
    let active = true;

    async function startCamera() {
      if (!isCameraActive) {
        stopCamera();
        return;
      }

      setCameraPermissionError(null);
      try {
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (active && videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
        }
      } catch (err: any) {
        console.warn('Could not launch environmental camera back-facing feed. Trying fallback camera...', err);
        try {
          // Fallback to any camera
          const streamFallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (active && videoRef.current) {
            videoRef.current.srcObject = streamFallback;
            streamRef.current = streamFallback;
          }
        } catch (fallbackErr: any) {
          console.error('All camera initialization failed:', fallbackErr);
          setCameraPermissionError('Hardware Camera feed is unavailable. You can still calibrate and view the 3D hologram representation in front of a canvas backdrop!');
        }
      }
    }

    startCamera();

    return () => {
      active = false;
      stopCamera();
    };
  }, [isCameraActive]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Three JS scene loop
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    
    // Transparent scene background to allow the video feed behind it to show through
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 50);
    camera.position.set(0, 0, 0); // look forward from origin

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true // Required for capturing snapshot
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;

    // Direct lighting & ambient light setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(2, 5, 3);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const helperLight = new THREE.DirectionalLight(0xa3e2ff, 0.3);
    helperLight.position.set(-3, 2, -3);
    scene.add(helperLight);

    // Reconstruct the 3D Room as a single placeable master group
    const roomMasterGroup = new THREE.Group();
    scene.add(roomMasterGroup);

    // Apply scaling, rotation, offsets dynamically based on control state
    roomMasterGroup.scale.set(scale, scale, scale);
    roomMasterGroup.rotation.y = THREE.MathUtils.degToRad(rotationY);
    roomMasterGroup.position.set(offsetX, offsetY, offsetZ);

    // Centering vector: we offset individual inner children relative to the room center
    const centerOffset = new THREE.Vector3(roomCenter[0], (ceilingY + floorY) / 2, roomCenter[2]);
    const roomContentGroup = new THREE.Group();
    roomContentGroup.position.copy(centerOffset).multiplyScalar(-1); // translate room to local origin (0,0,0) inside the master group
    roomMasterGroup.add(roomContentGroup);

    // --- MESH GENERATION LOGIC ---

    // 1. Floor
    if (floorHullPoints.length >= 3 && showFloor) {
      const floorShape = new THREE.Shape();
      floorHullPoints.forEach((p, i) => {
        if (i === 0) floorShape.moveTo(p.x, -p.z);
        else floorShape.lineTo(p.x, -p.z);
      });

      const extrudeSettings = { depth: 0.08, bevelEnabled: false };
      let floorGeom: THREE.BufferGeometry;
      try {
        floorGeom = new THREE.ExtrudeGeometry(floorShape, extrudeSettings);
        floorGeom.translate(0, 0, -0.04);
        floorGeom.rotateX(-Math.PI / 2);
        floorGeom.translate(0, -0.04, 0);
      } catch (e) {
        floorGeom = new THREE.PlaneGeometry(maxX - minX || 3, maxZ - minZ || 3);
        floorGeom.rotateX(-Math.PI / 2);
      }

      const isXray = viewStyle === 'xray';
      const isWire = viewStyle === 'wireframe';

      const floorMat = new THREE.MeshPhysicalMaterial({
        color: isXray ? 0x6366f1 : 0xe2e8f0,
        roughness: 0.4,
        metalness: 0.1,
        transparent: isXray,
        opacity: isXray ? 0.35 : 0.95,
        wireframe: isWire,
        side: THREE.DoubleSide
      });

      const floorMesh = new THREE.Mesh(floorGeom, floorMat);
      floorMesh.position.y = floorY;
      roomContentGroup.add(floorMesh);

      // Edges outline
      const edges = new THREE.EdgesGeometry(floorGeom);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ 
        color: isWire ? 0x38bdf8 : 0x000000, 
        transparent: isXray,
        opacity: isXray ? 0.5 : 1.0,
        linewidth: 1.5 
      }));
      floorMesh.add(line);
    }

    // 2. Ceiling
    if (floorHullPoints.length >= 3 && showCeiling) {
      const floorShape = new THREE.Shape();
      floorHullPoints.forEach((p, i) => {
        if (i === 0) floorShape.moveTo(p.x, -p.z);
        else floorShape.lineTo(p.x, -p.z);
      });

      const extrudeSettings = { depth: 0.08, bevelEnabled: false };
      let ceilGeom: THREE.BufferGeometry;
      try {
        ceilGeom = new THREE.ExtrudeGeometry(floorShape, extrudeSettings);
        ceilGeom.translate(0, 0, -0.04);
        ceilGeom.rotateX(-Math.PI / 2);
        ceilGeom.translate(0, 0.04, 0);
      } catch (e) {
        ceilGeom = new THREE.PlaneGeometry(maxX - minX || 3, maxZ - minZ || 3);
        ceilGeom.rotateX(-Math.PI / 2);
      }

      const isXray = viewStyle === 'xray';
      const isWire = viewStyle === 'wireframe';

      const ceilMat = new THREE.MeshPhysicalMaterial({
        color: isXray ? 0x9f1239 : 0xf8fafc,
        roughness: 0.8,
        metalness: 0.0,
        transparent: isXray,
        opacity: isXray ? 0.2 : 0.9,
        wireframe: isWire,
        side: THREE.DoubleSide
      });

      const ceilMesh = new THREE.Mesh(ceilGeom, ceilMat);
      ceilMesh.position.y = ceilingY;
      roomContentGroup.add(ceilMesh);
    }

    // 3. Walls
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

        const extrudeSettings = { depth: 0.08, bevelEnabled: false };
        let wallGeom: THREE.BufferGeometry;
        try {
          wallGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        } catch (e) {
          wallGeom = new THREE.PlaneGeometry(w.width, w.height);
        }
        wallGeom.translate(0, 0, -0.04);

        const isXray = viewStyle === 'xray';
        const isWire = viewStyle === 'wireframe';

        const wallMat = new THREE.MeshPhysicalMaterial({
          color: isXray ? 0x6366f1 : 0x3b82f6,
          roughness: 0.5,
          metalness: 0.1,
          transparent: isXray,
          opacity: isXray ? 0.35 : 0.85,
          wireframe: isWire,
          side: THREE.DoubleSide
        });

        const wallGroup = new THREE.Group();
        wallGroup.position.set(w.position[0], w.position[1], w.position[2]);
        wallGroup.quaternion.set(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]);

        const wallMesh = new THREE.Mesh(wallGeom, wallMat);
        wallGroup.add(wallMesh);

        // Edges outline
        const wallEdges = new THREE.EdgesGeometry(wallGeom);
        const wallEdgesLine = new THREE.LineSegments(wallEdges, new THREE.LineBasicMaterial({ 
          color: isWire ? 0x6366f1 : 0x000000, 
          transparent: isXray,
          opacity: isXray ? 0.4 : 1.0,
          linewidth: 1.5 
        }));
        wallMesh.add(wallEdgesLine);

        // Face normal arrow helpers
        if (showNormals) {
          const normalDir = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...w.quaternion));
          const arrowHelper = new THREE.ArrowHelper(
            normalDir,
            new THREE.Vector3(0, 0, 0),
            0.4,
            0x4f46e5,
            0.1,
            0.05
          );
          wallMesh.add(arrowHelper);
        }

        // Window/Door templates in walls
        if (w.holes && w.holes.length > 0) {
          w.holes.forEach(hole => {
            const hGeom = new THREE.PlaneGeometry(hole.width, hole.height);
            const hMat = new THREE.MeshBasicMaterial({
              color: hole.type === 'door' ? 0x8b5cf6 : 0x38bdf8,
              transparent: true,
              opacity: isWire ? 0.1 : 0.3,
              side: THREE.DoubleSide,
              wireframe: isWire
            });
            const hMesh = new THREE.Mesh(hGeom, hMat);
            hMesh.position.set(hole.x, hole.y, 0);
            wallGroup.add(hMesh);

            const hEdges = new THREE.EdgesGeometry(hGeom);
            const hLine = new THREE.LineSegments(hEdges, new THREE.LineBasicMaterial({ 
              color: hole.type === 'door' ? 0x8b5cf6 : 0x38bdf8, 
              linewidth: 1.5 
            }));
            hMesh.add(hLine);
          });
        }

        roomContentGroup.add(wallGroup);
      });
    }

    // 4. Objects (Furniture blocks)
    if (objects && showObjects) {
      objects.forEach(o => {
        let color = 0xf59e0b;
        if (o.type === 'chair') color = 0xf43f5e;
        if (o.type === 'sofa') color = 0xd946ef;
        if (o.type === 'wardrobe') color = 0xf97316;
        if (o.type === 'tv') color = 0x14b8a6;

        const geom = new THREE.BoxGeometry(o.width, o.height, o.depth);

        const isXray = viewStyle === 'xray';
        const isWire = viewStyle === 'wireframe';

        const mat = new THREE.MeshPhysicalMaterial({
          color: color,
          roughness: 0.6,
          metalness: 0.1,
          transparent: isXray || true,
          opacity: isWire ? 1.0 : (isXray ? 0.3 : 0.65),
          wireframe: isWire
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(o.position[0], o.position[1], o.position[2]);
        mesh.quaternion.set(o.quaternion[0], o.quaternion[1], o.quaternion[2], o.quaternion[3]);
        roomContentGroup.add(mesh);

        const edges = new THREE.EdgesGeometry(geom);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: color, linewidth: 1.5 }));
        mesh.add(line);
      });
    }

    // 5. Grid placement indicator helper below the model
    if (showGridIndicator) {
      const gridHelper = new THREE.GridHelper(3.5, 14, 0x6366f1, 0x334155);
      gridHelper.position.y = floorY - 0.01; // put standard grid slightly below simulated floor
      roomContentGroup.add(gridHelper);
    }

    // Handle interactive resize observer
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(containerRef.current);

    // Render loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      // Let the model float or bounce slightly if unlocked for visual feedback, or keep still
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, [
    scale, rotationY, offsetX, offsetY, offsetZ, 
    viewStyle, showWalls, showFloor, showCeiling, 
    showObjects, showGridIndicator, showNormals
  ]);

  // Touch/Mouse click-to-move spatial handler (drag on screen space mapping left-right, up-down)
  const isDragging = useRef<boolean>(false);
  const previousTouchRef = useRef<{ x: number, y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isLocked) return;
    isDragging.current = true;
    previousTouchRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !previousTouchRef.current || isLocked) return;
    
    const deltaX = e.clientX - previousTouchRef.current.x;
    const deltaY = e.clientY - previousTouchRef.current.y;

    // Direct movement scale based on speed
    // Dragging horizontally moves offsetX left/right
    // Dragging vertically moves offsetZ forward/backward to simulate positioning in space
    setOffsetX(p => p + deltaX * 0.005);
    setOffsetZ(p => p + deltaY * 0.005);

    previousTouchRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    isDragging.current = false;
    previousTouchRef.current = null;
  };

  // Capture current screen frame composite
  const captureSnapshot = async () => {
    if (!canvasRef.current) {
      toast.error('WebGL canvas is not active!');
      return;
    }

    try {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = canvasRef.current.width;
      snapCanvas.height = canvasRef.current.height;
      const ctx = snapCanvas.getContext('2d');
      if (!ctx) return;

      // Draw active camera video background if camera is working
      if (videoRef.current && streamRef.current && isCameraActive) {
        // Draw the exact sized frame cropped to center
        const video = videoRef.current;
        const videoRatio = video.videoWidth / video.videoHeight;
        const canvasRatio = snapCanvas.width / snapCanvas.height;

        let sx = 0, sy = 0, sWidth = video.videoWidth, sHeight = video.videoHeight;
        if (videoRatio > canvasRatio) {
          sWidth = video.videoHeight * canvasRatio;
          sx = (video.videoWidth - sWidth) / 2;
        } else {
          sHeight = video.videoWidth / canvasRatio;
          sy = (video.videoHeight - sHeight) / 2;
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, snapCanvas.width, snapCanvas.height);
      } else {
        // Fallback backdrop color if camera forbidden
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, snapCanvas.width, snapCanvas.height);
      }

      // Draw the transparent WebGL canvas drawing group over background
      ctx.drawImage(canvasRef.current, 0, 0);

      // Trigger download links
      const dataUrl = snapCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `ar_projection_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Holographic AR snapshot saved to your photo roll!');
    } catch (e) {
      console.error(e);
      toast.error('Failed to capture snapshot. Check site security settings.');
    }
  };

  const resetProjector = () => {
    setScale(0.3);
    setRotationY(0);
    setOffsetX(0);
    setOffsetY(-0.5);
    setOffsetZ(-2.0);
    toast.message('Alignment calibration reset to default parameters.');
  };

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-black overflow-hidden flex flex-col z-50 select-none">
      
      {/* Hidden native HTML video element capturing direct hardware stream feed */}
      <video 
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ pointerEvents: 'none' }}
      />

      {/* Transparent overlay WebGL Scene */}
      <div 
        ref={containerRef}
        className="absolute inset-0 w-full h-full z-10 touch-none pointer-events-auto cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />

      {/* Top Floating Glassmorphic HUD Controls */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-20 pointer-events-none gap-4">
        <Button 
          variant="outline" 
          className="pointer-events-auto bg-slate-950/80 backdrop-blur-md border border-white/10 text-white rounded-full px-4 py-2 hover:bg-slate-900 shadow-xl"
          onClick={onClose}
        >
          <ArrowLeft className="w-5 h-5 mr-1.5" />
          Leave AR Mode
        </Button>

        <span className="bg-indigo-600/90 backdrop-blur text-white px-3.5 py-1.5 rounded-full text-xs font-bold font-mono border border-indigo-400/20 tracking-wider flex items-center gap-1.5 shadow-xl hidden sm:flex">
          <Layers className="w-3.5 h-3.5 animate-pulse" />
          AR PROJECTOR ACTIVE
        </span>

        <div className="flex gap-2 pointer-events-auto">
          <Button
            variant="outline"
            size="icon"
            className={`rounded-full h-10 w-10 border border-white/10 text-white shadow-xl ${isCameraActive ? 'bg-indigo-700/80 hover:bg-indigo-600' : 'bg-slate-950/80 hover:bg-slate-900'}`}
            onClick={() => setIsCameraActive(!isCameraActive)}
            title={isCameraActive ? "Disable Camera Stream" : "Enable Camera Stream"}
          >
            <Camera className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className={`rounded-full h-10 w-10 border border-white/10 text-white shadow-xl ${isLocked ? 'bg-rose-700/80 hover:bg-rose-600' : 'bg-slate-950/80 hover:bg-slate-900'}`}
            onClick={() => {
              setIsLocked(!isLocked);
              toast.info(isLocked ? "Calibration unlocked! Drag screen or adjust parameters." : "Calibration locked! Gesture controls disabled.");
            }}
            title={isLocked ? "Unlock Calibration" : "Lock Calibration"}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Center Reticle Guidance when Unlocked */}
      {!isLocked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 animate-pulse">
          <div className="relative w-16 h-16 border-2 border-dashed border-indigo-400/30 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-indigo-400 rounded-full" />
            <div className="absolute top-0 w-4 h-0.5 bg-indigo-400" />
            <div className="absolute bottom-0 w-4 h-0.5 bg-indigo-400" />
            <div className="absolute left-0 w-0.5 h-4 bg-indigo-400" />
            <div className="absolute right-0 w-0.5 h-4 bg-indigo-400" />
          </div>
        </div>
      )}

      {/* Right Floating Display Style Panel */}
      <div className="absolute right-4 top-[84px] md:top-[88px] z-20 flex flex-col gap-2 pointer-events-auto">
        <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 p-2.5 rounded-2xl flex flex-col gap-1.5 shadow-2xl w-44">
          <h4 className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest px-1.5 pb-1 border-b border-white/10 mb-1.5 flex items-center gap-1">
            <Sliders className="w-3 h-3 text-indigo-400" />
            Material Style
          </h4>
          
          <button 
            onClick={() => setViewStyle('solid')}
            className={`flex items-center gap-2 text-left w-full px-2 py-1.5 rounded-lg text-xs transition ${viewStyle === 'solid' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-white/5'}`}
          >
            <Box className="w-3.5 h-3.5" />
            Solid Render
          </button>

          <button 
            onClick={() => setViewStyle('xray')}
            className={`flex items-center gap-2 text-left w-full px-2 py-1.5 rounded-lg text-xs transition ${viewStyle === 'xray' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-white/5'}`}
          >
            <Layers className="w-3.5 h-3.5" />
            X-Ray Ghost
          </button>

          <button 
            onClick={() => setViewStyle('wireframe')}
            className={`flex items-center gap-2 text-left w-full px-2 py-1.5 rounded-lg text-xs transition ${viewStyle === 'wireframe' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:bg-white/5'}`}
          >
            <Grid className="w-3.5 h-3.5" />
            Wireframe
          </button>
        </div>

        <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 p-2.5 rounded-2xl flex flex-col gap-2 shadow-2xl w-44">
          <h4 className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest px-1.5 pb-1 border-b border-white/10 mb-1 flex items-center gap-1">
            <Eye className="w-3 h-3 text-emerald-400" />
            Toggle Layers
          </h4>

          <label className="flex items-center justify-between px-1.5 cursor-pointer text-xs text-slate-200">
            <span>Walls</span>
            <input 
              type="checkbox" 
              checked={showWalls}
              onChange={(e) => setShowWalls(e.target.checked)}
              className="w-7 h-3.5 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-2.5 before:w-2.5 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-3.5 before:transition-all"
            />
          </label>

          <label className="flex items-center justify-between px-1.5 cursor-pointer text-xs text-slate-200">
            <span>Floor</span>
            <input 
              type="checkbox" 
              checked={showFloor}
              onChange={(e) => setShowFloor(e.target.checked)}
              className="w-7 h-3.5 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-2.5 before:w-2.5 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-3.5 before:transition-all"
            />
          </label>

          <label className="flex items-center justify-between px-1.5 cursor-pointer text-xs text-slate-200">
            <span>Ceiling</span>
            <input 
              type="checkbox" 
              checked={showCeiling}
              onChange={(e) => setShowCeiling(e.target.checked)}
              className="w-7 h-3.5 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-2.5 before:w-2.5 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-3.5 before:transition-all"
            />
          </label>

          <label className="flex items-center justify-between px-1.5 cursor-pointer text-xs text-slate-200">
            <span>Furniture</span>
            <input 
              type="checkbox" 
              checked={showObjects}
              onChange={(e) => setShowObjects(e.target.checked)}
              className="w-7 h-3.5 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-2.5 before:w-2.5 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-3.5 before:transition-all"
            />
          </label>

          <label className="flex items-center justify-between px-1.5 cursor-pointer text-xs text-slate-200">
            <span>Spatial Grid</span>
            <input 
              type="checkbox" 
              checked={showGridIndicator}
              onChange={(e) => setShowGridIndicator(e.target.checked)}
              className="w-7 h-3.5 rounded-full bg-slate-800 checked:bg-indigo-600 cursor-pointer appearance-none relative before:content-[''] before:absolute before:h-2.5 before:w-2.5 before:rounded-full before:bg-white before:top-0.5 before:left-0.5 checked:before:translate-x-3.5 before:transition-all"
            />
          </label>
        </div>
      </div>

      {/* Camera Feed Block Alert Diagnostic */}
      {cameraPermissionError && (
        <div className="absolute left-4 top-[84px] max-w-xs z-20 bg-amber-950/90 border border-amber-500/20 p-3 rounded-2xl flex gap-2 text-amber-200 pointer-events-auto leading-normal text-[11px] shadow-2xl backdrop-blur-md">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{cameraPermissionError}</span>
        </div>
      )}

      {/* Bottom Interactive HUD Calibrations Panel */}
      <div className="absolute bottom-0 inset-x-0 p-4 md:p-6 z-20 pointer-events-none flex flex-col md:flex-row gap-4 items-stretch md:items-end justify-between">
        
        {/* Alignment controls card */}
        <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 rounded-2xl p-4 w-full md:w-[350px] pointer-events-auto flex flex-col gap-3.5 text-white shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-center pb-2 border-b border-white/10">
            <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 text-indigo-400">
              <RotateCw className="w-3.5 h-3.5" /> 
              Spatial Calibrations
            </h3>
            <button 
              onClick={resetProjector}
              className="text-[10px] text-slate-400 hover:text-white font-semibold transition"
            >
              Reset Calib
            </button>
          </div>

          {/* SLIDERS control calibration */}
          <div className="space-y-2.5">
            {/* Scale slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300 font-medium font-mono">
                <span>Model Scale</span>
                <span>{(scale).toFixed(2)}x</span>
              </div>
              <input 
                type="range"
                min="0.05"
                max="2.0"
                step="0.05"
                value={scale}
                disabled={isLocked}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>

            {/* Yaw rotation Y slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300 font-medium font-mono">
                <span>Rotation (Angle Y)</span>
                <span>{rotationY}°</span>
              </div>
              <input 
                type="range"
                min="0"
                max="360"
                step="5"
                value={rotationY}
                disabled={isLocked}
                onChange={(e) => setRotationY(parseInt(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>

            {/* Height (Position Y) slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300 font-medium font-mono">
                <span>Height Offset (Y-axis)</span>
                <span>{(offsetY).toFixed(2)}m</span>
              </div>
              <input 
                type="range"
                min="-2.5"
                max="1.5"
                step="0.05"
                value={offsetY}
                disabled={isLocked}
                onChange={(e) => setOffsetY(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>

            {/* Depth Distance (Position Z) slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300 font-medium font-mono">
                <span>Distance Depth (Z-axis)</span>
                <span>{Math.abs(offsetZ).toFixed(2)}m</span>
              </div>
              <input 
                type="range"
                min="-5.0"
                max="-0.5"
                step="0.05"
                value={offsetZ}
                disabled={isLocked}
                onChange={(e) => setOffsetZ(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>

          <div className="text-[10px] text-slate-400 border-t border-white/5 pt-2 flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{!isLocked ? "Drag screen with touch/mouse to slide position horizontally" : "Calibrations locked. Toggle lock state at top-right to edit."}</span>
          </div>
        </div>

        {/* Central snapshot triggers HUD */}
        <div className="pointer-events-auto flex items-center justify-center gap-3 bg-slate-950/80 backdrop-blur border border-white/10 py-3.5 px-6 rounded-full shadow-2xl self-center mx-auto md:mr-0 z-10">
          <Button 
            className="rounded-full h-14 w-14 bg-white text-slate-950 hover:bg-slate-200 shadow-2xl shrink-0 flex items-center justify-center transition border border-white"
            onClick={captureSnapshot}
            title="Shatter Hologram Snapshot"
          >
            <Camera className="w-6 h-6" />
          </Button>

          <div className="flex flex-col text-left">
            <span className="text-white text-xs font-bold font-sans tracking-wide">Capture Composite</span>
            <span className="text-slate-400 text-[10px]">Save photo overlay to device disk</span>
          </div>
        </div>

      </div>

    </div>
  );
}
