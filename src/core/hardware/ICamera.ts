/**
 * Core interface for Camera Abstraction.
 * In WebXR, the camera is managed by the browser capabilities and the underlying 
 * ARCore / ARKit. This interface provides a standard way to query that hardware.
 */
export interface CameraParams {
    /** Field of view in degrees */
    fov?: number;
    /** Aspect ratio */
    aspect?: number;
    /** Whether it is natively wide-angle */
    isWideAngle: boolean;
}

export interface ICamera {
    /** Initialize and start the camera session */
    start(): Promise<void>;
    /** Stop the camera and cleanup */
    stop(): void;
    /** Get active parameters */
    getParams(): CameraParams;
}

export class WebXRCameraWrapper implements ICamera {
    private xrSession: any | null = null;

    async start(): Promise<void> {
        if (!navigator.xr) {
            throw new Error("WebXR not supported on this device/browser");
        }
        // ARButton inherently manages the session, but we can track it here ideally.
    }

    stop(): void {
        if (this.xrSession) {
            this.xrSession.end();
            this.xrSession = null;
        }
    }

    getParams(): CameraParams {
        return {
            isWideAngle: false, // WebXR limits us to default AR camera
        };
    }
}
