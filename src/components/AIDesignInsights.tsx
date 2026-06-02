import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { Button } from './ui/button';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { ProcessedFeature } from '../core/models/types';

interface AIDesignInsightsProps {
    roomData: {
        width: number;
        length: number;
        height: number;
        features: ProcessedFeature[];
    };
    onClose: () => void;
}

export function AIDesignInsights({ roomData, onClose }: AIDesignInsightsProps) {
    const [insights, setInsights] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateInsights = async () => {
        setIsLoading(true);
        setError(null);
        setInsights('');

        try {
            const prompt = `You are an expert interior designer and architect. I have just scanned a room.
Here are the dimensions and features of the room:

- Dimensions: ${roomData.width.toFixed(2)}m wide, ${roomData.length.toFixed(2)}m long, and ${roomData.height.toFixed(2)}m high.
- Total Floor Area: ${(roomData.width * roomData.length).toFixed(2)} square meters.
- Features:
${roomData.features.length > 0 ? roomData.features.map(f => `  - ${f.type} (${f.width.toFixed(2)}m x ${f.height.toFixed(2)}m)`).join('\n') : '  - No major features (doors/windows) detected or added.'}

Based on this room profile, please provide:
1. An overall assessment of the space.
2. Suggested functional layouts (e.g., optimal furniture placement).
3. Recommended color schemes to enhance the room based on its dimensions and features.
4. Any architectural or lighting tips to make the room feel more spacious and welcoming.

Use Markdown formatting (headings, bullet points, bold text) for readability.`;

            const res = await fetch('/api/insights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Network error');
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder('utf-8');

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    setInsights(prev => prev + chunk);
                }
            }

        } catch (err: any) {
            console.error('Error generating insights:', err);
            setError(err.message || 'Failed to generate insights. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-y-0 right-0 w-full sm:w-96 bg-slate-900/95 backdrop-blur-xl border-l border-white/10 flex flex-col z-50 shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0 bg-slate-900/50">
                <div className="flex items-center gap-2 text-white">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <h2 className="font-semibold">AI Design Insights</h2>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white rounded-full">
                    <X className="w-5 h-5" />
                </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {insights ? (
                    <div className="prose prose-invert prose-sm max-w-none text-slate-300 pr-2">
                        <Markdown>{insights}</Markdown>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4 border border-indigo-500/20">
                            <Sparkles className="w-8 h-8 text-indigo-400" />
                        </div>
                        <h3 className="text-white font-medium mb-2">Unlock Your Room's Potential</h3>
                        <p className="text-slate-400 text-sm mb-6">
                            Let Gemini analyze your room's dimensions and features to suggest optimal layouts and color schemes.
                        </p>
                        <Button 
                            onClick={generateInsights} 
                            disabled={isLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white w-full rounded-xl py-6"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                    Analyzing Space...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-5 h-5 mr-2" />
                                    Generate Insights
                                </>
                            )}
                        </Button>
                        
                        {error && (
                            <p className="text-red-400 text-sm mt-4 bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                                {error}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {insights && !isLoading && (
                <div className="p-4 border-t border-white/10 bg-slate-900/50 shrink-0">
                    <Button 
                        onClick={generateInsights} 
                        variant="outline" 
                        className="w-full bg-transparent border-white/10 text-white hover:bg-white/5"
                    >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Regenerate
                    </Button>
                </div>
            )}
        </div>
    );
}
