import React, { useState, useEffect } from 'react';
import { ARScanner, ScannedPlane } from './components/ARScanner';
import { ScannerSimulator } from './components/ScannerSimulator';
import { RoomViewer } from './components/RoomViewer';
import { SensorDiagnostics } from './components/SensorDiagnostics';
import { Button } from './components/ui/button';
import { Box, Scan, AlertCircle, Wand2, Cpu } from 'lucide-react';
import { Toaster } from 'sonner';
import { RoomLighting } from './core/models/types';

type AppState = 'landing' | 'scanning' | 'simulating' | 'viewing';

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: any, errorInfo: any}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }
  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ error, errorInfo });
    console.error(error, errorInfo);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, whiteSpace: 'pre-wrap', color: 'red' }}>
          <h2>Something went wrong.</h2>
          <details>
            <summary>Error Details</summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [state, setState] = useState<AppState>('landing');
  const [isWebXRSupported, setIsWebXRSupported] = useState(false);
  const [scannedPlanes, setScannedPlanes] = useState<ScannedPlane[]>([]);
  const [roomLighting, setRoomLighting] = useState<RoomLighting | undefined>(undefined);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    if ('xr' in navigator) {
      (navigator as any).xr?.isSessionSupported('immersive-ar').then((supported: boolean) => {
        setIsWebXRSupported(supported);
      });
    }
  }, []);

  const handleScanComplete = (planes: ScannedPlane[], scaleFactor: number = 1.0, lighting?: RoomLighting) => {
    setScannedPlanes(planes.map(p => {
        // Multiply by scale factor
        const scaledPoly = p.polygon.map(pt => ({x: pt.x * scaleFactor, y: pt.y * scaleFactor, z: pt.z * scaleFactor}));
        const scaledPos = {x: p.position.x * scaleFactor, y: p.position.y * scaleFactor, z: p.position.z * scaleFactor};
        return {...p, polygon: scaledPoly, position: scaledPos};
    }));
    setRoomLighting(lighting);
    setState('viewing');
  };

  if (state === 'scanning') {
    return <ARScanner onComplete={handleScanComplete} onCancel={() => setState('landing')} />;
  }

  if (state === 'simulating') {
    return <ScannerSimulator onComplete={handleScanComplete} onCancel={() => setState('landing')} />;
  }

  if (state === 'viewing') {
    return <RoomViewer planes={scannedPlanes} lighting={roomLighting} onBack={() => setState('landing')} />;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 font-sans p-6 flex flex-col items-center justify-center relative">
      <Toaster position="top-center" />
      
      {/* Diagnostics Modal Dialog Overlay */}
      {showDiagnostics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <SensorDiagnostics onClose={() => setShowDiagnostics(false)} />
        </div>
      )}

      <div className="max-w-md w-full space-y-8 text-center z-10">
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
           <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex flex-col gap-3 text-left">
              <div className="flex gap-3">
                  <AlertCircle className="w-6 h-6 text-red-400 shrink-0" />
                  <div className="space-y-1">
                      <p className="text-sm font-semibold text-red-200">
                         AR capabilities could not be initialized or are blocked.
                      </p>
                      <p className="text-xs text-red-300">
                         This browser lacks direct WebXR access. If using the preview console, open the app in a standalone tab.
                      </p>
                  </div>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <Button 
                  variant="outline"
                  className="w-full border-red-500/30 text-red-100 hover:bg-red-500/20"
                  onClick={() => setState('simulating')}
                >
                   <Wand2 className="w-4 h-4 mr-2" />
                   Run Simulated Demo
                </Button>
                <Button 
                  variant="ghost"
                  className="w-full text-xs text-slate-300 hover:text-white"
                  onClick={() => setShowDiagnostics(true)}
                >
                  <Cpu className="w-3.5 h-3.5 mr-1.5" />
                  Diagnose Sensors & Permissions
                </Button>
              </div>
           </div>
        ) : (
          <div className="space-y-4 pt-6">
            <Button 
              className="w-full h-16 text-xl font-bold relative overflow-hidden group shadow-[0_0_40px_-10px_rgba(79,70,229,0.5)] bg-indigo-600 hover:bg-indigo-500 text-white border-0" 
              onClick={() => setState('scanning')}
            >
              Start Room Scan
            </Button>
            <div className="flex flex-col gap-2 pt-2">
              <Button 
                variant="ghost"
                className="w-full text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10" 
                onClick={() => setState('simulating')}
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Run Simulated Demo Scan
              </Button>
              <Button 
                variant="ghost"
                className="w-full text-xs text-slate-400 hover:text-slate-200" 
                onClick={() => setShowDiagnostics(true)}
              >
                <Cpu className="w-3.5 h-3.5 mr-1.5" />
                Sensor & Tracking Status Health Check
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
