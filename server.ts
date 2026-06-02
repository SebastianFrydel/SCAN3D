import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

function generateFallbackInsights(prompt: string): string {
  const widthMatch = prompt.match(/([\d.]+)\s*m\s*wide/i);
  const lengthMatch = prompt.match(/([\d.]+)\s*m\s*long/i);
  const heightMatch = prompt.match(/([\d.]+)\s*m\s*high/i);
  const areaMatch = prompt.match(/Total Floor Area:\s*([\d.]+)/i);
  
  const width = widthMatch ? parseFloat(widthMatch[1]) : 4.0;
  const length = lengthMatch ? parseFloat(lengthMatch[1]) : 5.0;
  const height = heightMatch ? parseFloat(heightMatch[1]) : 2.7;
  const area = areaMatch ? parseFloat(areaMatch[1]) : width * length;

  const isSmall = area < 12;
  const isLarge = area > 25;
  const aspect_ratio = width / length;
  const isElongated = aspect_ratio < 0.6 || aspect_ratio > 1.6;

  let report = `### 1. Overall Space Assessment
The scanned room presents a **${isSmall ? 'compact and cozy' : isLarge ? 'spacious and expansive' : 'well-proportioned medium-sized'}** profile measuring **${width.toFixed(2)}m x ${length.toFixed(2)}m** with a ceiling height of **${height.toFixed(2)}m**. 

- **Total Floor Area:** **${area.toFixed(2)} m²**
- **Volumetric Capacity:** **${(area * height).toFixed(2)} m³**
- **Aspect Ratio Category:** ${isElongated ? 'Elongated rectangular (challenges with central dead-zones)' : 'Square-adjacent/Balanced (highly versatile layout options)'}

The ceiling height of **${height.toFixed(2)}m** ${height >= 2.8 ? 'provides an airy, architectural volume' : 'suggests a standard modern scale'} which can be visually enhanced using specific vertical guiding elements.

---

### 2. Suggested Functional Layout & Furniture Placement
Based on the geometric footprint of the scan, we recommend the following spatial zoning:

${isSmall ? `
*   **The Perimeter Strategy:** Keep the core circulation path entirely clear. Place primary functional furniture (like a bed, desk, or sofa) flush against the longest wall segment.
*   **Multi-Functional Zones:** Utilize floating or fold-away desks to preserve ground floor-plate when not in use.
*   **Corner Anchoring:** Utilize the corners for high vertical storage or nested accent chairs to maximize useful floor area.
` : isElongated ? `
*   **Segmented Zoning:** Divide the length into two distinct focal zones (e.g., Lounge Zone and Work/Reading Zone). Avoid putting all heavy furniture on one side, which creates a 'corridor' effect.
*   **Floating Layout:** Pull the primary sofa or desk slightly off the wall (at least 30cm) to create a premium, breathable traffic flow behind it.
*   **Transverse Guidance:** Place rugs or credenzas perpendicular to the long walls to visually widen the narrow aspect.
` : `
*   **Radial Placement:** The balanced proportions allow for a central focus (e.g., floating a conversational sofa group or centralizing a queen-sized bed).
*   **Biophilic Zoning:** Keep pathways to windows open to invite direct sightlines. Place secondary reading chairs or plants in the natural sunlit corners.
*   **Wall Utility:** Ideal for placing symmetric storage units or custom built-in entertainment centers along the main solid wall.
`}

---

### 3. Recommended Color Schemes (Aesthetic Pairings)
To optimize the visual volume of the room, apply these custom color profiles:

*   **Primary Walls:** **Alabaster White / Warm Cashmere** (Reflects light efficiently across the ${area.toFixed(0)}m² footprint, maximizing perceived space).
*   **Accent Fields:** **Slate Blue or Desert Ochre** on the short boundary wall to ${isElongated ? 'visually bring the far wall closer' : 'add dramatic depth'}.
*   **Ceiling treatments:** Matte flat white with a 5% tint of the primary wall tone. This softens the transition and makes the ${height.toFixed(2)}m ceiling feel unified and taller.
*   **Trim and Hardware:** Satin charcoal or brushed brass to offer sharp architectural accents.

---

### 4. Architectural & Lighting Tips
*   **Mirrored Expansion:** Place a full-length floor mirror on the wall opposite your primary window to double the daylight bounce.
*   **Verticality Enhancement:** Hang curtains and drapery all the way from the ceiling down to the floor, rather than just at the window frame. This accentuates the full **${height.toFixed(2)}m** volume.
*   **Layered Lighting:** Move away from single overhead fixtures. Combine a low-slung floor lamp (warm 2700K) with linear LED strip highlights under floating shelves or behind headboards to wash the walls in ambient modern glow.`;

  return report;
}

function streamFallbackInsights(prompt: string, res: express.Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const text = generateFallbackInsights(prompt);
  const chunkSize = 25;
  let index = 0;

  const sendNextChunk = () => {
    if (index >= text.length) {
      res.end();
      return;
    }
    const chunk = text.slice(index, index + chunkSize);
    res.write(chunk);
    index += chunkSize;
    setTimeout(sendNextChunk, 15);
  };

  sendNextChunk();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routing for AI Insights
  app.post("/api/insights", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const isKeyMissing = !apiKey || apiKey.trim() === "" || apiKey === "YOUR_GEMINI_API_KEY" || apiKey.startsWith("your_");

    if (isKeyMissing) {
      console.log("Gemini API key is missing or placeholder. Streaming localized expert design insights...");
      return streamFallbackInsights(prompt, res);
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.5-flash',
        contents: prompt,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(chunk.text);
        }
      }
      res.end();
    } catch (err: any) {
      console.error("Error generating insights via Gemini API:", err);
      
      const errStr = String(err.message || err);
      const isKeyInvalid = errStr.includes("API key not valid") || errStr.includes("API_KEY_INVALID") || (err.status && err.status === 400);

      if (isKeyInvalid) {
        console.log("Invalid Gemini API key detected. Falling back to localized expert design insights...");
        if (!res.headersSent) {
          return streamFallbackInsights(prompt, res);
        }
      }

      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Failed to generate insights." });
      } else {
        res.end();
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
