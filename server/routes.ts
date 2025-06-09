import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertClothingItemSchema, insertOutfitSchema, ClothingItem } from "@shared/schema";
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

// Enhanced outfit validation with comprehensive fashion rules
function validateOutfitCombination(itemIds: number[], userItems: ClothingItem[]): boolean {
  const selectedItems = userItems.filter(item => itemIds.includes(item.id));
  
  if (selectedItems.length === 0) return false;
  
  // Group items by category and analyze gender targeting
  const categoryCount: { [key: string]: number } = {};
  const genderStyles: Set<string> = new Set();
  const formalityLevels: string[] = [];
  
  selectedItems.forEach(item => {
    categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
    
    // Detect gender orientation from item analysis
    try {
      const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
      if (analysis.description?.toLowerCase().includes('dress') || 
          analysis.description?.toLowerCase().includes('skirt') ||
          item.category === 'dresses') {
        genderStyles.add('feminine');
      }
      if (analysis.description?.toLowerCase().includes('suit') ||
          analysis.description?.toLowerCase().includes('tie') ||
          item.name.toLowerCase().includes('men')) {
        genderStyles.add('masculine');
      }
      if (analysis.formality) {
        formalityLevels.push(analysis.formality);
      }
    } catch (e) {
      // Continue validation without gender analysis
    }
  });
  
  // Rule 1: No multiple items from same body area category
  const singleItemCategories = ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'];
  for (const category of singleItemCategories) {
    if (categoryCount[category] > 1) {
      return false; // Multiple items from same body area
    }
  }
  
  // Rule 2: Must have complete outfit foundation
  const hasTop = categoryCount['tops'] > 0;
  const hasBottom = categoryCount['bottoms'] > 0;
  const hasDress = categoryCount['dresses'] > 0;
  
  if (!hasDress && !(hasTop && hasBottom)) {
    return false; // Incomplete outfit - need either dress OR top+bottom
  }
  
  // Rule 3: Gender consistency check (avoid mixing highly gendered items)
  if (genderStyles.has('feminine') && genderStyles.has('masculine')) {
    // Allow mix only if items are unisex/neutral
    const hasStronglyGendered = selectedItems.some(item => {
      const name = item.name.toLowerCase();
      const category = item.category.toLowerCase();
      return name.includes('dress') || name.includes('skirt') || 
             name.includes('suit jacket') || category === 'dresses';
    });
    if (hasStronglyGendered) return false;
  }
  
  // Rule 4: Formality level coherence (within 2 levels difference max)
  if (formalityLevels.length > 1) {
    const formalityMap: { [key: string]: number } = {
      'very_casual': 1, 'casual': 2, 'smart_casual': 3, 
      'business_casual': 4, 'formal': 5, 'very_formal': 6
    };
    const levels = formalityLevels.map(f => formalityMap[f] || 3);
    const maxDiff = Math.max(...levels) - Math.min(...levels);
    if (maxDiff > 2) return false; // Too much formality mismatch
  }
  
  return true;
}

// Generate diverse style names to avoid repetition
function generateUniqueStyleName(occasion: string, items: ClothingItem[], usedNames: Set<string>): string {
  const styleTemplates = {
    casual: [
      'Weekend Comfort', 'Laid-Back Style', 'Casual Chic', 'Effortless Look', 
      'Relaxed Elegance', 'Everyday Style', 'Comfortable Cool', 'Easy Going'
    ],
    business: [
      'Professional Edge', 'Corporate Style', 'Business Sharp', 'Office Ready',
      'Executive Look', 'Workplace Chic', 'Business Sophisticated', 'Professional Polish'
    ],
    formal: [
      'Evening Elegance', 'Formal Finesse', 'Sophisticated Style', 'Refined Look',
      'Dress-up Ready', 'Special Occasion', 'Polished Perfection', 'Formal Grace'
    ],
    date_night: [
      'Romantic Charm', 'Date Night Allure', 'Evening Romance', 'Captivating Style',
      'Dinner Date Ready', 'Night Out Chic', 'Romantic Elegance', 'Date Perfect'
    ],
    sporty: [
      'Athletic Edge', 'Sporty Chic', 'Active Style', 'Fitness Ready',
      'Athleisure Look', 'Workout Vibes', 'Sport Luxe', 'Active Comfort'
    ]
  };
  
  const templates = styleTemplates[occasion as keyof typeof styleTemplates] || styleTemplates.casual;
  
  // Try templates first
  for (const template of templates) {
    if (!usedNames.has(template)) {
      usedNames.add(template);
      return template;
    }
  }
  
  // Fallback to item-based naming
  const topItem = items.find(item => ['tops', 'dresses'].includes(item.category));
  const bottomItem = items.find(item => item.category === 'bottoms');
  
  if (topItem && bottomItem) {
    const name = `${topItem.colors[0]} & ${bottomItem.colors[0]} ${occasion}`;
    usedNames.add(name);
    return name;
  }
  
  return `Stylish ${occasion} ${Math.floor(Math.random() * 100)}`;
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

    // Color coordination logic
    const getColorHarmony = (colors: string[]): string[] => {
      const colorMap: { [key: string]: string[] } = {
        'white': ['black', 'navy', 'grey', 'blue', 'red', 'green', 'brown'],
        'black': ['white', 'grey', 'red', 'pink', 'yellow', 'silver'],
        'navy': ['white', 'cream', 'light blue', 'grey', 'khaki', 'beige'],
        'grey': ['white', 'black', 'navy', 'pink', 'yellow', 'blue'],
        'brown': ['cream', 'beige', 'white', 'navy', 'khaki', 'orange'],
        'blue': ['white', 'navy', 'grey', 'khaki', 'brown', 'cream'],
        'red': ['white', 'black', 'navy', 'grey', 'cream'],
        'green': ['white', 'khaki', 'brown', 'navy', 'cream'],
        'khaki': ['white', 'navy', 'brown', 'blue', 'green'],
        'beige': ['brown', 'navy', 'white', 'khaki', 'blue']
      };
      
      return colors.flatMap(color => colorMap[color.toLowerCase()] || ['white', 'black', 'grey']);
    };

    const prompt = `Based on these clothing items: ${JSON.stringify(itemsDescription)}

Generate 4-6 UNIQUE outfit combinations${occasion ? ` for ${occasion}` : ''} following strict fashion rules:

CRITICAL RULES:
1. BODY COVERAGE RULES:
   - EXACTLY ONE item from: tops, bottoms, dresses, outerwear, shoes
   - NEVER combine multiple pants, shirts, or dresses
   - Complete outfit = (top + bottom) OR dress + optional accessories

2. GENDER CONSISTENCY:
   - Keep feminine/masculine styling consistent within each outfit
   - Don't mix dresses with masculine suits or vice versa
   - Unisex items (t-shirts, jeans) can work in both styles

3. COLOR HARMONY:
   - Use complementary colors: white/black/grey with any color
   - Navy pairs with: white, cream, khaki, light blue
   - Brown pairs with: cream, beige, white, navy
   - Avoid clashing: red+green, orange+purple, yellow+pink
   - Maximum 3 main colors per outfit

4. FORMALITY MATCHING:
   - Casual: t-shirts, jeans, sneakers, casual dresses
   - Business: dress shirts, chinos, loafers, blazers
   - Formal: suits, dress shoes, ties, evening wear
   - Don't mix formal shoes with casual tops

5. UNIQUE NAMING:
   - Each outfit name must be different
   - Use descriptive, specific names
   - Avoid repetitive phrases

Return JSON format:
{
  "outfits": [
    {
      "name": "unique descriptive name",
      "occasion": "business|casual|date_night|sporty|formal",
      "item_ids": [1, 2, 3],
      "confidence": 85,
      "description": "specific color and style compatibility explanation",
      "styling_tips": "practical styling and accessory advice",
      "weather": "specific weather conditions"
    }
  ]
}

Focus on creating visually cohesive, wearable outfits with proper color coordination and style matching.`;

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
      const outfits = parsed.outfits || [];
      
      // Enhanced validation and post-processing
      const usedNames = new Set<string>();
      const validOutfits = outfits
        .filter((outfit: any) => {
          if (!outfit.item_ids || !Array.isArray(outfit.item_ids)) {
            return false;
          }
          return validateOutfitCombination(outfit.item_ids, userItems);
        })
        .map((outfit: any) => {
          // Ensure unique names
          if (usedNames.has(outfit.name)) {
            const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
            outfit.name = generateUniqueStyleName(outfit.occasion || 'casual', selectedItems, usedNames);
          } else {
            usedNames.add(outfit.name);
          }
          
          // Enhance color coordination check
          const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
          const allColors = selectedItems.flatMap(item => item.colors);
          const uniqueColors = Array.from(new Set(allColors));
          
          // Adjust confidence based on color harmony
          if (uniqueColors.length > 3) {
            outfit.confidence = Math.max(60, (outfit.confidence || 80) - 15); // Reduce confidence for too many colors
          }
          
          // Color clash detection
          const hasColorClash = 
            (uniqueColors.includes('red') && uniqueColors.includes('green')) ||
            (uniqueColors.includes('orange') && uniqueColors.includes('purple')) ||
            (uniqueColors.includes('yellow') && uniqueColors.includes('pink'));
          
          if (hasColorClash) {
            outfit.confidence = Math.max(50, (outfit.confidence || 80) - 25);
            outfit.description += " Note: Bold color combination - ensure proper styling.";
          }
          
          return outfit;
        })
        .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0)); // Sort by confidence
      
      console.log(`Filtered ${outfits.length} outfits down to ${validOutfits.length} valid combinations with enhanced validation`);
      return validOutfits;
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
