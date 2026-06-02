import * as THREE from 'three';
import { RawPlane, RoomModel, ProcessedWall } from '../models/types';

interface WallSegment {
    id: string;
    p1: THREE.Vector2;
    p2: THREE.Vector2;
    normal: THREE.Vector2;
    dir: THREE.Vector2;
    planes: any[];
}

export class RoomReconstruction {
    /**
     * Extracts a sensible footprint polygon (concave hull approximation / ordered polygon)
     * from a set of 2D points (X, Z plane) 
     */
    public static getFootprintPolygon(points: {x: number, z: number}[]): {x: number, z: number}[] {
        if (points.length < 3) return points;
        
        let cx = 0, cz = 0;
        points.forEach(p => { cx += p.x; cz += p.z; });
        cx /= points.length;
        cz /= points.length;

        // Sort by angle around centroid. This works well for star-shaped rooms,
        // which covers most common convex and L-shaped concave rooms.
        const sorted = [...points].sort((a, b) => {
            const angleA = Math.atan2(a.z - cz, a.x - cx);
            const angleB = Math.atan2(b.z - cz, b.x - cx);
            return angleA - angleB;
        });
        
        // Remove points that are too close to each other
        const filtered = [];
        for (let i = 0; i < sorted.length; i++) {
            const p = sorted[i];
            if (filtered.length === 0) {
                filtered.push(p);
                continue;
            }
            const last = filtered[filtered.length - 1];
            const dist = Math.hypot(p.x - last.x, p.z - last.z);
            if (dist > 0.1) {
                filtered.push(p);
            }
        }
        return filtered;
    }

    /**
     * Processes raw AR planes into a closed room model
     */
    public static buildRoomModel(planes: RawPlane[]): RoomModel {
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

        const horizontalPlanes = globalPlanes.filter(p => p.orientation === 'horizontal');
        const verticalPlanes = globalPlanes.filter(p => p.orientation === 'vertical');

        let fY = 0;
        let cY = 2.5;

        // Estimate floor and ceiling height
        const floorPlanes = horizontalPlanes.filter(p => p.semanticLabel?.toLowerCase() === 'floor');
        const ceilPlanes = horizontalPlanes.filter(p => p.semanticLabel?.toLowerCase() === 'ceiling');

        if (floorPlanes.length > 0) {
            fY = floorPlanes.reduce((acc, p) => Math.min(acc, p.minY, p.position.y), Infinity);
        } else if (horizontalPlanes.length > 0) {
            horizontalPlanes.sort((a, b) => a.position.y - b.position.y);
            fY = horizontalPlanes[0].position.y;
        } else if (verticalPlanes.length > 0) {
            let minWallY = Infinity;
            verticalPlanes.forEach(p => { minWallY = Math.min(minWallY, p.minY); });
            fY = minWallY !== Infinity ? minWallY : 0;
        } else {
            fY = globalMinY !== Infinity ? globalMinY : 0;
        }

        if (ceilPlanes.length > 0) {
            cY = ceilPlanes.reduce((acc, p) => Math.max(acc, p.maxY, p.position.y), -Infinity);
        } else {
            let maxWallY = -Infinity;
            verticalPlanes.forEach(p => { maxWallY = Math.max(maxWallY, p.maxY); });
            if (maxWallY !== -Infinity) {
                cY = Math.max(fY + 2.0, maxWallY);
            } else if (horizontalPlanes.length > 1 && horizontalPlanes[horizontalPlanes.length - 1].position.y > fY + 1.5) {
                cY = horizontalPlanes[horizontalPlanes.length - 1].position.y;
            } else {
                cY = globalMaxY !== -Infinity ? Math.max(fY + 2.0, globalMaxY) : fY + 2.5;
            }
        }

        // --- 1. Identify Wall Segments ---
        let wallSegments: WallSegment[] = [];
        verticalPlanes.filter(p => {
            const label = p.semanticLabel?.toLowerCase();
            return label !== 'door' && label !== 'window' && label !== 'door_frame' && label !== 'wardrobe' && label !== 'tv';
        }).forEach(p => {
            // Find direction of wall across XZ
            const dir3D = new THREE.Vector3(1, 0, 0).transformDirection(p.matrix).setY(0);
            if (dir3D.lengthSq() < 0.0001) return;
            dir3D.normalize();
            
            const normal3D = new THREE.Vector3(0, 0, -1).transformDirection(p.matrix).setY(0); // Assuming local Z is normal or depth
            if (normal3D.lengthSq() > 0.0001) normal3D.normalize();
            else return;

            const dir = new THREE.Vector2(dir3D.x, dir3D.z);
            const normal = new THREE.Vector2(normal3D.x, normal3D.z);
            
            const origin = new THREE.Vector2(p.globalPoints[0].x, p.globalPoints[0].z);
            let minT = Infinity, maxT = -Infinity;
            p.globalPoints.forEach(pt => {
                const t = (pt.x - origin.x) * dir.x + (pt.z - origin.y) * dir.y;
                minT = Math.min(minT, t);
                maxT = Math.max(maxT, t);
            });
            
            const p1 = origin.clone().add(dir.clone().multiplyScalar(minT));
            const p2 = origin.clone().add(dir.clone().multiplyScalar(maxT));
            
            wallSegments.push({ id: p.id.toString(), p1, p2, normal, dir, planes: [p] });
        });

        // --- 2. Merge Coplanar Wall Segments ---
        let merged = true;
        const programmaticHoles: any[] = [];
        
        while (merged) {
            merged = false;
            for (let i = 0; i < wallSegments.length; i++) {
                for (let j = i + 1; j < wallSegments.length; j++) {
                    const s1 = wallSegments[i];
                    const s2 = wallSegments[j];
                    
                    // Check near parallel (allow more tolerance for curved / non-perfect walls)
                    if (Math.abs(s1.normal.dot(s2.normal)) > 0.85) {
                        const distToLine = Math.abs(new THREE.Vector2().subVectors(s2.p1, s1.p1).dot(s1.normal));
                        // Reduced from 0.25 to 0.15 to prevent merging walls across narrow halls
                        if (distToLine < 0.15) { 
                            // Project s2 endpoints onto s1 line
                            const origin = s1.p1;
                            const t1_min = 0;
                            const t1_max = s1.p1.distanceTo(s1.p2);
                            
                            const t2_1 = new THREE.Vector2().subVectors(s2.p1, origin).dot(s1.dir);
                            const t2_2 = new THREE.Vector2().subVectors(s2.p2, origin).dot(s1.dir);
                            
                            const s2_min = Math.min(t2_1, t2_2);
                            const s2_max = Math.max(t2_1, t2_2);
                            
                            // Check overlap or small gap (reduced to 0.8m)
                            if (s2_max >= t1_min - 0.8 && s2_min <= t1_max + 0.8) {
                                // Before merging, check if there's a distinct gap (like a door)
                                const isOverlap = s2_min < t1_max && s2_max > t1_min;
                                const gap = !isOverlap ? Math.max(0, Math.min(s2_min - t1_max, t1_min - s2_max)) : 0;
                                
                                if (gap > 0.6 && gap < 1.3) {
                                    // It's a plausible door gap! Create a programmatic hole.
                                    const centerT = isOverlap ? 0 : (t1_max + s2_min) / 2;
                                    if (centerT > 0) {
                                        const gapCenter = origin.clone().add(s1.dir.clone().multiplyScalar(centerT));
                                        programmaticHoles.push({
                                            type: 'door',
                                            width: gap,
                                            height: 2.1, // standard door height
                                            center: [gapCenter.x, fY + 1.05, gapCenter.y], // 3D center
                                            wallId: s1.id + '_' + s2.id // will be mapped below
                                        });
                                    }
                                }

                                // Merge them physically
                                const minT = Math.min(t1_min, s2_min);
                                const maxT = Math.max(t1_max, s2_max);
                                
                                // Recalculate normal based on weighted orientation
                                const w1 = t1_max;
                                const w2 = s2_max - s2_min;
                                const mergedNormal = s1.normal.clone().multiplyScalar(w1).add(s2.normal.clone().multiplyScalar(w2)).normalize();
                                const mergedDir = new THREE.Vector2(-mergedNormal.y, mergedNormal.x);
                                if (mergedDir.dot(s1.dir) < 0) mergedDir.negate();

                                const newP1 = origin.clone().add(mergedDir.clone().multiplyScalar(minT));
                                const newP2 = origin.clone().add(mergedDir.clone().multiplyScalar(maxT));
                                
                                wallSegments[i] = {
                                    id: s1.id + '_' + s2.id,
                                    p1: newP1,
                                    p2: newP2,
                                    dir: mergedDir,
                                    normal: mergedNormal,
                                    planes: [...s1.planes, ...s2.planes]
                                };
                                wallSegments.splice(j, 1);
                                merged = true;
                                break;
                            }
                        }
                    }
                }
                if (merged) break; // restart loop
            }
        }

        // --- 3. Connect Corners via Intersection ---
        // Reduced to 0.5 to prevent collapsing small wall features and complex corners
        const SNAP_RADIUS = 0.5; 
        for (let i = 0; i < wallSegments.length; i++) {
            for (let j = i + 1; j < wallSegments.length; j++) {
                const s1 = wallSegments[i];
                const s2 = wallSegments[j];
                
                if (Math.abs(s1.dir.dot(s2.dir)) > 0.9) continue; // Skip nearly parallel

                const denom = s1.dir.x * s2.dir.y - s1.dir.y * s2.dir.x;
                if (Math.abs(denom) < 0.001) continue;

                const dx = s2.p1.x - s1.p1.x;
                const dy = s2.p1.y - s1.p1.y;
                
                const t = (dx * s2.dir.y - dy * s2.dir.x) / denom;
                
                const p_int = new THREE.Vector2(s1.p1.x + t * s1.dir.x, s1.p1.y + t * s1.dir.y);
                
                const d1p1 = p_int.distanceTo(s1.p1);
                const d1p2 = p_int.distanceTo(s1.p2);
                const isS1P1 = d1p1 < d1p2;
                const d1 = Math.min(d1p1, d1p2);

                const d2p1 = p_int.distanceTo(s2.p1);
                const d2p2 = p_int.distanceTo(s2.p2);
                const isS2P1 = d2p1 < d2p2;
                const d2 = Math.min(d2p1, d2p2);

                // If intersection is close to both segment ends, merge them directly
                if (d1 < SNAP_RADIUS && d2 < SNAP_RADIUS) {
                    if (isS1P1) s1.p1.copy(p_int); else s1.p2.copy(p_int);
                    if (isS2P1) s2.p1.copy(p_int); else s2.p2.copy(p_int);
                }
            }
        }

        // --- 4. Build Enhanced Walls ---
        const enhancedWallsData: ProcessedWall[] = [];
        let rCX = 0, rCZ = 0;
        const allEndPoints: {x: number, z: number}[] = [];

        wallSegments.forEach(seg => {
            const width = seg.p1.distanceTo(seg.p2);
            if (width < 0.1) return; // ignore tiny segments

            let wMinY = Infinity;
            let wMaxY = -Infinity;
            seg.planes.forEach(p => {
                 wMinY = Math.min(wMinY, p.minY);
                 wMaxY = Math.max(wMaxY, p.maxY);
            });
            
            // Constrain wall top/bottom to the actual ceiling/floor.
            // If the wall scan doesn't physically reach floor or ceiling, we could leave it
            // but for a closed room model, stretching it to floor/ceiling is preferred.
            let wallBase = fY;
            let wallTop = cY;
            
            // If wall is significantly far from floor/ceiling, maybe it's a half-wall
            if (wMinY > fY + 0.5) wallBase = wMinY; // It's floating or a half wall starting higher (e.g. partition)
            if (wMaxY < cY - 0.5) wallTop = wMaxY; // It's a half wall not reaching ceiling

            const height = wallTop - wallBase;
            const midX = (seg.p1.x + seg.p2.x) / 2;
            const midZ = (seg.p1.y + seg.p2.y) / 2;
            const cy = (wallTop + wallBase) / 2;
            
            const dx = seg.p2.x - seg.p1.x;
            const dz = seg.p2.y - seg.p1.y;
            const theta = -Math.atan2(dz, dx);
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);

            enhancedWallsData.push({
                id: 'wall_' + seg.id,
                width,
                height,
                position: [midX, cy, midZ],
                quaternion: [quat.x, quat.y, quat.z, quat.w],
                color: 0x3b82f6,
                holes: []
            });

            allEndPoints.push({x: seg.p1.x, z: seg.p1.y});
            allEndPoints.push({x: seg.p2.x, z: seg.p2.y});
            rCX += midX;
            rCZ += midZ;
        });

        if (wallSegments.length > 0) {
            rCX /= wallSegments.length;
            rCZ /= wallSegments.length;
        }

        // --- 5. Features (Doors, Windows, Frames) Mapping to Walls ---
        const features: import('../models/types').ProcessedFeature[] = [];
        globalPlanes.forEach(p => {
            const label = p.semanticLabel?.toLowerCase();
            if (label === 'door' || label === 'window' || label === 'door_frame') {
                 let localMinX = Infinity, localMaxX = -Infinity, localMinY = Infinity, localMaxY = -Infinity;
                 p.polygon.forEach(pt => {
                     // Get coordinates in feature's own local XY space
                     localMinX = Math.min(localMinX, pt.x);
                     localMaxX = Math.max(localMaxX, pt.x);
                     localMinY = Math.min(localMinY, pt.y);
                     localMaxY = Math.max(localMaxY, pt.y);
                 });
                 
                 const featType = label === 'door_frame' ? 'door' : label as 'door' | 'window';
                 
                 const featDef = {
                     id: 'feature_' + p.id,
                     width: localMaxX - localMinX,
                     height: localMaxY - localMinY,
                     position: [p.position.x, p.position.y, p.position.z] as [number, number, number],
                     quaternion: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w] as [number, number, number, number],
                     localCenter: [(localMinX + localMaxX) / 2, (localMinY + localMaxY) / 2] as [number, number],
                     type: featType
                 };
                 features.push(featDef);

                 // Map feature to nearest constructed wall
                 let closestWall: ProcessedWall | null = null;
                 let minDistance = Infinity;
                 
                 const fx = featDef.position[0];
                 const fz = featDef.position[2];

                 enhancedWallsData.forEach(w => {
                     const wx = w.position[0];
                     const wz = w.position[2];
                     const dist = Math.hypot(fx - wx, fz - wz);
                     if (dist < minDistance) {
                         minDistance = dist;
                         closestWall = w;
                     }
                 });

                 if (closestWall && minDistance < 1.0) {
                     const dx = fx - closestWall.position[0];
                     const dz = fz - closestWall.position[2];
                     
                     const wallEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...closestWall.quaternion));
                     const theta = wallEuler.y;
                     
                     // Transform relative position to wall's local space
                     const localX = dx * Math.cos(theta) - dz * Math.sin(theta);
                     const localY = featDef.position[1] - closestWall.position[1];

                     closestWall.holes!.push({
                         x: localX,
                         y: localY,
                         width: featDef.width,
                         height: featDef.height,
                         type: featDef.type
                     });
                 }
            }
        });

        // ... (previous loop ends)
        programmaticHoles.forEach((pHole, idx) => {
             const wall = enhancedWallsData.find(w => w.id === 'wall_' + pHole.wallId);
             if (wall) {
                 const dx = pHole.center[0] - wall.position[0];
                 const dz = pHole.center[2] - wall.position[2];
                 const wallEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...wall.quaternion));
                 const theta = wallEuler.y;
                 const localX = dx * Math.cos(theta) - dz * Math.sin(theta);
                 const localY = pHole.center[1] - wall.position[1];

                 wall.holes!.push({
                     x: localX,
                     y: localY,
                     width: pHole.width,
                     height: pHole.height,
                     type: pHole.type
                 });
                 
                 features.push({
                     id: `prog_hole_${idx}`,
                     width: pHole.width,
                     height: pHole.height,
                     position: pHole.center as [number, number, number],
                     quaternion: wall.quaternion,
                     localCenter: [pHole.center[0], pHole.center[2]],
                     type: pHole.type
                 });
             }
        });

        // Use sorted footprint of sorted wall vertices for floor and ceiling bounds to seal room
        let finalHull = this.getFootprintPolygon(allEndPoints);
        if (finalHull.length < 3) {
             finalHull = [
                 {x: -1, z: -1},
                 {x: 1, z: -1},
                 {x: 1, z: 1},
                 {x: -1, z: 1}
             ];
        }

        const objects: import('../models/types').DetectedObject[] = [];
        globalPlanes.forEach((p, index) => {
             const label = p.semanticLabel?.toLowerCase();
             if (label === 'table' || label === 'chair' || label === 'sofa' || label === 'wardrobe' || label === 'tv') {
                 let minPx = Infinity, maxPx = -Infinity;
                 let minPz = Infinity, maxPz = -Infinity;
                 p.polygon.forEach(pt => {
                     minPx = Math.min(minPx, pt.x);
                     maxPx = Math.max(maxPx, pt.x);
                     minPz = Math.min(minPz, pt.z);
                     maxPz = Math.max(maxPz, pt.z);
                 });
                 
                 let width = 0.2, depth = 0.2, height = 0.2;
                 let posX = 0, posY = 0, posZ = 0;

                 if (p.orientation === 'horizontal') {
                     width = Math.max(0.2, maxPx - minPx);
                     depth = Math.max(0.2, maxPz - minPz);
                     const localCenter = new THREE.Vector3((minPx + maxPx)/2, 0, (minPz + maxPz)/2);
                     const worldCenter = localCenter.applyMatrix4(p.matrix);
                     height = Math.max(0.1, worldCenter.y - fY);
                     posX = worldCenter.x;
                     posY = fY + height / 2;
                     posZ = worldCenter.z;
                 } else { // vertical
                     width = Math.max(0.2, maxPx - minPx);
                     height = Math.max(0.1, maxPz - minPz);
                     depth = label === 'tv' ? 0.05 : 0.6; // Wardrobe standard depth is 60cm, TV is 5cm
                     
                     const localCenter = new THREE.Vector3((minPx + maxPx)/2, 0, (minPz + maxPz)/2);
                     const worldCenter = localCenter.applyMatrix4(p.matrix);
                     posX = worldCenter.x;
                     posY = worldCenter.y;
                     posZ = worldCenter.z;
                     
                     // Push wardrobe into the room slightly to anchor from its back if it's placed against a wall
                     const normal = new THREE.Vector3(0, 0, 1).transformDirection(p.matrix).normalize();
                     posX += normal.x * (depth / 2);
                     posZ += normal.z * (depth / 2);
                 }

                 objects.push({
                     id: `obj_${index}`,
                     type: label,
                     position: [posX, posY, posZ],
                     width: width,
                     depth: depth,
                     height: height,
                     quaternion: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w]
                 });
             }
        });

        return {
            enhancedWalls: enhancedWallsData,
            features: features,
            objects: objects,
            floorHullPoints: finalHull,
            ceilingHullPoints: finalHull,
            floorY: fY,
            ceilingY: cY,
            roomCenter: [rCX, 0, rCZ]
        };
    }
}

