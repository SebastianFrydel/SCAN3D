export interface Vector3D {
    x: number;
    y: number;
    z: number;
}

export interface Quaternion3D {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface RawPlane {
    id: number;
    orientation: string;
    semanticLabel?: string;
    polygon: Vector3D[];
    position: Vector3D;
    quaternion: Quaternion3D;
    color: number;
}

export interface ProcessedWall {
    id: string;
    width: number;
    height: number;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    color: number;
    holes?: { x: number, y: number, width: number, height: number, type: 'door' | 'window' }[];
}

export interface ProcessedFeature {
    id: string;
    width: number;
    height: number;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    localCenter: [number, number];
    type: 'door' | 'window';
}

export interface DetectedObject {
    id: string;
    type: 'chair' | 'table' | 'sofa' | string;
    position: [number, number, number];
    width: number;
    depth: number;
    height: number;
    quaternion: [number, number, number, number];
}

export interface RoomLighting {
    ambientColor?: number;
    ambientIntensity?: number;
    primaryLightDirection?: [number, number, number];
    primaryLightColor?: number;
    primaryLightIntensity?: number;
}

export interface RoomModel {
    enhancedWalls: ProcessedWall[];
    features: ProcessedFeature[];
    objects: DetectedObject[];
    floorHullPoints: {x: number, z: number}[];
    ceilingHullPoints: {x: number, z: number}[];
    floorY: number;
    ceilingY: number;
    roomCenter: [number, number, number];
    lighting?: RoomLighting;
}
