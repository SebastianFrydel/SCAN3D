import React, { useState, useEffect } from 'react';
import { ARScanner, ScannedPlane } from './components/ARScanner';
import { RoomViewer } from './components/RoomViewer';
import { Button } from './components/ui/button';
import { Box, Scan, AlertCircle } from 'lucide-react';
import { Toaster } from 'sonner';

type AppState = 'landing' | 'scanning' | 'viewing';

export default function App() {
  const [state, setState] = useState<AppState>('landing');
  const [isWebXRSupported, setIsWebXRSupported] = useState(false);
  const [scannedPlanes, setScannedPlanes] = useState<ScannedPlane[]>([]);

  useEffect(() => {
    if ('xr' in navigator) {
      (navigator as any).xr?.isSessionSupported('immersive-ar').then((supported: boolean) => {
        setIsWebXRSupported(supported);
      });
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

        {!isWebXRSupported ? (
           <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex gap-3 text-left">
              <AlertCircle className="w-6 h-6 text-red-400 shrink-0" />
              <p className="text-sm text-red-200">
                 Your browser or device does not support WebXR AR or plane detection. 
                 Try using Chrome on Android or a WebXR viewer app on iOS.
              </p>
           </div>
        ) : (
          <div className="space-y-4 pt-6">
            <Button 
              className="w-full h-16 text-xl font-bold relative overflow-hidden group shadow-[0_0_40px_-10px_rgba(79,70,229,0.5)] bg-indigo-600 hover:bg-indigo-500 text-white border-0" 
              onClick={() => setState('scanning')}
            >
              Start Room Scan
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
