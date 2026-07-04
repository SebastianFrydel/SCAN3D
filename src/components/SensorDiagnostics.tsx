import React, { useState, useEffect } from 'react';
import { 
  Camera, Compass, ShieldCheck, AlertCircle, Info, Lock, 
  Settings, RefreshCw, Layers, CheckCircle2, XCircle, Cpu 
} from 'lucide-react';
import { Button } from './ui/button';

export interface DiagnosticResult {
  webxrSupport: boolean | 'checking';
  immersiveArSupport: boolean | 'checking' | 'unsupported';
  cameraPermission: 'granted' | 'prompt' | 'denied' | 'checking' | 'unsupported';
  gyroscopePermission: 'granted' | 'prompt' | 'denied' | 'checking' | 'unsupported';
  accelerometerPermission: 'granted' | 'prompt' | 'denied' | 'checking' | 'unsupported';
  xrSpatialTracking: 'granted' | 'prompt' | 'denied' | 'checking' | 'unsupported';
  webglSupport: boolean | 'checking';
}

export function SensorDiagnostics({ onClose }: { onClose?: () => void }) {
  const [results, setResults] = useState<DiagnosticResult>({
    webxrSupport: 'checking',
    immersiveArSupport: 'checking',
    cameraPermission: 'checking',
    gyroscopePermission: 'checking',
    accelerometerPermission: 'checking',
    xrSpatialTracking: 'checking',
    webglSupport: 'checking',
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  const runDiagnostics = async () => {
    setIsDiagnosing(true);
    setErrorMessage(null);
    const newResults: DiagnosticResult = { ...results };

    // 1. WebGL Support
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      newResults.webglSupport = !!gl;
    } catch (e) {
      newResults.webglSupport = false;
    }

    // 2. WebXR support
    const xr = (navigator as any).xr;
    if (!xr) {
      newResults.webxrSupport = false;
      newResults.immersiveArSupport = 'unsupported';
      newResults.xrSpatialTracking = 'unsupported';
    } else {
      newResults.webxrSupport = true;
      try {
        const supported = await xr.isSessionSupported('immersive-ar');
        newResults.immersiveArSupport = supported;
      } catch (e) {
        newResults.immersiveArSupport = 'unsupported';
      }
    }

    // 3. Permissions Check (Camera)
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const cameraPerm = await navigator.permissions.query({ name: 'camera' as any });
        newResults.cameraPermission = cameraPerm.state as any;
        
        cameraPerm.onchange = () => {
          setResults(prev => ({ ...prev, cameraPermission: cameraPerm.state as any }));
        };
      } catch (e) {
        // Fallback check if permission query is blocked but camera can be requested
        newResults.cameraPermission = 'prompt';
      }

      // Gyroscope Permission
      try {
        const gyroPerm = await navigator.permissions.query({ name: 'gyroscope' as any });
        newResults.gyroscopePermission = gyroPerm.state as any;
      } catch (e) {
        newResults.gyroscopePermission = 'unsupported';
      }

      // Accelerometer Permission
      try {
        const accPerm = await navigator.permissions.query({ name: 'accelerometer' as any });
        newResults.accelerometerPermission = accPerm.state as any;
      } catch (e) {
        newResults.accelerometerPermission = 'unsupported';
      }

      // WebXR spatial tracking Permission
      try {
        const trackingPerm = await navigator.permissions.query({ name: 'xr-spatial-tracking' as any });
        newResults.xrSpatialTracking = trackingPerm.state as any;
      } catch (e) {
        newResults.xrSpatialTracking = 'unsupported';
      }
    } else {
      // Permission API not supported (e.g. some older browsers / iOS Safari)
      newResults.cameraPermission = 'prompt';
      newResults.gyroscopePermission = 'prompt';
      newResults.accelerometerPermission = 'prompt';
      newResults.xrSpatialTracking = 'prompt';
    }

    // Attempt actual camera initialization test if status is prompt
    if (newResults.cameraPermission === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        newResults.cameraPermission = 'granted';
        stream.getTracks().forEach(track => track.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          newResults.cameraPermission = 'denied';
        }
      }
    }

    // Test Motion devices triggers on iOS
    if (typeof (window as any).DeviceOrientationEvent !== 'undefined' && typeof (window as any).DeviceOrientationEvent.requestPermission === 'function') {
      try {
        // We cannot auto-call requestPermission without a click event, so mark as prompt
        newResults.gyroscopePermission = 'prompt';
        newResults.accelerometerPermission = 'prompt';
      } catch (e) {
        newResults.gyroscopePermission = 'denied';
      }
    }

    setResults(newResults);
    setIsDiagnosing(false);
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const requestCameraAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach(track => track.stop());
      setResults(prev => ({ ...prev, cameraPermission: 'granted' }));
      // Re-run diagnostics
      runDiagnostics();
    } catch (err: any) {
      setErrorMessage(`Camera access denied or failed: ${err.message || err}`);
      setResults(prev => ({ ...prev, cameraPermission: 'denied' }));
    }
  };

  const requestMotionAccess = async () => {
    const devOrientation = (window as any).DeviceOrientationEvent;
    if (devOrientation && typeof devOrientation.requestPermission === 'function') {
      try {
        const response = await devOrientation.requestPermission();
        if (response === 'granted') {
          setResults(prev => ({ 
            ...prev, 
            gyroscopePermission: 'granted',
            accelerometerPermission: 'granted' 
          }));
        } else {
          setResults(prev => ({ 
            ...prev, 
            gyroscopePermission: 'denied',
            accelerometerPermission: 'denied' 
          }));
        }
      } catch (err: any) {
        setErrorMessage(`Motion permission error: ${err.message || err}`);
      }
    } else {
      // In Android / Chrome, permissions are usually controlled via Site Settings or automatic prompt.
      setErrorMessage("On Android/Chrome, please enable 'Sensors' permission in Chrome Site Settings (click padlock icon next to URL).");
    }
  };

  const getStatusBadge = (status: boolean | 'checking' | 'unsupported' | 'granted' | 'prompt' | 'denied') => {
    switch (status) {
      case 'checking':
        return (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium font-mono">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Querying...
          </span>
        );
      case true:
      case 'granted':
        return (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            AVAILABLE / OK
          </span>
        );
      case 'prompt':
        return (
          <span className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium font-mono bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
            <Info className="w-3.5 h-3.5" />
            REQUIRES PROMPT
          </span>
        );
      case 'unsupported':
        return (
          <span className="flex items-center gap-1.5 text-xs text-slate-400 font-medium font-mono bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full">
            <Info className="w-3.5 h-3.5" />
            NOT DETECTED
          </span>
        );
      case false:
      case 'denied':
      default:
        return (
          <span className="flex items-center gap-1.5 text-xs text-rose-400 font-bold font-mono bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
            <XCircle className="w-3.5 h-3.5" />
            BLOCKED / REFUSED
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-950/95 border border-white/10 rounded-2xl p-6 text-white max-w-lg w-full shadow-2xl backdrop-blur-md flex flex-col gap-5">
      <div className="flex justify-between items-center border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-bold tracking-tight uppercase">Hardware & Sensors Diagnostics</h2>
        </div>
        {onClose && (
          <Button 
            variant="ghost" 
            className="h-8 px-2 text-slate-400 hover:text-white"
            onClick={onClose}
          >
            Close
          </Button>
        )}
      </div>

      <div className="space-y-3.5 py-1">
        
        {/* WebGL Diagnostic */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              WebGL 3D Engine
            </span>
            <span className="text-[11px] text-slate-400">Needed to render 3D room constructs</span>
          </div>
          {getStatusBadge(results.webglSupport)}
        </div>

        {/* Camera Sensor */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              <Camera className="w-3.5 h-3.5 text-indigo-400" />
              Camera Feed Sensor
            </span>
            <span className="text-[11px] text-slate-400">Requires camera capture permission</span>
          </div>
          {getStatusBadge(results.cameraPermission)}
        </div>

        {/* Gyroscope */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              Gyroscope (Rotation Sensor)
            </span>
            <span className="text-[11px] text-slate-400">Determines spatial orientation & pitch</span>
          </div>
          {getStatusBadge(results.gyroscopePermission)}
        </div>

        {/* Accelerometer */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              <Compass className="w-3.5 h-3.5 text-indigo-400 rotate-45" />
              Accelerometer (Motion Sensor)
            </span>
            <span className="text-[11px] text-slate-400">Tracks physical acceleration & displacement</span>
          </div>
          {getStatusBadge(results.accelerometerPermission)}
        </div>

        {/* WebXR API */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              WebXR Device API Support
            </span>
            <span className="text-[11px] text-slate-400">Interface to system AR engines</span>
          </div>
          {getStatusBadge(results.webxrSupport)}
        </div>

        {/* AR Support */}
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              Immersive AR Session
            </span>
            <span className="text-[11px] text-slate-400">Underlying native AR (ARKit / ARCore)</span>
          </div>
          {getStatusBadge(results.immersiveArSupport)}
        </div>

        {/* spatial-tracking permission */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-slate-200">
              Spatial AR Permissions
            </span>
            <span className="text-[11px] text-slate-400">Cross-origin iframe & device access</span>
          </div>
          {getStatusBadge(results.xrSpatialTracking)}
        </div>

      </div>

      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex gap-2 text-xs text-red-200 mt-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        {results.cameraPermission === 'prompt' && (
          <Button 
            className="flex-1 bg-indigo-600 hover:bg-indigo-500"
            onClick={requestCameraAccess}
          >
            Authorize Camera Feed
          </Button>
        )}

        {(results.gyroscopePermission === 'prompt' || results.accelerometerPermission === 'prompt') && (
          <Button 
            className="flex-1 bg-indigo-600 hover:bg-indigo-500"
            onClick={requestMotionAccess}
          >
            Request Motion Sensors
          </Button>
        )}

        <Button 
          variant="outline" 
          className="flex-shrink-0 border-white/10 hover:bg-white/5 text-slate-300"
          onClick={runDiagnostics}
          disabled={isDiagnosing}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isDiagnosing ? 'animate-spin' : ''}`} />
          Retry Diagnostic
        </Button>
      </div>

      {/* Troubleshooting tips based on failure states */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-4 space-y-2 text-xs text-slate-300">
        <h4 className="font-bold text-white uppercase flex items-center gap-1.5 text-[10px] tracking-wider text-indigo-400">
          <Lock className="w-3.5 h-3.5" />
          Troubleshooting Guideline
        </h4>
        
        {/* If sensors/camera blocked */}
        {(results.cameraPermission === 'denied' || results.gyroscopePermission === 'denied' || results.accelerometerPermission === 'denied') ? (
          <p className="leading-relaxed">
            🔍 **Site Permissions Blocked**: Chrome or your browser is blocking device sensors/camera for this site. 
            Tap the **Padlock icon 🔒** or **Settings icon** left of the URL in your browser, and flip **Sensors** and **Camera** to **Allow**.
          </p>
        ) : (!results.webxrSupport || results.immersiveArSupport === 'unsupported' || results.immersiveArSupport === false) ? (
          <div className="space-y-1">
            <p className="leading-relaxed">
              ⚠️ **Preview/IFrame Sandbox restriction**: WebXR cannot run inside an AI Studio web iframe due to browser security sandbox rules.
            </p>
            <p className="leading-relaxed text-indigo-300 font-semibold">
              👉 Please copy the "Development / Shared App URL" or click the "launch" button at the top header to run the scanner in a normal standalone browser tab!
            </p>
          </div>
        ) : (
          <p className="leading-relaxed">
            💡 All sensors are looking great! If you still experience issues starting, consider refreshing the web tab to reset the security context.
          </p>
        )}
      </div>
    </div>
  );
}
