import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Activity, Check, Gauge, RotateCcw, Scan, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui/button';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RoomLighting, RoomModel } from '../core/models/types';
import { MiniMap } from './MiniMap';

export interface SensorSnapshot {
  timestamp: number;
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  acceleration?: { x: number | null; y: number | null; z: number | null };
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null };
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null };
  motionMagnitude: number;
  angularSpeed: number;
}

export interface ScannedPlane {
  id: number;
  orientation: string;
  semanticLabel?: string;
  polygon: {x: number, y: number, z: number}[];
  position: {x: number, y: number, z: number};
  quaternion: {x: number, y: number, z: number, w: number};
  color: number;
  area?: number;
  confidence?: number;
  hitCount?: number;
  lastSeen?: number;
  sensor?: SensorSnapshot;
  depthActive?: boolean;
}

type SensorPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';
type MotionQuality = 'camera-only' | 'hold-steady' | 'good' | 'too-fast';
type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
};

type ScanQualityState = {
  stablePlanes: number;
  totalPlanes: number;
  motionQuality: MotionQuality;
  sensorPermission: SensorPermissionState;
  message: string;
  angularSpeed: number;
  motionMagnitude: number;
  depthActive: boolean;
  wakeLockActive: boolean;
};

const SESSION_START_TIMEOUT_MS = 8000;
const STABLE_PLANE_HITS = 6;
const MIN_PLANE_AREA_M2 = 0.04;

const DEFAULT_SCAN_QUALITY: ScanQualityState = {
  stablePlanes: 0,
  totalPlanes: 0,
  motionQuality: 'camera-only',
  sensorPermission: 'unknown',
  message: 'Camera-only mode until motion sensors respond.',
  angularSpeed: 0,
  motionMagnitude: 0,
  depthActive: false,
  wakeLockActive: false
};

type XRSessionLike = {
  end: () => Promise<void>;
};

type XRSystemLike = {
  requestSession?: (mode: 'immersive-ar', options: Record<string, unknown>) => Promise<XRSessionLike>;
};

type PermissionCapableEvent = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const getXRSystem = () => (navigator as Navigator & { xr?: XRSystemLike }).xr;

const clearSessionStartTimer = (timerRef: React.MutableRefObject<number | null>) => {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

const getSessionErrorMessage = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera/AR permission was denied. Please allow camera access and try again.';
  }

  if (name === 'NotSupportedError') {
    return 'This browser or device does not support the WebXR plane detection needed for scanning.';
  }

  return 'Could not start AR. Please try again on a secure HTTPS page with a WebXR-compatible browser.';
};

const getDetectedPlaneSet = (detectedPlanes: unknown): Set<any> | null => {
  if (!detectedPlanes) return null;
  if (detectedPlanes instanceof Set) return detectedPlanes;

  try {
    return new Set(Array.from(detectedPlanes as Iterable<any>));
  } catch (error) {
    console.warn('Ignoring unsupported detectedPlanes payload', error);
    return null;
  }
};

const disposePlaneMesh = (mesh: THREE.Mesh) => {
  mesh.geometry?.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else {
    material?.dispose();
  }
};

const toFiniteNumber = (value: number | null | undefined) => Number.isFinite(value) ? value as number : 0;

const vectorMagnitude = (vector?: { x: number | null; y: number | null; z: number | null } | null) => {
  if (!vector) return 0;
  const x = toFiniteNumber(vector.x);
  const y = toFiniteNumber(vector.y);
  const z = toFiniteNumber(vector.z);
  return Math.sqrt(x * x + y * y + z * z);
};

const rotationMagnitude = (rotation?: { alpha: number | null; beta: number | null; gamma: number | null } | null) => {
  if (!rotation) return 0;
  const alpha = toFiniteNumber(rotation.alpha);
  const beta = toFiniteNumber(rotation.beta);
  const gamma = toFiniteNumber(rotation.gamma);
  return Math.sqrt(alpha * alpha + beta * beta + gamma * gamma);
};

const cloneVector = (vector?: DeviceMotionEventAcceleration | null) => ({
  x: vector?.x ?? null,
  y: vector?.y ?? null,
  z: vector?.z ?? null
});

const polygonArea = (points: {x: number, y: number, z: number}[]) => {
  if (points.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.z - next.x * current.z;
  }

  return Math.abs(sum) / 2;
};

const getMotionQuality = (snapshot: SensorSnapshot | null, permission: SensorPermissionState): MotionQuality => {
  if (permission !== 'granted' || !snapshot) return 'camera-only';
  if (snapshot.angularSpeed > 160 || snapshot.motionMagnitude > 7) return 'too-fast';
  if (snapshot.angularSpeed < 4 && snapshot.motionMagnitude < 0.08) return 'hold-steady';
  return 'good';
};

const getMotionMessage = (quality: MotionQuality, depthActive: boolean) => {
  const depthPrefix = depthActive ? 'Depth sensing is active. ' : '';

  if (quality === 'good') return `${depthPrefix}Sensor fusion active. Keep a slow, steady pan for best plane quality.`;
  if (quality === 'too-fast') return `${depthPrefix}Move slower — fast rotation reduces plane accuracy.`;
  if (quality === 'hold-steady') return `${depthPrefix}Start panning slowly so IMU data can improve scan confidence.`;
  return `${depthPrefix}Camera-only mode. Enable motion sensors for better scan quality guidance.`;
};

const getMotionScore = (quality: MotionQuality) => {
  if (quality === 'good') return 1;
  if (quality === 'hold-steady') return 0.65;
  if (quality === 'too-fast') return 0.35;
  return 0.5;
};

const getPlaneConfidence = (area: number, hitCount: number, motionQuality: MotionQuality, depthActive: boolean) => {
  const areaScore = Math.min(area / 1.2, 1);
  const persistenceScore = Math.min(hitCount / 24, 1);
  const depthScore = depthActive ? 1 : 0.45;
  return Math.round((areaScore * 0.3 + persistenceScore * 0.35 + getMotionScore(motionQuality) * 0.25 + depthScore * 0.1) * 100);
};

const hasDepthInformation = (frame: any, referenceSpace: any) => {
  if (!frame?.getViewerPose || !frame?.getDepthInformation) return false;

  try {
    const viewerPose = frame.getViewerPose(referenceSpace);
    return Boolean(viewerPose?.views?.some((view: any) => frame.getDepthInformation(view)));
  } catch {
    return false;
  }
};

export function ARScanner({ onComplete, onCancel }: { onComplete: (planes: ScannedPlane[]) => void, onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePlanesCount, setActivePlanesCount] = useState(0);
  const [scanQuality, setScanQuality] = useState<ScanQualityState>(DEFAULT_SCAN_QUALITY);
  const scanQualityRef = useRef<ScanQualityState>(DEFAULT_SCAN_QUALITY);
  const planesDataRef = useRef<Map<any, ScannedPlane>>(new Map());
  const startRequestedRef = useRef(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sessionRef = useRef<XRSessionLike | null>(null);
  const sessionStartTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const sensorSnapshotRef = useRef<SensorSnapshot | null>(null);
  const sensorPermissionRef = useRef<SensorPermissionState>('unknown');
  const lastSensorUiUpdateRef = useRef(0);
  const lastQualityUiUpdateRef = useRef(0);
  const stablePlaneCountRef = useRef(0);
  const totalPlaneCountRef = useRef(0);
  const depthActiveRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [sessionStartError, setSessionStartError] = useState<string | null>(null);

  const updateScanQuality = (stablePlanes: number, totalPlanes: number, timestamp = performance.now(), force = false) => {
    const snapshot = sensorSnapshotRef.current;
    const motionQuality = getMotionQuality(snapshot, sensorPermissionRef.current);
    const depthActive = depthActiveRef.current;
    const wakeLockActive = Boolean(wakeLockRef.current);
    const shouldUpdate = force ||
      stablePlaneCountRef.current !== stablePlanes ||
      totalPlaneCountRef.current !== totalPlanes ||
      scanQualityRef.current.motionQuality !== motionQuality ||
      scanQualityRef.current.sensorPermission !== sensorPermissionRef.current ||
      scanQualityRef.current.depthActive !== depthActive ||
      scanQualityRef.current.wakeLockActive !== wakeLockActive ||
      timestamp - lastQualityUiUpdateRef.current > 650;

    stablePlaneCountRef.current = stablePlanes;
    totalPlaneCountRef.current = totalPlanes;

    if (!shouldUpdate) return;

    lastQualityUiUpdateRef.current = timestamp;
    const nextQuality = {
      stablePlanes,
      totalPlanes,
      motionQuality,
      sensorPermission: sensorPermissionRef.current,
      message: getMotionMessage(motionQuality, depthActive),
      angularSpeed: snapshot?.angularSpeed ?? 0,
      motionMagnitude: snapshot?.motionMagnitude ?? 0,
      depthActive,
      wakeLockActive
    };

    scanQualityRef.current = nextQuality;
    setScanQuality(nextQuality);
  };

  useEffect(() => {
    const onDeviceMotion = (event: DeviceMotionEvent) => {
      const acceleration = cloneVector(event.acceleration);
      const accelerationIncludingGravity = cloneVector(event.accelerationIncludingGravity);
      const rotationRate = {
        alpha: event.rotationRate?.alpha ?? null,
        beta: event.rotationRate?.beta ?? null,
        gamma: event.rotationRate?.gamma ?? null
      };

      sensorPermissionRef.current = 'granted';
      sensorSnapshotRef.current = {
        ...(sensorSnapshotRef.current || { timestamp: event.timeStamp, motionMagnitude: 0, angularSpeed: 0 }),
        timestamp: event.timeStamp,
        acceleration,
        accelerationIncludingGravity,
        rotationRate,
        motionMagnitude: vectorMagnitude(event.acceleration),
        angularSpeed: rotationMagnitude(event.rotationRate)
      };

      if (event.timeStamp - lastSensorUiUpdateRef.current > 350) {
        lastSensorUiUpdateRef.current = event.timeStamp;
        updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes);
      }
    };

    const onDeviceOrientation = (event: DeviceOrientationEvent) => {
      sensorPermissionRef.current = 'granted';
      sensorSnapshotRef.current = {
        ...(sensorSnapshotRef.current || { timestamp: event.timeStamp, motionMagnitude: 0, angularSpeed: 0 }),
        timestamp: event.timeStamp,
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma
      };
    };

    window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
    window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });

    return () => {
      window.removeEventListener('devicemotion', onDeviceMotion);
      window.removeEventListener('deviceorientation', onDeviceOrientation);
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!containerRef.current) return;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.xr.enabled = true;
    // renderer.xr.setFramebufferScaleFactor(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const onSessionStart = () => {
      clearSessionStartTimer(sessionStartTimerRef);
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(null);
    };
    const onSessionEnd = () => {
      sessionRef.current = null;
      startRequestedRef.current = false;
      depthActiveRef.current = false;
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      updateScanQuality(stablePlaneCountRef.current, totalPlaneCountRef.current, performance.now(), true);
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
    };
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    const planesMap = new Map<any, THREE.Mesh>();
    let currentSession: XRSessionLike | null = null;
    let planeIdCounter = 0;
    let planeSupportChecked = false;
    let lastScanTime = Date.now();
    let lastPlaneCount = 0;
    let slowProgressCount = 0;
    let xrLightProbe: any = null;
    let lightProbeRequested = false;
    
    // Store latest room lighting
    const currentLighting = {
        ambientColor: 0xffffff,
        ambientIntensity: 0.5,
        primaryLightDirection: [0, -1, 0] as [number, number, number],
        primaryLightColor: 0xffffff,
        primaryLightIntensity: 0.0
    };

    onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    const planeGeometryVersion = new Map<any, number>();
    const render = (timestamp: number, frame: any) => {
      if (frame) {
        currentSession = renderer.xr.getSession() as XRSessionLike | null;
        sessionRef.current = currentSession;
        const referenceSpace = renderer.xr.getReferenceSpace();
        if (!referenceSpace) {
          renderer.render(scene, camera);
          return;
        }

        const depthActive = hasDepthInformation(frame, referenceSpace);
        if (depthActiveRef.current !== depthActive) depthActiveRef.current = depthActive;

        const detectedPlanes = getDetectedPlaneSet(frame.detectedPlanes);
        if (detectedPlanes) {
          detectedPlanes.forEach((plane: any) => {
            const pose = frame.getPose(plane.planeSpace, referenceSpace);
            if (!pose) return;

            const isHoriz = plane.orientation?.toLowerCase() === 'horizontal';
            const isVert = plane.orientation?.toLowerCase() === 'vertical';

            const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.transform.orientation);
            let isValidAngle = true;
            if (isHoriz && Math.abs(normal.y) < 0.85) isValidAngle = false;
            if (isVert && Math.abs(normal.y) > 0.15) isValidAngle = false;

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            let worldMinY = Infinity, worldMaxY = -Infinity;
            for (let i = 0; i < plane.polygon.length; i++) {
              const p = plane.polygon[i];
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minZ = Math.min(minZ, p.z);
              maxZ = Math.max(maxZ, p.z);

              const wp = new THREE.Vector3(p.x, p.y, p.z)
                            .applyQuaternion(pose.transform.orientation)
                            .add(new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z));
              worldMinY = Math.min(worldMinY, wp.y);
              worldMaxY = Math.max(worldMaxY, wp.y);
            }
            const areaApprox = (maxX - minX) * (maxZ - minZ);
            
            // Improved detection heuristics based on physical dimensions
            const heightApprox = worldMaxY - worldMinY;
            const widthApprox = areaApprox / Math.max(0.001, heightApprox);

            let semanticClass = plane.semanticLabel?.toLowerCase();
            
            // If missing or just "wall", analyze shape to refine detection
            if (!semanticClass || semanticClass === 'unknown' || semanticClass === 'wall') {
              if (isHoriz) {
                if (pose.transform.position.y < 0.3) semanticClass = 'floor';
                else if (pose.transform.position.y > 1.8) semanticClass = 'ceiling';
                else if (pose.transform.position.y < 0.65 && areaApprox < 0.6) semanticClass = 'chair';
                else if (pose.transform.position.y < 0.65 && areaApprox >= 0.6) semanticClass = 'sofa';
                else if (areaApprox < 3.0) semanticClass = 'table';
                else semanticClass = 'unknown';
              } else if (isVert) {
                // Door: reaches floor, typ. 1.9-2.2m tall, 0.7-1.2m wide
                if (worldMinY < 0.4 && heightApprox > 1.8 && widthApprox >= 0.6 && widthApprox <= 1.4) {
                   semanticClass = 'door';
                } 
                // Window: floating off floor, reasonable size
                else if (worldMinY >= 0.5 && heightApprox >= 0.4 && widthApprox >= 0.4 && widthApprox <= 3.0) {
                   semanticClass = 'window';
                }
                // Wardrobe / Tall Cabinet: thick, not too wide, sitting on floor
                else if (worldMinY < 0.3 && widthApprox >= 0.4 && widthApprox <= 2.5 && heightApprox >= 1.0 && heightApprox <= 2.8) {
                   semanticClass = 'wardrobe';
                }
                // TV / Monitor: floating, very thin
                else if (worldMinY >= 0.5 && widthApprox >= 0.6 && widthApprox <= 2.0 && heightApprox >= 0.4 && heightApprox <= 1.5) {
                   semanticClass = 'tv';
                }
                // Door frame / Pillar / Edge: tall but narrow
                else if (widthApprox < 0.4 && heightApprox > 1.2) {
                   semanticClass = 'door_frame';
                }
                else {
                   semanticClass = 'wall';
                }
              } else {
                 semanticClass = 'unknown';
              }
            }

            let requiredArea = 0.1;
            // Lowered thresholds to detect smaller features like door frames and complex room geometries
            if (semanticClass === 'door_frame') {
               requiredArea = 0.01;
            } else if (['table', 'chair', 'sofa', 'door', 'window'].includes(semanticClass)) {
               requiredArea = 0.02; // Very small for frames and furniture
            } else if (semanticClass === 'floor' || semanticClass === 'ceiling') {
               requiredArea = 0.1; 
            } else if (semanticClass === 'wall') {
               requiredArea = 0.05; // Lowered to catch short partition walls and corners
            }

            if (!isValidAngle || areaApprox < requiredArea) {
               let mesh = planesMap.get(plane);
               if (mesh) mesh.visible = false;
               planesDataRef.current.delete(plane);
               return;
            }

            let color = 0x9ca3af; 
            if (semanticClass === 'floor') color = 0x10b981; 
            else if (semanticClass === 'ceiling') color = 0x06b6d4; 
            else if (semanticClass === 'wall') color = 0x3b82f6; 
            else if (semanticClass === 'door_frame') color = 0xec4899; 
            else if (semanticClass === 'table') color = 0xf59e0b; 
            else if (semanticClass === 'chair') color = 0xf43f5e; 
            else if (semanticClass === 'sofa') color = 0xd946ef; 
            else if (semanticClass === 'door') color = 0x8b5cf6; 
            else if (semanticClass === 'window') color = 0x38bdf8; 
            else if (semanticClass === 'wardrobe') color = 0xf97316; // Orange
            else if (semanticClass === 'tv') color = 0x14b8a6; // Teal 

            let mesh = planesMap.get(plane);
            if (!mesh) {
              const orientation = typeof plane.orientation === 'string' ? plane.orientation : 'unknown';
              const isHoriz = orientation.toLowerCase() === 'horizontal';
              const color = isHoriz ? 0x10b981 : 0x3b82f6;
              const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8,
                linewidth: 2
              });
              const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0)]);
              mesh = new THREE.LineLoop(geom, material) as unknown as THREE.Mesh;
              
              scene.add(mesh);
              planesMap.set(plane, mesh);

              planesDataRef.current.set(plane, {
                id: planeIdCounter++,
                orientation,
                semanticLabel: plane.semanticLabel,
                color: color,
                polygon: [],
                position: {x: 0, y: 0, z: 0},
                quaternion: {x: 0, y: 0, z: 0, w: 1},
                hitCount: 0,
                confidence: 0,
                area: 0,
                lastSeen: timestamp
              });
              setActivePlanesCount(planesMap.size);
            }

            let pose = null;
            try {
              pose = plane?.planeSpace ? frame.getPose(plane.planeSpace, referenceSpace) : null;
            } catch (error) {
              console.warn('Skipping plane with unavailable pose', error);
            }

            if (pose && mesh) {
              mesh.position.copy(pose.transform.position);
              mesh.quaternion.copy(pose.transform.orientation);

              const poly: {x: number, y: number, z: number}[] = [];
              const polygonPoints = plane?.polygon || [];
              for (let i = 0; i < polygonPoints.length; i++) {
                const p = polygonPoints[i];
                if (Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.z)) {
                  poly.push({x: p.x, y: p.y, z: p.z});
                }
              }

              const currentVersion = plane.lastChangedTime ?? timestamp;
              if (poly.length >= 3 && planeGeometryVersion.get(plane) !== currentVersion) {
                try {
                  const shape = new THREE.Shape();
                  for (let i = 0; i < poly.length; i++) {
                    const p = poly[i];
                    if (i === 0) shape.moveTo(p.x, -p.z);
                    else shape.lineTo(p.x, -p.z);
                  }
                  shape.closePath();
                  const geom = new THREE.ShapeGeometry(shape);
                  geom.rotateX(-Math.PI / 2); // align to WebXR plane local space (Y is normal)
                  mesh.geometry?.dispose();
                  mesh.geometry = geom;
                  planeGeometryVersion.set(plane, currentVersion);
                } catch (error) {
                  console.warn('Skipping invalid plane geometry', error);
                }
              }

              const data = planesDataRef.current.get(plane);
              if (data) {
                const area = polygonArea(poly);
                const nextHitCount = (data.hitCount ?? 0) + 1;
                const motionQuality = getMotionQuality(sensorSnapshotRef.current, sensorPermissionRef.current);

                data.polygon = poly;
                data.position = {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z};
                data.quaternion = {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w};
                data.area = area;
                data.hitCount = nextHitCount;
                data.lastSeen = timestamp;
                data.confidence = getPlaneConfidence(area, nextHitCount, motionQuality, depthActiveRef.current);
                data.sensor = sensorSnapshotRef.current || undefined;
                data.depthActive = depthActiveRef.current;
              }
            }
          });

          let removedPlane = false;
          planesMap.forEach((mesh, plane) => {
            if (!detectedPlanes.has(plane)) {
              scene.remove(mesh);
              disposePlaneMesh(mesh);
              planesMap.delete(plane);
              planeGeometryVersion.delete(plane);
              planesDataRef.current.delete(plane);
              removedPlane = true;
            }
          });

          const stablePlanes = Array.from(planesDataRef.current.values()).filter((plane) =>
            (plane.hitCount ?? 0) >= STABLE_PLANE_HITS &&
            (plane.area ?? 0) >= MIN_PLANE_AREA_M2 &&
            (plane.confidence ?? 0) >= 45
          ).length;
          if (removedPlane) setActivePlanesCount(planesMap.size);
          updateScanQuality(stablePlanes, planesMap.size, timestamp);
        }
      }

      frameCount++;
      if (frameCount % 30 === 0 && planesDataRef.current.size >= 2) {
          try {
              const planesArray = Array.from(planesDataRef.current.values());
              const roomModel = RoomReconstruction.buildRoomModel(planesArray);
              setLiveRoomModel(roomModel);
              
              // Clear previous wireframes safely
              const disposeNode = (node: any) => {
                  if (node.geometry) node.geometry.dispose();
                  if (node.material) {
                      if (Array.isArray(node.material)) {
                          node.material.forEach((m: any) => m.dispose());
                      } else {
                          node.material.dispose();
                      }
                  }
                  if (node.children) {
                      node.children.forEach(disposeNode);
                  }
              };
              wireframeGroup.children.forEach(disposeNode);
              wireframeGroup.clear();

              // Build wireframe for walls
              roomModel.enhancedWalls.forEach(w => {
                  const geometry = new THREE.PlaneGeometry(w.width, w.height);
                  const edges = new THREE.EdgesGeometry(geometry);
                  const material = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 });
                  const line = new THREE.LineSegments(edges, material);
                  line.position.set(w.position[0], w.position[1], w.position[2]);
                  line.quaternion.set(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]);
                  wireframeGroup.add(line);
              });

              // Build wireframe for floor
              if (roomModel.floorHullPoints.length > 2) {
                  const floorPoints: THREE.Vector3[] = [];
                  roomModel.floorHullPoints.forEach(p => {
                      floorPoints.push(new THREE.Vector3(p.x, 0, -p.z));
                  });
                  const floorGeom = new THREE.BufferGeometry().setFromPoints(floorPoints);
                  const floorMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
                  
                  const floorLine = new THREE.LineLoop(floorGeom, floorMat);
                  floorLine.position.y = roomModel.floorY;
                  wireframeGroup.add(floorLine);
                  
                  const ceilLine = new THREE.LineLoop(floorGeom, floorMat);
                  ceilLine.position.y = roomModel.ceilingY;
                  wireframeGroup.add(ceilLine);
              }

              // Build wireframe for features
              roomModel.features.forEach(f => {
                  const geometry = new THREE.PlaneGeometry(f.width, f.height);
                  const edges = new THREE.EdgesGeometry(geometry);
                  const material = new THREE.LineBasicMaterial({ color: f.type === 'door' ? 0x8b5cf6 : 0x38bdf8, linewidth: 2 });
                  const line = new THREE.LineSegments(edges, material);
                  line.position.set(f.localCenter[0], 0, f.localCenter[1]);
                  line.rotation.set(-Math.PI / 2, 0, 0);

                  // Features need to be wrapped in a group to apply the parent position/quaternion like in RoomViewer
                  const group = new THREE.Group();
                  group.position.set(f.position[0], f.position[1], f.position[2]);
                  group.quaternion.set(f.quaternion[0], f.quaternion[1], f.quaternion[2], f.quaternion[3]);
                  group.add(line);
                  wireframeGroup.add(group);
              });
              
          } catch(err) {
              console.error("Wireframe update error", err);
          }
      }

      // Update guidance animations
      if (frameCount >= 0) {
        const totalPlanes = planesDataRef.current.size;
        
        // Show floor circle if no floor found or early in scan
        if (totalPlanes === 0) {
            floorCircle.visible = true;
            // Place circle on the floor in front of the camera
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            dir.y = 0;
            if (dir.lengthSq() < 0.01) { dir.set(0, 0, -1); }
            dir.normalize();
            const pos = camera.position.clone().add(dir.multiplyScalar(1.5));
            pos.y = -camera.position.y * 0.8; // Approximate floor if device is held at chest height
            floorCircle.position.copy(pos);
            const scale = 1.0 + Math.sin(timestamp / 150) * 0.2;
            floorCircle.scale.set(scale, scale, scale);
            movingArrow.visible = false;
        } else {
            floorCircle.visible = false;
            
            if (slowProgressCount > 0 && totalPlanes < 10) {
                movingArrow.visible = true;
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                dir.y = 0;
                if (dir.lengthSq() < 0.01) { dir.set(0, 0, -1); }
                dir.normalize();
                
                // Animate arrow swiping left and right
                const swipe = Math.sin(timestamp / 500) * 0.5;
                const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
                
                const pos = camera.position.clone()
                    .add(dir.multiplyScalar(1.0))
                    .add(right.multiplyScalar(swipe));
                
                movingArrow.position.copy(pos);
                // Rotate arrow to point in the direction of swipe
                const pointDir = Math.cos(timestamp / 500) > 0 ? right : right.clone().negate();
                movingArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pointDir);
            } else {
                movingArrow.visible = false;
            }
        }
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(render);

    return () => {
      isMountedRef.current = false;
      clearSessionStartTimer(sessionStartTimerRef);
      const activeSession = currentSession || sessionRef.current;
      rendererRef.current = null;
      sessionRef.current = null;
      renderer.xr.removeEventListener('sessionstart', onSessionStart);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      window.removeEventListener('resize', onWindowResize);
      renderer.setAnimationLoop(null);
      if (activeSession) activeSession.end().catch(() => {});
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      planesMap.forEach(disposePlaneMesh);
      renderer.dispose();
      scene.clear();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  const requestMobileSensorAccess = async () => {
    const motionEvent = window.DeviceMotionEvent as PermissionCapableEvent | undefined;
    const orientationEvent = window.DeviceOrientationEvent as PermissionCapableEvent | undefined;

    if (!motionEvent && !orientationEvent) {
      sensorPermissionRef.current = 'unsupported';
      updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes);
      return;
    }

    const permissionRequests = [motionEvent, orientationEvent]
      .map((eventConstructor) => eventConstructor?.requestPermission)
      .filter((requestPermission): requestPermission is () => Promise<'granted' | 'denied'> => Boolean(requestPermission))
      .map((requestPermission) => requestPermission());

    if (permissionRequests.length === 0) {
      sensorPermissionRef.current = 'granted';
      updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes);
      return;
    }

    try {
      const results = await Promise.all(permissionRequests);
      sensorPermissionRef.current = results.every((result) => result === 'granted') ? 'granted' : 'denied';
    } catch (error) {
      console.warn('Unable to request mobile motion sensors', error);
      sensorPermissionRef.current = 'denied';
    }

    updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes);
  };

  const requestWakeLock = async () => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLock?.request || wakeLockRef.current) return;

    try {
      const sentinel = await wakeLock.request('screen');
      const onRelease = () => {
        wakeLockRef.current = null;
        updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes, performance.now(), true);
      };
      sentinel.addEventListener?.('release', onRelease);
      wakeLockRef.current = sentinel;
      updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes, performance.now(), true);
    } catch (error) {
      console.warn('Unable to request screen wake lock', error);
    }
  };

  const handleStartSession = async () => {
    if (startRequestedRef.current || sessionRef.current) return;

    const xr = getXRSystem();
    const renderer = rendererRef.current;
    const overlayDiv = document.getElementById('ar-overlay');

    if (!xr?.requestSession || !renderer) {
      setIsSessionStarting(false);
      setSessionStartError('WebXR AR is not available in this browser. Use the native LiDAR/RoomPlan or ARCore Depth mode for production mobile capture.');
      startRequestedRef.current = false;
      return;
    }

    startRequestedRef.current = true;
    setIsSessionStarting(true);
    setSessionStartError(null);

    await requestMobileSensorAccess();
    await requestWakeLock();

    const sessionInit: Record<string, unknown> = {
      requiredFeatures: ['plane-detection'],
      optionalFeatures: [
        ...(overlayDiv ? ['dom-overlay'] : []),
        'depth-sensing',
        'hit-test',
        'anchors',
        'light-estimation'
      ],
      depthSensing: {
        usagePreference: ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32']
      }
    };
    if (overlayDiv) sessionInit.domOverlay = { root: overlayDiv };

    renderer.xr.setReferenceSpaceType('local');

    sessionStartTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !startRequestedRef.current) return;
      setSessionStartError('Still waiting for AR permission. Please approve camera/motion prompts to continue.');
    }, SESSION_START_TIMEOUT_MS);

    try {
      const session = await xr.requestSession('immersive-ar', sessionInit);
      sessionRef.current = session;

      try {
        await renderer.xr.setSession(session as any);
      } catch (error) {
        sessionRef.current = null;
        await session.end().catch(() => {});
        throw error;
      }

      clearSessionStartTimer(sessionStartTimerRef);
      startRequestedRef.current = false;
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(null);
    } catch (error) {
      console.warn('Unable to start AR scan session', error);
      clearSessionStartTimer(sessionStartTimerRef);
      sessionRef.current = null;
      startRequestedRef.current = false;
      if (wakeLockRef.current) {
        await wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (!isMountedRef.current) return;
      setIsSessionStarting(false);
      setSessionStartError(getSessionErrorMessage(error));
      updateScanQuality(scanQualityRef.current.stablePlanes, scanQualityRef.current.totalPlanes, performance.now(), true);
    }
  };

  const handleFinish = () => {
      const planesArray = Array.from(planesDataRef.current.values());
      const stablePlanes = planesArray.filter((plane) =>
        (plane.hitCount ?? 0) >= STABLE_PLANE_HITS &&
        (plane.area ?? 0) >= MIN_PLANE_AREA_M2 &&
        (plane.confidence ?? 0) >= 45
      );
      onComplete(stablePlanes.length > 0 ? stablePlanes : planesArray);
  };

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 bg-black touch-none" />
      <div id="ar-overlay" className="absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-6">
        <div className="flex justify-between items-start gap-4">
           <div className="space-y-4 pointer-events-auto max-w-xs">
             <Button
               onClick={handleStartSession}
               disabled={isSessionStarting}
               className="bg-indigo-600 hover:bg-indigo-500 text-white w-full"
             >
               <Scan className="w-5 h-5 mr-2" />
               {isSessionStarting ? 'Starting AR + sensors…' : 'Start Professional Scan'}
             </Button>
             {sessionStartError && (
               <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                 {sessionStartError}
               </p>
             )}
             <div className="bg-black/50 backdrop-blur text-white px-4 py-3 rounded-xl border border-white/10 shadow-lg space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Detected Surfaces</div>
                    <div className="text-3xl font-bold font-mono">{activePlanesCount}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Stable</div>
                    <div className="text-3xl font-bold font-mono text-emerald-300">{scanQuality.stablePlanes}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-200">
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="flex items-center gap-1 text-slate-400"><Gauge className="w-3 h-3" /> Motion</div>
                    <div className={scanQuality.motionQuality === 'too-fast' ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                      {scanQuality.motionQuality.replace('-', ' ')}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="flex items-center gap-1 text-slate-400"><Activity className="w-3 h-3" /> IMU</div>
                    <div className={scanQuality.sensorPermission === 'granted' ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                      {scanQuality.sensorPermission}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="text-slate-400">Depth</div>
                    <div className={scanQuality.depthActive ? 'text-emerald-300 font-semibold' : 'text-slate-300 font-semibold'}>
                      {scanQuality.depthActive ? 'active' : 'optional'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2">
                    <div className="text-slate-400">Screen</div>
                    <div className={scanQuality.wakeLockActive ? 'text-emerald-300 font-semibold' : 'text-slate-300 font-semibold'}>
                      {scanQuality.wakeLockActive ? 'awake' : 'normal'}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{scanQuality.message}</p>
             </div>
             <div className="bg-indigo-500/10 border border-indigo-400/20 rounded-xl px-4 py-3 text-xs text-indigo-100 leading-relaxed">
               <div className="flex items-center gap-2 font-semibold text-indigo-200 mb-1">
                 <ShieldCheck className="w-4 h-4" /> Professional path
               </div>
               Browser WebXR can fuse camera planes with IMU guidance. For highest accuracy, capture with native iOS RoomPlan/LiDAR or Android ARCore Depth and import the result here.
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
        <div className="text-center pb-8 pointer-events-none">
            <p className="bg-black/60 inline-flex items-center gap-2 px-4 py-3 rounded-full text-white text-sm backdrop-blur font-medium border border-white/10">
                <RotateCcw className="w-5 h-5 text-indigo-400" />
                Pan slowly, pause on corners, and keep motion quality green
            </p>
        </div>
      </div>
    </>
  );
}
