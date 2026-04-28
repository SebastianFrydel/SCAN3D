import React, { useState } from 'react';
import { LiveScanner } from '@/components/LiveScanner';
import { RoomModel } from '@/components/RoomModel';
import { analyzeRoomPhotos, analyzeWalkthroughVideo, searchFurniture, generateRoomDesign, RoomData, Furniture } from '@/services/geminiService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Box, Camera, Search, ArrowRight, Plus, Trash2, WandSparkles, Image as ImageIcon, UploadCloud } from 'lucide-react';
import { Toaster, toast } from 'sonner';

export default function App() {
  const [step, setStep] = useState<'home' | 'capture' | 'analyzing' | 'results'>('home');
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [searchResults, setSearchResults] = useState<{ text: string, urls: string[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedRoomIdForFurniture, setSelectedRoomIdForFurniture] = useState<string>('');
  
  const [designStyle, setDesignStyle] = useState('');
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [designImage, setDesignImage] = useState<string | null>(null);
  const [isGeneratingDesign, setIsGeneratingDesign] = useState(false);

  React.useEffect(() => {
    if (rooms.length > 0 && !selectedRoomIdForFurniture) {
      setSelectedRoomIdForFurniture(rooms[0].id);
    }
  }, [rooms, selectedRoomIdForFurniture]);

  const addFurniture = (roomId: string, type: Furniture['type']) => {
    setRooms(prev => prev.map(room => {
      if (room.id === roomId) {
        const newFurniture: Furniture = {
          id: Math.random().toString(36).substring(7),
          type,
          position: { x: 0, z: 0 },
          rotation: 0
        };
        return { ...room, furniture: [...(room.furniture || []), newFurniture] };
      }
      return room;
    }));
  };

  const updateFurniture = (roomId: string, furnitureId: string, updates: Partial<Furniture>) => {
    setRooms(prev => prev.map(room => {
      if (room.id === roomId) {
        return {
          ...room,
          furniture: (room.furniture || []).map(f => f.id === furnitureId ? { ...f, ...updates } : f)
        };
      }
      return room;
    }));
  };

  const removeFurniture = (roomId: string, furnitureId: string) => {
    setRooms(prev => prev.map(room => {
      if (room.id === roomId) {
        return {
          ...room,
          furniture: (room.furniture || []).filter(f => f.id !== furnitureId)
        };
      }
      return room;
    }));
  };

  const handleCaptureComplete = async (scanData: { images: string[], orientations: any[] }) => {
    setStep('analyzing');
    try {
      const data = await analyzeRoomPhotos(scanData.images, scanData.orientations);
      
      let startX = 0;
      if (rooms.length > 0) {
        const lastRoom = rooms[rooms.length - 1];
        startX = (lastRoom.position?.x || 0) + lastRoom.width / 2 + data.width / 2 + 1;
      }

      const newRoom: RoomData = {
        ...data,
        id: Math.random().toString(36).substring(7),
        name: `Room ${rooms.length + 1}`,
        position: { x: startX, z: 0 }
      };

      setRooms(prev => [...prev, newRoom]);
      setStep('results');
      toast.success('Room scanned and added to floor plan!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to analyze room. Please try again.');
      setStep('capture');
    }
  };

  const updateRoomPosition = (id: string, axis: 'x' | 'z', value: number) => {
    setRooms(prev => prev.map(room => {
      if (room.id === id) {
        return {
          ...room,
          position: {
            ...room.position,
            x: room.position?.x || 0,
            z: room.position?.z || 0,
            [axis]: value
          }
        };
      }
      return room;
    }));
  };

  const handleSearchFurniture = async () => {
    if (rooms.length === 0) return;
    setIsSearching(true);
    try {
      const room = rooms[rooms.length - 1];
      const query = `furniture for a ${room.width}m by ${room.length}m room`;
      const results = await searchFurniture(query);
      setSearchResults(results);
    } catch (error) {
      console.error(error);
      toast.error('Failed to search for furniture.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerateDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!designStyle) return;

    setIsGeneratingDesign(true);
    try {
      const imageUrl = await generateRoomDesign(`A highly realistic, professional interior design photo of a room. Style: ${designStyle}. The room should look beautiful and well-lit.`, imageSize, aspectRatio);
      setDesignImage(imageUrl);
      toast.success("Design generated successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate design. Please try again.");
    } finally {
      setIsGeneratingDesign(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStep('analyzing');
    try {
      let data;
      if (file.type.startsWith('video/')) {
        data = await analyzeWalkthroughVideo(file);
      } else {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        data = await analyzeRoomPhotos([base64Data]);
      }

      const newRoom: RoomData = {
        ...data,
        id: Math.random().toString(36).substring(7),
        name: `Uploaded Room`,
        position: { x: 0, z: 0 }
      };

      setRooms(prev => [...prev, newRoom]);
      setStep('results');
      toast.success('Room analyzed completely!');
    } catch (error) {
      console.error(error);
      toast.error('Failed to analyze upload. Please try again.');
      setStep('home');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <Toaster position="top-center" />
      
      <header className="max-w-5xl mx-auto mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Box className="w-8 h-8 text-indigo-600" />
          <h1 className="text-2xl font-bold tracking-tight">RoomScanner 3D</h1>
        </div>
        {step !== 'home' && (
          <div className="flex gap-2">
            {step === 'results' && (
              <Button variant="outline" onClick={() => setStep('capture')}>
                <Plus className="w-4 h-4 mr-2" /> Add Another Room
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setRooms([]); setStep('home'); }}>Reset All</Button>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto">
        {step === 'home' && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-6">
            <div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
              <Camera className="w-12 h-12" />
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight max-w-2xl">
              Turn your rooms into a 3D floor plan
            </h2>
            <p className="text-lg text-slate-600 max-w-xl">
              Walk around your room, capture a few photos, and let our AI analyze the dimensions. Scan multiple rooms to build a complete floor plan.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mt-4">
              <Button size="lg" className="text-lg px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all" onClick={() => setStep('capture')}>
                Live AR Scan <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <div className="relative">
                <input 
                  type="file" 
                  accept="image/*,video/*" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  onChange={handleFileUpload} 
                />
                <Button size="lg" variant="outline" className="w-full text-lg px-8 py-6 rounded-full shadow-sm hover:shadow-md transition-all border-indigo-200 text-indigo-700 bg-indigo-50/50">
                  <UploadCloud className="mr-2 w-5 h-5" /> Upload Video/Photo
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'capture' && (
          <Card className="border-none shadow-xl bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Live Room Scan</CardTitle>
              <CardDescription>
                Follow the on-screen instructions to scan your room using your device's camera and motion sensors.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveScanner onScanComplete={handleCaptureComplete} />
            </CardContent>
          </Card>
        )}

        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <Box className="w-8 h-8 text-indigo-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
            <h3 className="text-2xl font-semibold">Analyzing Room Geometry...</h3>
            <p className="text-slate-500 max-w-md text-center">
              Our AI is processing your photos, estimating dimensions, and identifying architectural features. This usually takes 10-20 seconds.
            </p>
          </div>
        )}

        {step === 'results' && rooms.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>3D Floor Plan</CardTitle>
                  <CardDescription>Estimated from your photos. Drag to rotate, scroll to zoom.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RoomModel rooms={rooms} />
                </CardContent>
              </Card>

              <Tabs defaultValue="furnish" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="furnish"><Box className="w-4 h-4 mr-2" /> Furnish</TabsTrigger>
                  <TabsTrigger value="shop"><Search className="w-4 h-4 mr-2" /> Shop</TabsTrigger>
                  <TabsTrigger value="redesign"><WandSparkles className="w-4 h-4 mr-2" /> AI Redesign</TabsTrigger>
                </TabsList>
                
                <TabsContent value="furnish" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Add Furniture</CardTitle>
                      <CardDescription>Place 3D furniture models into your rooms.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <Label>Select Room</Label>
                        <Select value={selectedRoomIdForFurniture} onValueChange={setSelectedRoomIdForFurniture}>
                          <SelectTrigger><SelectValue placeholder="Select a room" /></SelectTrigger>
                          <SelectContent>
                            {rooms.map(r => (
                              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Button variant="outline" onClick={() => addFurniture(selectedRoomIdForFurniture, 'chair')}>+ Chair</Button>
                        <Button variant="outline" onClick={() => addFurniture(selectedRoomIdForFurniture, 'table')}>+ Table</Button>
                        <Button variant="outline" onClick={() => addFurniture(selectedRoomIdForFurniture, 'sofa')}>+ Sofa</Button>
                        <Button variant="outline" onClick={() => addFurniture(selectedRoomIdForFurniture, 'bed')}>+ Bed</Button>
                      </div>

                      {selectedRoomIdForFurniture && rooms.find(r => r.id === selectedRoomIdForFurniture)?.furniture?.length ? (
                        <div className="space-y-4 mt-6">
                          <h4 className="font-semibold text-sm">Placed Furniture</h4>
                          <div className="space-y-3">
                            {rooms.find(r => r.id === selectedRoomIdForFurniture)!.furniture!.map(f => (
                              <div key={f.id} className="bg-slate-50 p-3 rounded-lg border flex flex-col gap-3">
                                <div className="flex justify-between items-center">
                                  <span className="font-medium capitalize text-sm">{f.type}</span>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => removeFurniture(selectedRoomIdForFurniture, f.id)}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <Label className="text-xs text-slate-500">X (m)</Label>
                                    <Input type="number" step="0.5" value={f.position.x} onChange={e => updateFurniture(selectedRoomIdForFurniture, f.id, { position: { ...f.position, x: parseFloat(e.target.value) || 0 } })} className="h-8 text-sm" />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-slate-500">Z (m)</Label>
                                    <Input type="number" step="0.5" value={f.position.z} onChange={e => updateFurniture(selectedRoomIdForFurniture, f.id, { position: { ...f.position, z: parseFloat(e.target.value) || 0 } })} className="h-8 text-sm" />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-slate-500">Rot (°)</Label>
                                    <Input type="number" step="15" value={f.rotation} onChange={e => updateFurniture(selectedRoomIdForFurniture, f.id, { rotation: parseFloat(e.target.value) || 0 })} className="h-8 text-sm" />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="shop" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Find Furniture</CardTitle>
                      <CardDescription>Search the web for furniture that fits your rooms.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Button onClick={handleSearchFurniture} disabled={isSearching} variant="secondary" className="w-full">
                        {isSearching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching...</> : <><Search className="w-4 h-4 mr-2" /> Search Furniture</>}
                      </Button>

                      {searchResults && (
                        <div className="mt-6 space-y-4">
                          <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: searchResults.text.replace(/\\n/g, '<br/>') }} />
                          {searchResults.urls.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm">Sources:</h4>
                              <ul className="text-sm space-y-1">
                                {searchResults.urls.map((url, i) => (
                                  <li key={i}><a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate block">{url}</a></li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="redesign" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>AI Redesign</CardTitle>
                      <CardDescription>Generate high-quality inspiration images for your room.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleGenerateDesign} className="space-y-4">
                        <div className="space-y-2">
                          <Label>Design Style & Prompt</Label>
                          <Input 
                            value={designStyle} 
                            onChange={(e) => setDesignStyle(e.target.value)} 
                            placeholder="e.g., Minimalist Scandinavian living room with lots of plants" 
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Image Quality / Size</Label>
                            <Select value={imageSize} onValueChange={(val: any) => setImageSize(val)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1K">1K (Fastest)</SelectItem>
                                <SelectItem value="2K">2K (High Quality)</SelectItem>
                                <SelectItem value="4K">4K (Ultra HD)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Aspect Ratio</Label>
                            <Select value={aspectRatio} onValueChange={(val: any) => setAspectRatio(val)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                                <SelectItem value="4:3">4:3 (Standard)</SelectItem>
                                <SelectItem value="3:4">3:4 (Portrait)</SelectItem>
                                <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                                <SelectItem value="9:16">9:16 (Vertical)</SelectItem>
                                <SelectItem value="2:3">2:3 (Photo)</SelectItem>
                                <SelectItem value="3:2">3:2 (Landscape)</SelectItem>
                                <SelectItem value="21:9">21:9 (Ultrawide)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button type="submit" className="w-full" disabled={isGeneratingDesign || !designStyle}>
                          {isGeneratingDesign ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                          ) : (
                            <><ImageIcon className="w-4 h-4 mr-2" /> Generate Image</>
                          )}
                        </Button>
                      </form>

                      {designImage && (
                        <div className="mt-6 space-y-2">
                          <Label>Generated Design</Label>
                          <div className="rounded-xl overflow-hidden border shadow-sm">
                            <img src={designImage} alt="Generated room design" className="w-full h-auto" referrerPolicy="no-referrer" />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Scanned Rooms ({rooms.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {rooms.map((room, index) => (
                    <div key={room.id} className={index > 0 ? "pt-6 border-t" : ""}>
                      <h3 className="font-bold text-lg mb-4">{room.name}</h3>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-slate-50 p-3 rounded-lg border">
                          <div className="text-xs text-slate-500 uppercase font-semibold">Width</div>
                          <div className="text-lg font-bold">{room.width.toFixed(1)}m</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border">
                          <div className="text-xs text-slate-500 uppercase font-semibold">Length</div>
                          <div className="text-lg font-bold">{room.length.toFixed(1)}m</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border">
                          <div className="text-xs text-slate-500 uppercase font-semibold">Height</div>
                          <div className="text-lg font-bold">{room.height.toFixed(1)}m</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border">
                          <div className="text-xs text-slate-500 uppercase font-semibold">Area</div>
                          <div className="text-lg font-bold">{(room.width * room.length).toFixed(1)}m²</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                          <Label className="text-xs text-indigo-500 uppercase font-semibold">Offset X (m)</Label>
                          <Input 
                            type="number" 
                            step="0.5"
                            value={room.position?.x || 0} 
                            onChange={(e) => updateRoomPosition(room.id, 'x', parseFloat(e.target.value) || 0)}
                            className="mt-1 h-8 bg-white"
                          />
                        </div>
                        <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                          <Label className="text-xs text-indigo-500 uppercase font-semibold">Offset Z (m)</Label>
                          <Input 
                            type="number" 
                            step="0.5"
                            value={room.position?.z || 0} 
                            onChange={(e) => updateRoomPosition(room.id, 'z', parseFloat(e.target.value) || 0)}
                            className="mt-1 h-8 bg-white"
                          />
                        </div>
                      </div>

                      <div className="mb-4">
                        <h4 className="text-sm font-semibold mb-1">Analysis</h4>
                        <p className="text-sm text-slate-600">{room.description}</p>
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold mb-1">Features Detected</h4>
                        <ul className="text-sm space-y-2">
                          {room.features.map((f, i) => (
                            <li key={i} className="flex justify-between items-center bg-slate-50 p-2 rounded border">
                              <span className="capitalize font-medium">{f.type}</span>
                              <span className="text-slate-500 text-xs">{f.size.width.toFixed(1)}m x {f.size.height.toFixed(1)}m</span>
                            </li>
                          ))}
                          {room.features.length === 0 && (
                            <li className="text-slate-500 italic">No features detected</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
