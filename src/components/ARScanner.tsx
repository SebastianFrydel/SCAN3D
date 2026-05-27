import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Check, Info, X, Map as MapIcon, ArrowDown, ArrowRight, ArrowLeft, RefreshCw, Compass } from 'lucide-react';
import { Button } from './ui/button';
import { RoomReconstruction } from '../core/processing/RoomReconstruction';
import { RoomLighting, RoomModel } from '../core/models/types';
import { MiniMap } from './MiniMap';

export interface ScannedPlane {
  id: number;
  orientation: string;
  semanticLabel?: string;
  polygon: {x: number, y: number, z: number}[];
  position: {x: number, y: number, z: number};
  quaternion: {x: number, y: number, z: number, w: number};
  color: number;
  lastSeen: number;
}

let isWebXRRequesting = false;

export function ARScanner({ onComplete, onCancel }: { onComplete: (planes: ScannedPlane[], scaleFactor: number, lighting?: RoomLighting) => void, onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePlanesCount, setActivePlanesCount] = useState(0);
  const planesDataRef = useRef<Map<any, ScannedPlane>>(new Map());
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [scanQuality, setScanQuality] = useState<'low' | 'medium' | 'high'>('low');
  const [scanStats, setScanStats] = useState({ floorArea: 0, wallArea: 0, ceilingArea: 0, featureCount: 0, roomHeight: 0 });
  const [liveRoomModel, setLiveRoomModel] = useState<RoomModel | null>(null);
  const [guidanceTip, setGuidanceTip] = useState<string>('Point at floor to start');
  const [guidanceIcon, setGuidanceIcon] = useState<React.ReactNode>(<ArrowDown className="w-8 h-8 md:w-12 md:h-12" />);

  const engineApiRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    let isMounted = true;
    let renderer: THREE.WebGLRenderer;
    let currentSession: any = null;
    let planesMap = new Map<any, THREE.Mesh>();
    let scene = new THREE.Scene();
    
    try {
        const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
        light.position.set(0.5, 1, 0.25);
        scene.add(light);

        const wireframeGroup = new THREE.Group();
        scene.add(wireframeGroup);
        
        // Add guidance animations group
        const guidanceAnimGroup = new THREE.Group();
        scene.add(guidanceAnimGroup);

        // Create a pulsing circle for the floor
        const floorCircleGeom = new THREE.RingGeometry(0.3, 0.4, 32);
        const floorCircleMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
        const floorCircle = new THREE.Mesh(floorCircleGeom, floorCircleMat);
        floorCircle.rotation.x = -Math.PI / 2;
        floorCircle.visible = false;
        guidanceAnimGroup.add(floorCircle);

        // Create animated arrows to indicate panning
        const arrowGeom = new THREE.ConeGeometry(0.05, 0.2, 8);
        const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
        const movingArrow = new THREE.Mesh(arrowGeom, arrowMat);
        movingArrow.visible = false;
        guidanceAnimGroup.add(movingArrow);

    let frameCount = 0;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    // renderer.xr.setFramebufferScaleFactor(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const startAR = async () => {
        if (isWebXRRequesting) {
            console.warn("WebXR is already requesting a session. Ignoring duplicate request.");
            return;
        }
        
        const xr = (navigator as any).xr;
        if (!xr) {
            if (isMounted) setIsSupported(false);
            return;
        }

        isWebXRRequesting = true;

        try {
            const supported = await xr.isSessionSupported('immersive-ar');
            if (!supported) {
                if (isMounted) setIsSupported(false);
                isWebXRRequesting = false;
                return;
            }
        } catch (e) {
            console.warn("isSessionSupported failed:", e);
            if (isMounted) setIsSupported(false);
            isWebXRRequesting = false;
            return;
        }

        const overlayDiv = document.getElementById('ar-overlay');
        
        try {
            const session = await xr.requestSession('immersive-ar', {
                requiredFeatures: ['plane-detection'],
                optionalFeatures: ['dom-overlay', 'local-floor', 'light-estimation', 'camera-access'],
                domOverlay: overlayDiv ? { root: overlayDiv } : undefined
            });
            isWebXRRequesting = false;
            if (!isMounted) {
                session.end();
                return;
            }
            renderer.xr.setReferenceSpaceType('local-floor');
            await renderer.xr.setSession(session);
            currentSession = session;
            setIsSupported(true);
        } catch (err: any) {
            console.warn("AR Session error (full features):", err);
            
            if (err.message?.includes('already an active')) {
                isWebXRRequesting = false;
                return;
            }

            try {
                // Fallback attempt without plane-detection as required
                const fallbackSession = await xr.requestSession('immersive-ar', {
                    optionalFeatures: ['dom-overlay', 'local-floor', 'light-estimation', 'camera-access'],
                    domOverlay: overlayDiv ? { root: overlayDiv } : undefined
                });
                isWebXRRequesting = false;
                if (!isMounted) {
                    fallbackSession.end();
                    return;
                }
                renderer.xr.setReferenceSpaceType('local-floor');
                await renderer.xr.setSession(fallbackSession);
                currentSession = fallbackSession;
                setIsSupported(true);
            } catch (fallbackErr: any) {
                console.warn("AR Session fallback error with dom-overlay:", fallbackErr);
                
                try {
                    // Final bare minimum fallback
                    const bareSession = await xr.requestSession('immersive-ar', {
                        optionalFeatures: ['local-floor', 'light-estimation']
                    });
                    isWebXRRequesting = false;
                    if (!isMounted) {
                        bareSession.end();
                        return;
                    }
                    renderer.xr.setReferenceSpaceType('local-floor');
                    await renderer.xr.setSession(bareSession);
                    currentSession = bareSession;
                    setIsSupported(true);
                } catch (bareErr: any) {
                    isWebXRRequesting = false;
                    console.warn("AR Session bare fallback error:", bareErr);
                    if (isMounted) setIsSupported(false);
                }
            }
        }
    };
    
    // We bind it to window so we can trigger it from React state easily without losing closure
    (window as any)._startAR = startAR;
    
    // Try auto-starting if possible (sometimes works if transient activation carried over)
    startAR().catch(() => {});

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

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    engineApiRef.current = {
        getCurrentLighting: () => currentLighting
    };

    const animate = () => {
      renderer.setAnimationLoop(render);
    };

    const render = (timestamp: number, frame: any) => {
      if (frame) {
        currentSession = renderer.xr.getSession();
        const referenceSpace = renderer.xr.getReferenceSpace();

        // Ensure the camera matches the device pose continuously
        const viewerPose = frame.getViewerPose(referenceSpace);
        if (viewerPose && viewerPose.views.length > 0) {
            const view = viewerPose.views[0];
            camera.position.set(view.transform.position.x, view.transform.position.y, view.transform.position.z);
            camera.quaternion.set(view.transform.orientation.x, view.transform.orientation.y, view.transform.orientation.z, view.transform.orientation.w);
            
            // Keep the projection matrix synced too
            camera.projectionMatrix.fromArray(view.projectionMatrix);
        }

        // Request light probe once
        if (currentSession && !lightProbeRequested && currentSession.requestLightProbe) {
            lightProbeRequested = true;
            currentSession.requestLightProbe({
               reflectionFormat: currentSession.preferredReflectionFormat
            }).then((probe: any) => {
               xrLightProbe = probe;
            }).catch((err: any) => console.warn("LightProbe failed", err));
        }

        // Update lighting estimate
        if (xrLightProbe) {
            const lightEstimate = frame.getLightEstimate(xrLightProbe);
            if (lightEstimate) {
                if (lightEstimate.primaryLightDirection) {
                    const dir = lightEstimate.primaryLightDirection;
                    currentLighting.primaryLightDirection = [dir.x, dir.y, dir.z];
                }
                if (lightEstimate.primaryLightIntensity) {
                    const intensity = lightEstimate.primaryLightIntensity;
                    // Usually an RGB representation of intensity
                    const color = new THREE.Color(intensity.x, intensity.y, intensity.z);
                    currentLighting.primaryLightColor = color.getHex();
                    
                    // Crude intensity calculation based on luminance
                    currentLighting.primaryLightIntensity = Math.max(intensity.x, intensity.y, intensity.z);
                }
                
                // Spherical harmonics are complex 9-bands, for simple ambient we just approximate 
                // by using the length or components to derive ambient. We'll simplify to just taking 
                // something proportional to the first band or just fixed if too complex.
                if (lightEstimate.sphericalHarmonicsCoefficients) {
                    const sh = lightEstimate.sphericalHarmonicsCoefficients;
                    // The first 3 coefficients are typically the ambient term (L00)
                    const ambientColor = new THREE.Color(
                       Math.max(0, sh[0]),
                       Math.max(0, sh[1]), 
                       Math.max(0, sh[2])
                    );
                    currentLighting.ambientColor = ambientColor.getHex();
                    currentLighting.ambientIntensity = Math.max(sh[0], sh[1], sh[2]);
                }
                
                // Also update the THREE.js light used in the AR scene so we see the lighting affect the wireframes!
                if (lightEstimate.primaryLightDirection && lightEstimate.primaryLightIntensity) {
                    light.position.set(currentLighting.primaryLightDirection[0], currentLighting.primaryLightDirection[1], currentLighting.primaryLightDirection[2]);
                    light.intensity = 0.5 + Math.min(1.0, currentLighting.primaryLightIntensity * 0.5);
                }
            }
        }

        if (!planeSupportChecked) {
          planeSupportChecked = true;
          if (frame.detectedPlanes === undefined) {
             setIsSupported(false);
          } else {
             setIsSupported(true);
          }
        }

        if (frame.detectedPlanes) {
          const detectedPlanes = frame.detectedPlanes;
          
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
              const material = new THREE.LineBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8,
                linewidth: 2
              });
              const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0)]);
              mesh = new THREE.LineLoop(geom, material) as unknown as THREE.Mesh;
              
              scene.add(mesh);
              planesMap.set(plane, mesh);
            } else {
              mesh.visible = true;
              (mesh.material as THREE.LineBasicMaterial).color.setHex(color);
            }

            mesh.position.copy(pose.transform.position);
            mesh.quaternion.copy(pose.transform.orientation);
            
            // Only rebuild geometry if polygon changed size or every 30 frames to avoid memory exhaustion
            const rebuildGeom = !mesh.userData.lastPolyLength || mesh.userData.lastPolyLength !== plane.polygon.length || (frameCount % 60 === 0);

            const poly = [];
            for (let i = 0; i < plane.polygon.length; i++) {
              const p = plane.polygon[i];
              poly.push({x: p.x, y: p.y, z: p.z});
            }

            if (rebuildGeom) {
                mesh.userData.lastPolyLength = plane.polygon.length;
                const points = [];
                for (let i = 0; i < plane.polygon.length; i++) {
                  const p = plane.polygon[i];
                  points.push(new THREE.Vector3(p.x, 0, p.z));
                }
                const geom = new THREE.BufferGeometry().setFromPoints(points);
                if (mesh.geometry) mesh.geometry.dispose();
                mesh.geometry = geom;
            }

            let data = planesDataRef.current.get(plane);
            if (!data) {
              planesDataRef.current.set(plane, {
                id: planeIdCounter++,
                orientation: plane.orientation,
                semanticLabel: semanticClass,
                color: color,
                polygon: poly,
                position: {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z},
                quaternion: {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w},
                lastSeen: Date.now()
              });
            } else {
              data.semanticLabel = semanticClass;
              data.color = color;
              
              // Instead of overwriting polygon entirely, we let WebXR's plane tracking handle it 
              // as this provides refined boundary updates over time, but we don't delete them.
              data.polygon = poly;
              
              data.position = {x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z};
              data.quaternion = {x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w};
              data.lastSeen = Date.now();
            }
          });

          // Keep stale planes to accumulate a scanned room, just hide their WebXR debug meshes if they aren't actively tracked
          // Do not delete from `planesDataRef` to ensure merging/persistence across tracking angles.
          const now = Date.now();
          planesMap.forEach((mesh, plane) => {
            if (!detectedPlanes.has(plane)) {
              mesh.visible = false;
            }
          });
          
          const totalPlanes = planesDataRef.current.size;

          if (frameCount % 15 === 0) {
              setActivePlanesCount(totalPlanes);

              let floorArea = 0;
              let wallArea = 0;
              let ceilingArea = 0;
              let featureCount = 0;
              let floorFound = false;
              let ceilingFound = false;
              let wallCount = 0;
              let minY = Infinity;
              let maxY = -Infinity;

              planesDataRef.current.forEach((p) => {
                 let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                 let pMinY = Infinity, pMaxY = -Infinity;
                 p.polygon.forEach(pt => {
                    minX = Math.min(minX, pt.x);
                    maxX = Math.max(maxX, pt.x);
                    minZ = Math.min(minZ, pt.z);
                    maxZ = Math.max(maxZ, pt.z);
                 });
                 // Position is the center point tracked by WebXR, we estimate height based on this
                 pMinY = Math.min(pMinY, p.position.y);
                 pMaxY = Math.max(pMaxY, p.position.y);
                 minY = Math.min(minY, pMinY);
                 maxY = Math.max(maxY, pMaxY);

                 const areaApprox = (maxX - minX) * (maxZ - minZ);

                 if (p.semanticLabel === 'floor') {
                     floorFound = true;
                     floorArea += areaApprox;
                 } else if (p.semanticLabel === 'ceiling') {
                     ceilingFound = true;
                     ceilingArea += areaApprox;
                 } else if (p.semanticLabel === 'wall') {
                     wallCount++;
                     wallArea += areaApprox;
                 } else if (p.semanticLabel === 'door' || p.semanticLabel === 'window') {
                     featureCount++;
                 }
              });

              // Fallback height estimation if ceiling or floor not explicitly labeled but present across vertical extent
              let estHeight = 0;
              if (maxY !== -Infinity && minY !== Infinity) {
                  estHeight = maxY - minY;
                  if (!ceilingFound && estHeight < 1.5) estHeight = 2.5; // Assume default if we only mapped floor
              }

              setScanStats({ floorArea, wallArea, ceilingArea, featureCount, roomHeight: estHeight });

              if (now - lastScanTime > 2000) {
                 const addedPlanes = totalPlanes - lastPlaneCount;
                 if (addedPlanes === 0 && totalPlanes > 0 && totalPlanes < 10) {
                     slowProgressCount++;
                 } else {
                     slowProgressCount = 0;
                 }
                 lastScanTime = now;
                 lastPlaneCount = totalPlanes;
              }

              if (slowProgressCount > 0 && floorArea < 1.0) {
                 setGuidanceTip('Too few planes detected. Move slower and ensure good lighting.');
                 setGuidanceIcon(<Info className="w-8 h-8 md:w-12 md:h-12" />);
                 setScanQuality('low');
              } else if (slowProgressCount > 1 && (wallCount < 4 || wallArea < 10.0)) {
                 setGuidanceTip('Scan corners where walls meet to establish room shape.');
                 setGuidanceIcon(<Compass className="w-8 h-8 md:w-12 md:h-12 animate-pulse" />);
                 setScanQuality('medium');
              } else if (!floorFound || floorArea < 1.0) {
                 setGuidanceTip('Point at the floor and move slowly to map it.');
                 setGuidanceIcon(<ArrowDown className="w-8 h-8 md:w-12 md:h-12" />);
                 setScanQuality('low');
              } else if (wallCount < 2 || wallArea < 3.0) {
                 setGuidanceTip('Pan up and around to map the walls.');
                 setGuidanceIcon(<RefreshCw className="w-8 h-8 md:w-12 md:h-12 animate-spin-slow" />);
                 setScanQuality('medium');
              } else if (wallCount < 4 || wallArea < 10.0) {
                 setGuidanceTip('Look for other wall corners and capture their full height.');
                 setGuidanceIcon(<Compass className="w-8 h-8 md:w-12 md:h-12" />);
                 setScanQuality('medium');
              } else if (!ceilingFound && ceilingArea < 1.0 && wallCount >= 3) {
                 setGuidanceTip('Look up to scan the ceiling.');
                 setGuidanceIcon(<ArrowDown className="w-8 h-8 md:w-12 md:h-12 rotate-180" />);
                 setScanQuality('medium');
              } else if (featureCount < 1) {
                 setGuidanceTip('Room shape captured. Point at doors and windows to detect them.');
                 setGuidanceIcon(<Check className="w-8 h-8 md:w-12 md:h-12" />);
                 setScanQuality('high');
              } else {
                 setGuidanceTip('Great! Tap Finish Mapping when you are ready.');
                 setGuidanceIcon(<Check className="w-8 h-8 md:w-12 md:h-12 text-emerald-400" />);
                 setScanQuality('high');
              }
          }
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

    animate();
    } catch (err) { console.error("AR Start error", err); }

    return () => {
      isMounted = false;
      window.removeEventListener('resize', onWindowResize);
      renderer.setAnimationLoop(null);
      if (currentSession) currentSession.end().catch(() => {});
      planesMap.forEach((mesh) => {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose();
      });
      renderer.dispose();
      scene.clear();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  const handleFinish = () => {
      const planesArray = Array.from(planesDataRef.current.values());
      const lighting = engineApiRef.current?.getCurrentLighting();
      onComplete(planesArray, 1.0, lighting);
  };

  const getQualityColor = () => {
     if (scanQuality === 'low') return 'text-red-400 border-red-500/50 bg-red-500/20 shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)]';
     if (scanQuality === 'medium') return 'text-yellow-400 border-yellow-500/50 bg-yellow-500/20 shadow-[0_0_30px_-5px_rgba(234,179,8,0.3)]';
     return 'text-emerald-400 border-emerald-500/50 bg-emerald-500/20 shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]';
  };

  return (
    <>
      <div ref={containerRef} className="fixed inset-0 w-full h-[100dvh] touch-none" />
      <div 
        id="ar-overlay" 
        className="fixed inset-0 pointer-events-none z-50"
      >
        <div 
          className="w-full h-full flex flex-col justify-between p-6 overflow-hidden box-border"
          style={{ 
            paddingTop: 'calc(env(safe-area-inset-top, 24px) + 1.5rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 24px) + 1.5rem)'
          }}
        >
          <div className="flex justify-between items-start z-10 w-full">
           <div className="space-y-4 pointer-events-auto">
             <div className="bg-black/50 backdrop-blur w-44 text-white px-4 py-3 rounded-xl border border-white/10 shadow-lg flex flex-col gap-2">
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Planes</span>
                   <span className="text-white font-mono">{activePlanesCount}</span>
                </div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Floor Area</span>
                   <span className="text-emerald-400 font-mono">{scanStats.floorArea.toFixed(1)} m²</span>
                </div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Ceiling Area</span>
                   <span className="text-cyan-400 font-mono">{scanStats.ceilingArea.toFixed(1)} m²</span>
                </div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Wall Area</span>
                   <span className="text-blue-400 font-mono">{scanStats.wallArea.toFixed(1)} m²</span>
                </div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Height</span>
                   <span className="text-rose-400 font-mono">{scanStats.roomHeight > 0.1 ? scanStats.roomHeight.toFixed(2) + 'm' : '--'}</span>
                </div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex justify-between">
                   <span>Features</span>
                   <span className="text-purple-400 font-mono">{scanStats.featureCount}</span>
                </div>
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

        {/* Central Guidance UI */}
        {isSupported && (
           <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-80 backdrop-blur-sm bg-black/10 transition-opacity duration-500">
              <div className={`p-6 rounded-full border mb-6 transition-all duration-1000 ${getQualityColor()}`}>
                 {guidanceIcon}
              </div>
           </div>
        )}

         <div className="text-center pb-8 pointer-events-none z-10 space-y-4">
            {isSupported === null && (
               <Button 
                  onClick={() => {
                     if ((window as any)._startAR) (window as any)._startAR();
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white pointer-events-auto shadow-lg px-8 py-6 rounded-full font-bold text-lg"
               >
                 Tap to Open Camera
               </Button>
            )}
            {isSupported === false ? (
               <p className="bg-red-500/80 inline-flex flex-col items-center gap-2 px-4 py-3 rounded-xl text-white text-sm backdrop-blur font-medium border border-red-400/50 max-w-sm pointer-events-auto">
                   <span className="flex items-center gap-2">
                       <Info className="w-5 h-5 flex-shrink-0" />
                       WebXR AR session failed to start.
                   </span>
                   <span className="text-red-200 text-xs text-center">
                       If you are in a preview window, please open the app in a new tab. Otherwise, check your site permissions.
                   </span>
               </p>
            ) : isSupported === true ? (
                <p className={`inline-flex items-center gap-2 px-6 py-4 rounded-full text-white text-sm md:text-base backdrop-blur font-medium border transition-all duration-500 ${scanQuality === 'high' ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-black/60 border-white/10'}`}>
                    {scanQuality === 'high' ? <Check className="w-5 h-5 text-emerald-400" /> : <Info className="w-5 h-5 text-indigo-400" />}
                    {guidanceTip}
                </p>
            ) : null}
         </div>
        </div>
      </div>
    </>
  );
}
