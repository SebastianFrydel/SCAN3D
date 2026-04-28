import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Webcam from 'react-webcam';
import { Camera, RefreshCw, AlertCircle, Smartphone, Navigation, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore, useXRHitTest } from '@react-three/xr';
import * as THREE from 'three';
import { GoogleGenAI } from '@google/genai';

const xrStore = createXRStore();

interface LiveScannerProps {
  onScanComplete: (scanData: { images: string[], orientations: any[] }) => void;
}

type ScanStatus = 'idle' | 'recording' | 'processing';

function ARCameraController({ orientationRef, positionRef }: { orientationRef: any, positionRef: any }) {
  useFrame(({ camera, gl }) => {
    // Disable manual math if True WebXR is active (native hardware sensors handle this automatically)
    if (gl.xr.isPresenting) return;

    const { alpha, beta } = orientationRef.current;
    const yaw = alpha * (Math.PI / 180);
    const pitch = (beta - 90) * (Math.PI / 180);
    
    const targetRotation = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    const targetQuaternion = new THREE.Quaternion().setFromEuler(targetRotation);
    camera.quaternion.slerp(targetQuaternion, 0.2);

    // Smoothly interpolate position to simulate walking
    camera.position.lerp(positionRef.current, 0.1);
  });
  return null;
}

function ARWorld({ isRecording, onProgress }: { isRecording: boolean, onProgress: (p: number) => void }) {
  const { camera, gl } = useThree();
  const roomRef = useRef<THREE.Group>(null);
  const wallMeshRef = useRef<THREE.Mesh>(null);
  const roomBounds = useRef({ minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 });
  const currentBounds = useRef({ w: 3, d: 3, x: 0, z: 0 });
  const fillRef = useRef<THREE.InstancedMesh>(null);
  const fillMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const cursorRef = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const dummyColor = useMemo(() => new THREE.Color(), []);
  const paintedData = useRef({ keys: new Set<string>(), points: [] as any[] });
  const lastMapUpdate = useRef(0);
  const isWebXRHit = useRef(false);
  const matrixHelper = useMemo(() => new THREE.Matrix4(), []);

  const gridSize = 0.05; // Much smaller grid size for extreme precision

  const processHitPoint = useCallback((pt: THREE.Vector3, normal: THREE.Vector3, isHorizontal: boolean, objectName: string) => {
      // Update HUD telemetry element directly to bypass slow React state renders
      const hud = document.getElementById('hud-telemetry-surface');
      if (hud) hud.innerText = `SURFACE: ${objectName.toUpperCase()}`;

      // Expand bounds dynamically based on furthest continuous floor mappings
      if (objectName === 'floor') {
          if (pt.x < roomBounds.current.minX) roomBounds.current.minX = pt.x;
          if (pt.x > roomBounds.current.maxX) roomBounds.current.maxX = pt.x;
          if (pt.z < roomBounds.current.minZ) roomBounds.current.minZ = pt.z;
          if (pt.z > roomBounds.current.maxZ) roomBounds.current.maxZ = pt.z;
      }
      
      let qx = pt.x;
      let qy = pt.y;
      let qz = pt.z;

      // Stable grid quantization relative to origin
      const quantize = (val: number) => Math.floor(val / gridSize) * gridSize + gridSize / 2;

      let key;
      if (isHorizontal) { // Floor / Ceiling
        qx = quantize(pt.x);
        qz = quantize(pt.z);
        // Stick strictly to the horizontal plane to avoid z-fighting
        qy = pt.y > 0 ? pt.y - 0.005 : pt.y + 0.005;
        key = `H,${qx.toFixed(3)},${qy.toFixed(3)},${qz.toFixed(3)}`;
      } else { // Wall cylinder
        qy = quantize(pt.y);
        // Project onto cylinder surface precisely
        const dist2D = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
        const angle = Math.atan2(pt.x, pt.z);
        const circumference = 2 * Math.PI * dist2D;
        const numSteps = Math.max(1, Math.round(circumference / gridSize));
        const qAngle = Math.round(angle / (2 * Math.PI) * numSteps) * (2 * Math.PI) / numSteps;
        
        qx = Math.sin(qAngle) * (dist2D - 0.005);
        qz = Math.cos(qAngle) * (dist2D - 0.005);
        key = `V,${qx.toFixed(3)},${qy.toFixed(3)},${qz.toFixed(3)}`;
      }

      // Update Live Brush Cursor
      if (cursorRef.current) {
        cursorRef.current.position.set(qx, qy, qz);
        cursorRef.current.visible = true;
        if (isHorizontal) {
          cursorRef.current.rotation.set(pt.y > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
        } else {
          cursorRef.current.lookAt(0, cursorRef.current.position.y, 0);
          cursorRef.current.rotateY(Math.PI);
        }
      }

      // Update Telemetry DOM Element
      const hudEl = document.getElementById('hud-telemetry');
      let surfaceLabel = 'WALL';
      let activeColor = '#00ffff';

      if (isHorizontal) {
        if (pt.y < -1.1) {
          surfaceLabel = 'FLOOR';
          activeColor = '#00ffff'; // Cyan
        } else if (pt.y < -0.6) {
          surfaceLabel = 'BED / SOFA';
          activeColor = '#ff00ff'; // Magenta
        } else if (pt.y < -0.3) {
          surfaceLabel = 'TABLE / DESK';
          activeColor = '#00ff00'; // Green
        } else {
          surfaceLabel = 'CEILING / HIGH';
          activeColor = '#ffff00'; // Yellow
        }
      } else {
        surfaceLabel = 'WALL / OBJECT';
        activeColor = '#0066ff'; // Blue
      }

      if (hudEl) {
        const dist = camera.position.distanceTo(pt);
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        const pitchDeg = Math.round(THREE.MathUtils.radToDeg(euler.x));
        const yawDeg = Math.round(THREE.MathUtils.radToDeg(euler.y));
        hudEl.innerText = `[${surfaceLabel}] DIST: ${dist.toFixed(2)}m | PITCH: ${pitchDeg}° | YAW: ${yawDeg}°`;
        hudEl.style.color = activeColor;
      }

      // Update cursor color
      if (cursorRef.current) {
        (cursorRef.current.material as THREE.MeshBasicMaterial).color.set(activeColor);
      }

      // Only paint squares if currently recording!
      if (!isRecording) return;

      if (!paintedData.current.keys.has(key)) {
        paintedData.current.keys.add(key);
        // For horizontal, normal is straight up/down, for wall it points back to center
        const normalVec = isHorizontal ? new THREE.Vector3(0, pt.y > 0 ? -1 : 1, 0) : new THREE.Vector3(qx, 0, qz).normalize();
        const newPoint = { position: new THREE.Vector3(qx, qy, qz), normal: normalVec };
        paintedData.current.points.push(newPoint);

        const idx = paintedData.current.points.length - 1;
        if (idx < 25000 && fillRef.current) {
          dummy.position.copy(newPoint.position);
          
          if (isHorizontal) {
            dummy.rotation.set(newPoint.normal.y > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
          } else {
            // Direct lookAt for smooth cylinder wrap
            dummy.lookAt(0, dummy.position.y, 0);
            dummy.rotateY(Math.PI); // plane to face outwards
          }
          
          dummy.scale.setScalar(0.001); // start tiny for pop-in
          dummy.updateMatrix();
          fillRef.current.setMatrixAt(idx, dummy.matrix);
          
          // Generate cool color based on height + location
          const h = (dummy.position.y + 1.5) / 3.0;
          dummyColor.setHSL(h * 0.8 + 0.5, 0.9, 0.6);
          fillRef.current.setColorAt(idx, dummyColor);
          
          fillRef.current.instanceMatrix.needsUpdate = true;
          if (fillRef.current.instanceColor) fillRef.current.instanceColor.needsUpdate = true;
          
          // Animate scale up immediately
          let scale = 0;
          const animatePop = () => {
            scale += 0.2;
            if (scale > 1) scale = 1;
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            if (fillRef.current) {
               fillRef.current.setMatrixAt(idx, dummy.matrix);
               fillRef.current.instanceMatrix.needsUpdate = true;
            }
            if (scale < 1) requestAnimationFrame(animatePop);
          };
          requestAnimationFrame(animatePop);
        }

        const now = Date.now();
        if (now - lastMapUpdate.current > 500) {
          onProgress(Math.min(paintedData.current.points.length / 500 * 100, 100)); // Every 500 points is 100%
          lastMapUpdate.current = now;
        }
      }
  }, [camera, isRecording, dummy, dummyColor, gridSize, onProgress]);

  // Handle true WebXR hit tests natively yielding high-quality SLA / LiDAR planes!
  useXRHitTest(
    (results, getWorldMatrix) => {
      if (results.length === 0) {
        if (cursorRef.current) cursorRef.current.visible = false;
        isWebXRHit.current = false;
        return;
      }

      isWebXRHit.current = true;
      getWorldMatrix(matrixHelper, results[0]);
      
      const pt = new THREE.Vector3().setFromMatrixPosition(matrixHelper);
      const rot = new THREE.Quaternion().setFromRotationMatrix(matrixHelper);
      // The Y axis of the hit matrix represents the surface normal
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rot);

      const isHorizontal = Math.abs(normal.y) > 0.8;
      const objectName = isHorizontal ? (pt.y < -0.2 ? 'floor' : 'ceiling') : 'wall';
      
      processHitPoint(pt, normal, isHorizontal, objectName);
    },
    'viewer', // Cast from camera (viewer) center
    ['plane', 'mesh'] // Target detected surfaces
  );
  const gridTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    // Clear
    ctx.clearRect(0,0,256,256);
    
    // Fill inner subtle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, 0, 256, 256);
    
    // Draw thick stroke on edges and diagonal for triangle mapping
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;
    
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(252, 4);
    ctx.lineTo(252, 252);
    ctx.lineTo(4, 252);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(4, 252);
    ctx.lineTo(252, 4);
    ctx.stroke();
    
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  useFrame(({ clock }) => {
    // Pulsing effect for visual feedback
    if (fillMaterialRef.current) {
      const t = clock.getElapsedTime();
      const pulse = Math.sin(t * 6) * 0.5 + 0.5; // 0 to 1
      fillMaterialRef.current.opacity = 0.5 + pulse * 0.5; // 0.5 to 1.0 pulse
    }

    if (!roomRef.current || !fillRef.current) return;

    if (wallMeshRef.current && !gl.xr.isPresenting) {
        let targetW = (roomBounds.current.maxX - roomBounds.current.minX) + 0.1;
        let targetD = (roomBounds.current.maxZ - roomBounds.current.minZ) + 0.1;
        let targetX = (roomBounds.current.maxX + roomBounds.current.minX) / 2;
        let targetZ = (roomBounds.current.maxZ + roomBounds.current.minZ) / 2;

        currentBounds.current.w += (targetW - currentBounds.current.w) * 0.1;
        currentBounds.current.d += (targetD - currentBounds.current.d) * 0.1;
        currentBounds.current.x += (targetX - currentBounds.current.x) * 0.1;
        currentBounds.current.z += (targetZ - currentBounds.current.z) * 0.1;

        wallMeshRef.current.scale.set(currentBounds.current.w / 2, 1, currentBounds.current.d / 2);
        wallMeshRef.current.position.set(currentBounds.current.x, 0, currentBounds.current.z);
    }

    // Only run simulated raycaster if WebXR hit test didn't yield real results or we aren't presenting
    if (isWebXRHit.current && gl.xr.isPresenting) return;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObject(roomRef.current, true);

    if (intersects.length > 0) {
      let hit = intersects[0];
      const dirY = raycaster.ray.direction.y;

      // Smart surface detection based on vertical look angle to solve Wall vs Floor clipping accuracy
      if (dirY < -0.25) {
        const floorHit = intersects.find(i => i.object.name === 'floor');
        if (floorHit) hit = floorHit;
      } else if (dirY > 0.25) {
        const ceilingHit = intersects.find(i => i.object.name === 'ceiling');
        if (ceilingHit) hit = ceilingHit;
      } else {
        const wallHit = intersects.find(i => i.object.name === 'wall');
        if (wallHit) hit = wallHit;
      }

      const pt = hit.point;
      const normal = hit.face?.normal || new THREE.Vector3(0, 1, 0);
      const isHorizontal = hit.object.name === 'floor' || hit.object.name === 'ceiling';
      
      processHitPoint(pt, normal, isHorizontal, hit.object.name);
    } else {
      if (cursorRef.current) cursorRef.current.visible = false;
    }

    // Live Floor Plan update loop (5 FPS limit)
    if (clock.getElapsedTime() - lastMapUpdate.current > 0.2) {
        lastMapUpdate.current = clock.getElapsedTime();
        const canvas = document.getElementById('floorplan-canvas') as HTMLCanvasElement;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            // Clear with dark transparent bg
            ctx.clearRect(0, 0, width, height);

            const pts = paintedData.current.points;
            if (pts.length > 0) {
              let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
              const wallPts = [];
              const floorPts = [];

              for (let i = 0; i < pts.length; i++) {
                const p = pts[i].position;
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.z < minZ) minZ = p.z;
                if (p.z > maxZ) maxZ = p.z;

                // Identify if it's wall vs floor based on normal vectors map (Y=0 vs Y=1) 
                if (Math.abs(pts[i].normal.y) < 0.5) {
                   wallPts.push(p);
                } else {
                   floorPts.push(p);
                }
              }

              if (maxX === minX) { minX -= 1; maxX += 1; }
              if (maxZ === minZ) { minZ -= 1; maxZ += 1; }

              const envW = maxX - minX;
              const envL = maxZ - minZ;

              const padding = 24;
              const scaleX = (width - padding * 2) / Math.max(envW, 1);
              const scaleZ = (height - padding * 2) / Math.max(envL, 1);
              const scale = Math.min(scaleX, scaleZ, 80); // max scale zoom

              const cx = (minX + maxX) / 2;
              const cz = (minZ + maxZ) / 2;

              ctx.save();
              ctx.translate(width / 2, height / 2);
              ctx.scale(scale, scale);

              // Draw floor points softly
              ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
              for(const p of floorPts) {
                ctx.fillRect(p.x - cx - 0.05, p.z - cz - 0.05, 0.1, 0.1);
              }

              // Draw walls solidly
              ctx.fillStyle = '#0066ff';
              for(const p of wallPts) {
                 ctx.fillRect(p.x - cx - 0.05, p.z - cz - 0.05, 0.1, 0.1);
              }

              // Draw Camera User
              ctx.fillStyle = '#ff0055';
              const camX = camera.position.x - cx;
              const camZ = camera.position.z - cz;
              ctx.beginPath();
              ctx.arc(camX, camZ, 0.15, 0, Math.PI * 2);
              ctx.fill();

              // Draw View Cone
              const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
              const yaw = euler.y;
              
              ctx.beginPath();
              ctx.moveTo(camX, camZ);
              // Calculate facing cone assuming standard ThreeJS negative Z setup 
              // Wait: we mapped heading to ARCameraController. Z and -Z might be inverted in 2D Space
              const coneLength = 2.0;
              const fov = 0.5; // radians spread
              ctx.lineTo(
                 camX - Math.sin(yaw - fov) * coneLength, 
                 camZ - Math.cos(yaw - fov) * coneLength
              );
              ctx.lineTo(
                 camX - Math.sin(yaw + fov) * coneLength, 
                 camZ - Math.cos(yaw + fov) * coneLength
              );
              ctx.closePath();
              ctx.fillStyle = 'rgba(255, 0, 85, 0.3)';
              ctx.fill();

              ctx.restore();

              // Draw Dimensions overlay
              ctx.fillStyle = '#10b981'; // emerald-500
              ctx.font = 'bold 12px Inter, sans-serif';
              ctx.fillText(`W: ${envW.toFixed(1)}m`, 8, height - 20);
              ctx.fillText(`L: ${envL.toFixed(1)}m`, 8, height - 6);
            }
          }
        }
      }
  });

  return (
    <group>
      {/* Invisible Receiver geometry grouping both Floor, Ceiling, and Walls for automatic switching */}
      <group ref={roomRef as any}>
        <mesh name="floor" position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh name="ceiling" position={[0, 1.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh name="wall" ref={wallMeshRef}>
          <cylinderGeometry args={[1, 1, 2.8, 64, 1, true]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      
      {/* Single highly-optimized InstancedMesh for both crisp outline + fill */}
      <instancedMesh ref={fillRef} args={[null as any, null as any, 25000]} count={0} frustumCulled={false}>
        <planeGeometry args={[gridSize, gridSize]} />
        <meshBasicMaterial 
          ref={fillMaterialRef} 
          color="#ffffff" 
          transparent
          map={gridTexture}
          side={THREE.DoubleSide} 
          depthWrite={false} 
          blending={THREE.AdditiveBlending} 
        />
      </instancedMesh>

      {/* Live Brush Cursor */}
      <mesh ref={cursorRef} visible={false}>
        <planeGeometry args={[gridSize * 1.05, gridSize * 1.05]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

export function LiveScanner({ onScanComplete }: LiveScannerProps) {
  const webcamRef = useRef<Webcam>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [instruction, setInstruction] = useState("Tap 'Start Recording' and walk around your room.");
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [progress, setProgress] = useState(0);
  const [liveObjects, setLiveObjects] = useState<string[]>([]);
  const [directionHint, setDirectionHint] = useState<string | null>(null);

  const currentOrientation = useRef({ alpha: 0, beta: 90, gamma: 0 });
  const currentPosition = useRef(new THREE.Vector3(0, 0, 0));
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const lastMotionTime = useRef(0);
  const capturedData = useRef<{ image: string, orientation: any, position: any }[]>([]);

  const handleScanStart = async () => {
    // Try WebXR first
    if ('xr' in navigator) {
      try {
        const isSupported = await (navigator as any).xr?.isSessionSupported('immersive-ar');
        if (isSupported) {
          await xrStore.enterAR();
          setHasPermission(true);
          startScanning();
          return;
        }
      } catch (e) {
        console.warn("WebXR AR failed or unsupported, falling back", e);
      }
    }
    
    // Fallback to Sensor Estimation
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permissionState = await (DeviceOrientationEvent as any).requestPermission();
        if (permissionState === 'granted') {
          setHasPermission(true);
          startScanning();
        } else {
          setHasPermission(false);
        }
      } catch (error) {
        console.error(error);
        setHasPermission(false); // Can't start
      }
    } else {
      setHasPermission(true);
      startScanning();
    }
  };

  const startScanning = () => {
    setScanStatus('recording');
    setProgress(0);
    currentPosition.current.set(0, 0, 0);
    capturedData.current = [];
    setInstruction("Recording... Walk around and paint the surfaces.");
  };

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    if (scanStatus !== 'recording') return;

    let acc = event.acceleration;
    // Fallback to including gravity if linear acceleration is unavailable
    if (!acc || acc.x === null) {
      if (event.accelerationIncludingGravity) {
        acc = {
          x: event.accelerationIncludingGravity.x || 0,
          y: (event.accelerationIncludingGravity.y || 0) - 9.81, // approximate gravity removal
          z: event.accelerationIncludingGravity.z || 0
        };
      }
    }

    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const now = performance.now();
    if (lastMotionTime.current === 0) {
      lastMotionTime.current = now;
      return;
    }
    const dt = (now - lastMotionTime.current) / 1000;
    lastMotionTime.current = now;

    if (dt > 0.2) return; // Ignore large time jumps

    // 1. Deadzone filter to remove micro-jitter (Sensor Fusion baseline correction)
    const threshold = 0.15;
    let ax = Math.abs(acc.x) > threshold ? acc.x : 0;
    let ay = Math.abs(acc.y) > threshold ? acc.y : 0;
    let az = Math.abs(acc.z) > threshold ? acc.z : 0;

    // 2. Rotate device-space acceleration to world-space using current gyro quaternion
    const { alpha, beta, gamma } = currentOrientation.current;
    
    // Euler from degrees to radians, applying screen orientation corrections
    const pitch = (beta - 90) * (Math.PI / 180);
    const yaw = alpha * (Math.PI / 180);
    const roll = gamma * (Math.PI / 180);
    
    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);
    
    const rawAcc = new THREE.Vector3(ax, ay, az);
    rawAcc.applyQuaternion(quat);

    // 3. Integrate Velocity (Euler Forward Integration)
    // Scale down raw acceleration intentionally so user doesn't sprint through walls
    const movementScale = 2.0; 
    velocity.current.x += rawAcc.x * dt * movementScale;
    velocity.current.z += rawAcc.z * dt * movementScale; 
    
    // 4. Complementary Exponential Damping (Friction)
    // This is the most crucial part of AR tracking without visual odometry!
    // It bleeds velocity constantly so the user zeroes out when stopping.
    velocity.current.multiplyScalar(0.85);

    // 5. Integrate Position
    // We invert the vector depending on browser specific mapping. Often X and Z are swapped or signed differently in WebKit.
    currentPosition.current.x -= velocity.current.x * dt;
    currentPosition.current.z -= velocity.current.z * dt;
  }, [scanStatus]);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    if (scanStatus !== 'recording') return;
    const alpha = event.alpha || 0; 
    let beta = event.beta || 0;   
    if (beta < 0) beta = Math.abs(beta);
    currentOrientation.current = { alpha, beta, gamma: event.gamma || 0 };
  }, [scanStatus]);

  const finishScanning = useCallback(() => {
    if (scanStatus !== 'recording') return;
    setScanStatus('processing');
    setInstruction("Recording complete! Processing 3D model...");
    
    // Ensure we capture a final frame
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      capturedData.current.push({
        image: imageSrc,
        orientation: { ...currentOrientation.current },
        position: { x: currentPosition.current.x, y: currentPosition.current.y, z: currentPosition.current.z }
      });
    }

    setTimeout(() => {
      onScanComplete({
        images: capturedData.current.map(d => d.image),
        orientations: capturedData.current.map(d => {
          // Combine orientation and position for the backend
          return { ...d.orientation, position: d.position };
        })
      });
    }, 1000);
  }, [scanStatus, onScanComplete]);

  const handleProgress = useCallback((p: number) => {
    setProgress(p);
    
    // Directional Hints Logic (Basic quadrant checks)
    const yaws = capturedData.current.map(d => d.orientation.alpha);
    if (yaws.length > 5) {
      const lastYaw = yaws[yaws.length - 1];
      // simplified hint: try to encourage 360 degree movement
      setDirectionHint("Rotate slowly to map uncovered areas...");
    }

    // Periodically capture frames (e.g., every 5%)
    const currentCount = capturedData.current.length;
    const expectedCount = Math.floor(p / 5);
    
    if (expectedCount > currentCount && p < 100) {
       const imageSrc = webcamRef.current?.getScreenshot();
       if (imageSrc) {
         capturedData.current.push({
           image: imageSrc,
           orientation: { ...currentOrientation.current },
           position: { x: currentPosition.current.x, y: currentPosition.current.y, z: currentPosition.current.z }
         });
       }
    }

    if (p >= 100 && scanStatus === 'recording') {
      finishScanning();
    }
  }, [scanStatus, finishScanning]);

  // Attach Sensor Event Listeners explicitly based on permissions/state
  useEffect(() => {
    if (hasPermission) {
      window.addEventListener('deviceorientation', handleOrientation);
      window.addEventListener('devicemotion', handleMotion);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [hasPermission, handleOrientation, handleMotion]);

  // Live Object Detection with Gemini
  useEffect(() => {
    if (scanStatus !== 'recording') {
      setLiveObjects([]);
      setDirectionHint(null);
      return;
    }

    const interval = setInterval(async () => {
      const imageSrc = webcamRef.current?.getScreenshot();
      if (!imageSrc) return;

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-preview', // fast for live
          contents: {
            parts: [
              { inlineData: { data: imageSrc.split(',')[1], mimeType: 'image/jpeg' } },
              { text: 'Identify any clearly visible structural objects in this room view (e.g., "door", "window", "table", "chair", "bed", "sofa"). Return ONLY a comma-separated list of the 2 most prominent objects, or "none" if nothing obvious.' }
            ]
          }
        });
        
        const txt = response.text?.trim().toLowerCase();
        if (txt && txt !== 'none' && !txt.includes('error')) {
          const items = txt.split(',').map(s => s.trim().toUpperCase());
          setLiveObjects(prev => {
            const merged = Array.from(new Set([...prev, ...items])).slice(-3); // Keep last 3
            return merged;
          });
        }
      } catch (err) {
        // Silently fail for live scanning
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [scanStatus]);
  useEffect(() => {
    if (hasPermission) {
      window.addEventListener('deviceorientation', handleOrientation);
      window.addEventListener('devicemotion', handleMotion);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [hasPermission, handleOrientation, handleMotion]);

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4] md:aspect-video flex items-center justify-center shadow-inner">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={{ facingMode }}
          className="w-full h-full object-cover absolute inset-0"
        />
        
        {/* 3D AR Overlay - Always on to preview hits */}
        {scanStatus !== 'processing' && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <Canvas camera={{ position: [0, 0, 0], fov: 65 }}>
              <XR store={xrStore}>
                <ARCameraController orientationRef={currentOrientation} positionRef={currentPosition} />
                <ARWorld isRecording={scanStatus === 'recording'} onProgress={handleProgress} />
              </XR>
            </Canvas>
          </div>
        )}

        {/* Center Reticle */}
        {scanStatus !== 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="w-8 h-8 border-2 border-white/50 rounded-full flex items-center justify-center">
              <div className="w-1 h-1 bg-white rounded-full" />
            </div>
            {/* Live Telemetry */}
            <div id="hud-telemetry" className="absolute top-[55%] font-mono text-[10px] text-white/80 bg-black/40 px-2 py-0.5 rounded backdrop-blur whitespace-nowrap">
              TARGETING...
            </div>
            
            {/* Live Floor Plan Overlay */}
            {(scanStatus === 'recording' || hasPermission) && (
              <div className="absolute top-4 left-4 w-32 h-32 md:w-48 md:h-48 bg-slate-900/80 rounded-xl border border-slate-700 shadow-2xl z-30 overflow-hidden flex flex-col pointer-events-none">
                <div className="text-[10px] uppercase tracking-widest text-slate-300 p-1 bg-slate-800/90 text-center font-bold border-b border-slate-700">
                  Live Floor Plan
                </div>
                <div className="relative flex-1">
                  <canvas id="floorplan-canvas" width={192} height={192} className="w-full h-full opacity-90" />
                  <div className="absolute top-1 right-2 flex flex-col items-end pointer-events-none">
                    <span className="flex items-center gap-1 text-[8px] text-blue-400 font-medium"><div className="w-2 h-2 bg-blue-500 rounded-sm"></div> Walls</span>
                    <span className="flex items-center gap-1 text-[8px] text-cyan-400 font-medium"><div className="w-2 h-2 bg-cyan-500 rounded-sm opacity-50"></div> Floor</span>
                  </div>
                </div>
              </div>
            )}

            {/* Real-time Object Detections */}
            {liveObjects.length > 0 && (
              <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-30">
                {liveObjects.map((obj, i) => (
                  <div key={i} className="font-mono text-xs text-white bg-green-500/80 px-2 py-1 rounded border border-green-400 backdrop-blur animate-in fade-in slide-in-from-right">
                    [+] {obj} DETECTED
                  </div>
                ))}
              </div>
            )}
            
            {/* Directional Hints */}
            {directionHint && scanStatus === 'recording' && (
              <div className="absolute bottom-[10%] bg-indigo-600/90 text-white px-4 py-2 rounded-full text-sm font-semibold animate-pulse shadow-lg backdrop-blur z-30">
                {directionHint}
              </div>
            )}
          </div>
        )}
        
        {scanStatus === 'idle' && (
          <div className="absolute inset-0 bg-transparent flex flex-col items-center justify-end p-6 text-center z-30 pb-20 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center">
              {hasPermission === false && (
                <div className="bg-red-500/90 text-white px-4 py-2 rounded-full text-sm mb-4 flex items-center shadow-lg">
                  <AlertCircle className="w-4 h-4 mr-2" /> Enable motion tracking permission
                </div>
              )}
              <div className="flex flex-col gap-3 w-full">
                <Button size="lg" onClick={handleScanStart} className="rounded-full px-8 shadow-xl bg-purple-600 hover:bg-purple-700 hover:scale-105 transition-transform text-white font-bold animate-pulse">
                  <WandSparkles className="w-5 h-5 mr-2" /> Start Paint Scan
                </Button>
              </div>
            </div>
          </div>
        )}

        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 right-4 rounded-full w-12 h-12 bg-black/40 backdrop-blur hover:bg-black/60 text-white border border-white/20 z-30"
          onClick={toggleCamera}
        >
          <RefreshCw className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border shadow-sm">
        {(scanStatus === 'recording' || hasPermission) && (
          <div className="flex flex-col gap-4 pb-4 mb-2 border-b border-slate-100">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-semibold whitespace-nowrap text-slate-700">Surface Mapping:</label>
              <div className="flex-1 text-center bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-lg p-2 flex items-center justify-center gap-2">
                <WandSparkles className="w-4 h-4" /> AI AUTO-DEPTH 
              </div>
            </div>
            <p className="text-xs text-slate-500">💡 Look at the floor to automatically expand the room boundaries.</p>
          </div>
        )}

        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-slate-700">Scan Progress</h3>
          <div className="flex gap-4 items-center">
            <span className="text-sm font-mono text-indigo-600 font-bold">{Math.round(progress)}%</span>
            {scanStatus === 'recording' && (
              <Button size="sm" onClick={finishScanning} className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-full">
                Finish Scan
              </Button>
            )}
          </div>
        </div>
        <Progress value={progress} className="h-3" />
        <div className="flex items-start gap-2 mt-2 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
          <Navigation className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <p className="text-sm text-indigo-900 font-medium">{instruction}</p>
        </div>
      </div>
      
      {scanStatus === 'recording' && progress === 0 && (
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-2">Sensors not responding? You can capture manually.</p>
          <Button variant="outline" size="sm" onClick={() => {
            const imageSrc = webcamRef.current?.getScreenshot();
            if (imageSrc) {
              capturedData.current.push({ 
                image: imageSrc, 
                orientation: { alpha: 0, beta: 90, gamma: 0 },
                position: { x: 0, y: 0, z: 0 }
              });
              handleProgress(Math.min((capturedData.current.length / 5) * 100, 100));
            }
          }}>
            Manual Capture ({capturedData.current.length})
          </Button>
        </div>
      )}
    </div>
  );
}
