import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

export interface RoomFeature {
  type: 'door' | 'window';
  position: { x: number; y: number; z: number };
  size: { width: number; height: number };
}

export interface Furniture {
  id: string;
  type: 'chair' | 'table' | 'sofa' | 'bed';
  position: { x: number; z: number };
  rotation: number;
}

export interface RoomData {
  id: string;
  name: string;
  width: number;
  length: number;
  height: number;
  shape: string;
  features: RoomFeature[];
  description: string;
  position?: { x: number; z: number };
  furniture?: Furniture[];
}

export async function analyzeRoomPhotos(base64Images: string[], orientations?: any[]): Promise<Omit<RoomData, 'id' | 'name'>> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Limit to 20 images to avoid payload too large issues, allowing for 2 phases of 10
  const limitedImages = base64Images.slice(0, 20);
  const limitedOrientations = orientations ? orientations.slice(0, 20) : [];

  const parts = limitedImages.map(img => ({
    inlineData: {
      data: img.split(',')[1],
      mimeType: "image/jpeg",
    }
  }));

  const prompt = `You are an expert architect and computer vision system.
Analyze these photos of a room taken from multiple different angles and positions during a complex high-precision AR live scan. The user walked around the room to capture these diverse perspectives.
${orientations ? `Here is the precise device orientation data (yaw, pitch, roll) for each captured frame to help you understand the camera's exact position: ${JSON.stringify(limitedOrientations)}.` : ''}
Using this dense AR tracking data and the visual features in the photos, estimate the room's dimensions (width, length, height) in meters with high precision.
Identify the shape of the room (e.g., rectangular, L-shaped).
Identify key features like doors and windows, and estimate their approximate positions relative to the center of the room (0,0,0) and their sizes.
Provide a brief description of the room's current style and layout.
Return the result as a structured JSON object.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: { parts: [...parts, { text: prompt }] },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          width: { type: Type.NUMBER, description: "Estimated width in meters" },
          length: { type: Type.NUMBER, description: "Estimated length in meters" },
          height: { type: Type.NUMBER, description: "Estimated height in meters (usually 2.4 to 3.0)" },
          shape: { type: Type.STRING, description: "Shape of the room (e.g., rectangular)" },
          description: { type: Type.STRING, description: "Brief description of the room" },
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ["door", "window"] },
                position: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    z: { type: Type.NUMBER }
                  }
                },
                size: {
                  type: Type.OBJECT,
                  properties: {
                    width: { type: Type.NUMBER },
                    height: { type: Type.NUMBER }
                  }
                }
              }
            }
          }
        },
        required: ["width", "length", "height", "shape", "description", "features"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");
  return JSON.parse(text) as Omit<RoomData, 'id' | 'name'>;
}

export async function generateRoomDesign(prompt: string, imageSize: "1K" | "2K" | "4K" = "1K", aspectRatio: string = "16:9"): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [
        { text: prompt },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: aspectRatio as any,
        imageSize: imageSize
      }
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Failed to generate image");
}

export async function searchFurniture(query: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Find furniture recommendations for: ${query}. Provide a list of items with brief descriptions and why they fit.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const urls = chunks.map(chunk => chunk.web?.uri).filter(Boolean);

  return {
    text: response.text,
    urls
  };
}

export async function analyzeWalkthroughVideo(file: File): Promise<Omit<RoomData, 'id' | 'name'>> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // For client side video uploads to Gemini, we recommend using the File API
  // Here we use base64 conversion as an example for small files since we are a SPA
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const prompt = `You are an expert architect and computer vision system.
Analyze this video of a room walkthrough.
Based on the video tracking and visual features, estimate the room's dimensions (width, length, height) in meters with high precision.
Identify the shape of the room (e.g., rectangular, L-shaped).
Identify key features like doors and windows, and estimate their approximate positions relative to the center of the room (0,0,0) and their sizes.
Provide a brief description of the room's current style and layout.
Return the result as a structured JSON object.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        { inlineData: { data: base64Data, mimeType: file.type } },
        { text: prompt }
      ]
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          width: { type: Type.NUMBER, description: "Estimated width in meters" },
          length: { type: Type.NUMBER, description: "Estimated length in meters" },
          height: { type: Type.NUMBER, description: "Estimated height in meters (usually 2.4 to 3.0)" },
          shape: { type: Type.STRING, description: "Shape of the room (e.g., rectangular)" },
          description: { type: Type.STRING, description: "Brief description of the room" },
          features: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ["door", "window"] },
                position: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } }
                },
                size: {
                  type: Type.OBJECT,
                  properties: { width: { type: Type.NUMBER }, height: { type: Type.NUMBER } }
                }
              }
            }
          }
        },
        required: ["width", "length", "height", "shape", "description", "features"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");
  return JSON.parse(text) as Omit<RoomData, 'id' | 'name'>;
}
