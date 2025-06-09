import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertClothingItemSchema, insertOutfitSchema } from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Initialize Google Gemini AI - will be initialized when needed
let genAI: GoogleGenerativeAI;

async function analyzeClothingImage(imagePath: string): Promise<any> {
  try {
    // Initialize genAI if not already done
    if (!genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error("GOOGLE_API_KEY environment variable is not set");
      }
      genAI = new GoogleGenerativeAI(apiKey);
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    
    const prompt = `Analyze this clothing item image and provide a detailed analysis in the following JSON format:
{
  "category": "tops|bottoms|dresses|outerwear|accessories|shoes",
  "style": "casual|formal|business|sporty|bohemian|vintage|modern",
  "colors": ["primary_color", "secondary_color"],
  "fabric_type": "cotton|denim|silk|wool|polyester|leather|other",
  "pattern": "solid|striped|floral|geometric|abstract|none",
  "formality": "very_casual|casual|smart_casual|business_casual|formal|very_formal",
  "season": "spring|summer|fall|winter|all_season",
  "fit": "loose|regular|slim|tight",
  "description": "brief description of the item",
  "styling_tips": "how to style this item",
  "body_type_recommendations": "which body types this works well for"
}

Only return valid JSON, no additional text.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    try {
      // Clean the response text by removing markdown code blocks and any extra whitespace
      let cleanText = text.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
      
      // Try to extract JSON if it's embedded in other text
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }
      
      console.log("Cleaned AI response:", cleanText);
      return JSON.parse(cleanText);
    } catch (parseError) {
      console.error("Failed to parse AI response:", text);
      console.error("Parse error:", parseError);
      // Return fallback analysis
      return {
        category: "other",
        style: "casual",
        colors: ["unknown"],
        fabric_type: "other",
        pattern: "unknown",
        formality: "casual",
        season: "all_season",
        fit: "regular",
        description: "Clothing item",
        styling_tips: "Style according to occasion",
        body_type_recommendations: "Suitable for various body types"
      };
    }
  } catch (error) {
    console.error("AI analysis failed:", error);
    throw new Error("Failed to analyze image with AI");
  }
}

async function generateOutfitSuggestions(userId: number, occasion?: string): Promise<any[]> {
  try {
    const userItems = await storage.getClothingItems(userId);
    
    if (userItems.length < 2) {
      return [];
    }

    // Initialize genAI if not already done
    if (!genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error("GOOGLE_API_KEY environment variable is not set");
      }
      genAI = new GoogleGenerativeAI(apiKey);
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const itemsDescription = userItems.map(item => {
      const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        style: item.style,
        colors: item.colors,
        analysis: analysis
      };
    });

    const prompt = `Based on these clothing items: ${JSON.stringify(itemsDescription)}
    
Generate 3-6 outfit combinations${occasion ? ` for ${occasion}` : ''} and return them in this JSON format:
{
  "outfits": [
    {
      "name": "outfit name",
      "occasion": "business|casual|date_night|sporty|formal",
      "item_ids": [1, 2, 3],
      "confidence": 85,
      "description": "why this outfit works well",
      "styling_tips": "how to style and accessorize",
      "weather": "suitable weather conditions"
    }
  ]
}

Focus on color coordination, style compatibility, and occasion appropriateness. Only return valid JSON.`;

    const result = await model.generateContent([prompt]);
    const response = await result.response;
    const text = response.text();
    
    try {
      // Clean the response text by removing markdown code blocks and any extra whitespace
      let cleanText = text.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
      
      // Try to extract JSON if it's embedded in other text
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }
      
      console.log("Cleaned outfit suggestions response:", cleanText);
      const parsed = JSON.parse(cleanText);
      return parsed.outfits || [];
    } catch (parseError) {
      console.error("Failed to parse outfit suggestions:", text);
      console.error("Parse error:", parseError);
      return [];
    }
  } catch (error) {
    console.error("Failed to generate outfit suggestions:", error);
    return [];
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Mock user ID for demo purposes (in real app, would use authentication)
  const DEMO_USER_ID = 1;

  // Get all clothing items for user
  app.get("/api/clothing-items", async (req, res) => {
    try {
      const items = await storage.getClothingItems(DEMO_USER_ID);
      res.json(items);
    } catch (error) {
      console.error("Failed to get clothing items:", error);
      res.status(500).json({ error: "Failed to get clothing items" });
    }
  });

  // Upload and analyze clothing item
  app.post("/api/clothing-items", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Item name is required" });
      }

      // Analyze image with AI
      console.log("Analyzing image with Gemini AI...");
      const analysis = await analyzeClothingImage(req.file.path);
      
      // Create clothing item
      const itemData = {
        userId: DEMO_USER_ID,
        name,
        category: analysis.category || "other",
        style: analysis.style || "casual",
        colors: analysis.colors || ["unknown"],
        imageUrl: `/uploads/${req.file.filename}`,
        aiAnalysis: JSON.stringify(analysis),
      };

      const validatedData = insertClothingItemSchema.parse(itemData);
      const item = await storage.createClothingItem(validatedData);

      res.json(item);
    } catch (error) {
      console.error("Failed to create clothing item:", error);
      res.status(500).json({ error: "Failed to analyze and save clothing item" });
    }
  });

  // Serve uploaded images
  app.use('/uploads', (req, res, next) => {
    const filePath = path.join(uploadDir, req.path);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "Image not found" });
    }
  });

  // Delete clothing item
  app.delete("/api/clothing-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.getClothingItem(id);
      
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Delete image file
      const imagePath = path.join(process.cwd(), item.imageUrl);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

      const deleted = await storage.deleteClothingItem(id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: "Failed to delete item" });
      }
    } catch (error) {
      console.error("Failed to delete clothing item:", error);
      res.status(500).json({ error: "Failed to delete clothing item" });
    }
  });

  // Get outfit suggestions
  app.get("/api/outfits/suggestions", async (req, res) => {
    try {
      const { occasion } = req.query;
      const suggestions = await generateOutfitSuggestions(DEMO_USER_ID, occasion as string);
      res.json(suggestions);
    } catch (error) {
      console.error("Failed to get outfit suggestions:", error);
      res.status(500).json({ error: "Failed to generate outfit suggestions" });
    }
  });

  // Get saved outfits
  app.get("/api/outfits", async (req, res) => {
    try {
      const outfits = await storage.getOutfits(DEMO_USER_ID);
      res.json(outfits);
    } catch (error) {
      console.error("Failed to get outfits:", error);
      res.status(500).json({ error: "Failed to get outfits" });
    }
  });

  // Save outfit
  app.post("/api/outfits", async (req, res) => {
    try {
      const outfitData = {
        ...req.body,
        userId: DEMO_USER_ID,
        isSaved: true,
      };

      const validatedData = insertOutfitSchema.parse(outfitData);
      const outfit = await storage.createOutfit(validatedData);
      res.json(outfit);
    } catch (error) {
      console.error("Failed to save outfit:", error);
      res.status(500).json({ error: "Failed to save outfit" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
