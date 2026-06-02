import React, { useState, useEffect } from 'react';
import { ARScanner, ScannedPlane } from './components/ARScanner';
import { RoomViewer } from './components/RoomViewer';
import { Button } from './components/ui/button';
import { AlertCircle, Camera, Cpu, Ruler, Scan, Smartphone } from 'lucide-react';
import { Toaster } from 'sonner';

type AppState = 'landing' | 'scanning' | 'viewing';

export default function App() {
  const [state, setState] = useState<AppState>('landing');
  const [isWebXRSupported, setIsWebXRSupported] = useState(false);
  const [supportChecked, setSupportChecked] = useState(false);
  const [scannedPlanes, setScannedPlanes] = useState<ScannedPlane[]>([]);

  useEffect(() => {
    if ('xr' in navigator) {
      (navigator as any).xr?.isSessionSupported('immersive-ar').then((supported: boolean) => {
        setIsWebXRSupported(supported);
      }).catch(() => {
        setIsWebXRSupported(false);
      }).finally(() => {
        setSupportChecked(true);
      });
    } else {
      setSupportChecked(true);
    }
  }, []);

  const handleScanComplete = (planes: ScannedPlane[]) => {
    setScannedPlanes(planes);
    setState('viewing');
  };

  if (state === 'scanning') {
    return <ARScanner onComplete={handleScanComplete} onCancel={() => setState('landing')} />;
  }

  if (state === 'viewing') {
    return <RoomViewer planes={scannedPlanes} onBack={() => setState('landing')} />;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 font-sans p-6 flex flex-col items-center justify-center">
      <Toaster position="top-center" />
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="mx-auto w-24 h-24 bg-indigo-500/20 rounded-3xl flex items-center justify-center mb-6 text-indigo-400">
          <Scan className="w-12 h-12" />
        </div>

        <div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Auto Room Scanner</h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Automatically detect walls, floors, and ceilings using your camera's AR sensors to construct a full 3D model of your room.
          </p>
        </div>

        <div className="grid gap-3 text-left">
          <div className="bg-slate-800/70 border border-white/10 p-4 rounded-xl flex gap-3">
            <Camera className="w-6 h-6 text-indigo-300 shrink-0" />
            <div>
              <div className="font-semibold text-white">Browser AR + motion sensors</div>
              <p className="text-sm text-slate-400">Uses WebXR plane detection with mobile motion/orientation sensors for scan quality guidance.</p>
            </div>
          </div>
          <div className="bg-slate-800/70 border border-white/10 p-4 rounded-xl flex gap-3">
            <Smartphone className="w-6 h-6 text-emerald-300 shrink-0" />
            <div>
              <div className="font-semibold text-white">Native LiDAR / depth capture</div>
              <p className="text-sm text-slate-400">Recommended professional path: iOS RoomPlan/LiDAR or Android ARCore Depth, then import the room model here.</p>
            </div>
          </div>
          <div className="bg-slate-800/70 border border-white/10 p-4 rounded-xl flex gap-3">
            <Ruler className="w-6 h-6 text-amber-300 shrink-0" />
            <div>
              <div className="font-semibold text-white">Survey-grade imports</div>
              <p className="text-sm text-slate-400">For highest accuracy, import point clouds or meshes from Matterport, Leica, FARO, or similar scanners.</p>
            </div>
          </div>
        </div>

        {supportChecked && !isWebXRSupported && (
           <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex gap-3 text-left">
              <AlertCircle className="w-6 h-6 text-red-400 shrink-0" />
              <p className="text-sm text-red-200">
                 Browser WebXR AR is not available here. You can still use this app as the viewer/import target for native LiDAR, ARCore Depth, or professional scanner output.
              </p>
           </div>
        )}

        <div className="space-y-3 pt-2">
          <Button
            className="w-full h-16 text-xl font-bold relative overflow-hidden group shadow-[0_0_40px_-10px_rgba(79,70,229,0.5)] bg-indigo-600 hover:bg-indigo-500 text-white border-0"
            onClick={() => setState('scanning')}
            disabled={supportChecked && !isWebXRSupported}
          >
            <Cpu className="w-5 h-5 mr-2" />
            Start Sensor-Assisted WebXR Scan
          </Button>
          <p className="text-xs text-slate-500">
            For production accuracy, use the native LiDAR/depth capture path and keep this browser mode as fallback.
          </p>
        </div>
      </div>
    </div>
  );
}
