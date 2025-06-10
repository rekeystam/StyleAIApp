import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertClothingItemSchema, 
  insertOutfitSchema, 
  updateUserProfileSchema,
  insertWeatherDataSchema,
  insertShoppingRecommendationSchema,
  ClothingItem,
  User,
  WeatherData
} from "@shared/schema";
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

// CRITICAL: Fashion Stylist Validation System - Following Expert Guidelines
function validateOutfitCombination(itemIds: number[], userItems: ClothingItem[]): boolean {
  const selectedItems = userItems.filter(item => itemIds.includes(item.id));
  
  if (selectedItems.length === 0) return false;
  
  // RULE 1: GENDER-SPECIFIC STYLING VALIDATION
  const genderMarkers = {
    masculine: new Set(['men', 'masculine', 'suit', 'tie', 'tuxedo']),
    feminine: new Set(['women', 'feminine', 'dress', 'skirt', 'blouse', 'heels', 'pumps'])
  };
  
  let detectedGenders = new Set<string>();
  
  selectedItems.forEach(item => {
    const itemText = `${item.name} ${item.category}`.toLowerCase();
    const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
    const description = (analysis.description || '').toLowerCase();
    
    // Check for gender-specific indicators
    if (itemText.includes('men') || itemText.includes('suit') || itemText.includes('tie')) {
      detectedGenders.add('masculine');
    }
    if (itemText.includes('women') || itemText.includes('dress') || itemText.includes('skirt') || 
        itemText.includes('blouse') || itemText.includes('heels') || itemText.includes('pumps')) {
      detectedGenders.add('feminine');
    }
    
    // Category-based gender detection
    if (item.category === 'dresses') detectedGenders.add('feminine');
    if (description.includes('high-waisted') || description.includes('a-line')) detectedGenders.add('feminine');
  });
  
  // Allow mixed-gender styling for modern fashion
  // Only reject if explicitly conflicting formal wear
  if (detectedGenders.has('masculine') && detectedGenders.has('feminine')) {
    const hasFormalConflict = selectedItems.some(item => 
      item.name.toLowerCase().includes('suit') || item.name.toLowerCase().includes('dress')
    );
    if (hasFormalConflict) return false;
  }
  
  // RULE 2: Basic outfit structure validation
  const categoryCount: { [key: string]: number } = {};
  selectedItems.forEach(item => {
    categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
  });
  
  // Allow flexibility - need at least 2 items for an outfit
  if (selectedItems.length < 2) return false;
  
  // Prevent excessive duplicates but allow some flexibility
  for (const [category, count] of Object.entries(categoryCount)) {
    // Allow up to 2 accessories, but only 1 of major categories
    if (category === 'accessories' && count > 2) return false;
    if (category !== 'accessories' && count > 1) return false;
  }
  
  // More flexible outfit structure - allow various combinations
  const hasTop = categoryCount['tops'] > 0;
  const hasBottom = categoryCount['bottoms'] > 0;
  const hasDress = categoryCount['dresses'] > 0;
  const hasOuterwear = categoryCount['outerwear'] > 0;
  
  // Accept various outfit types
  const validOutfit = hasDress || 
                     (hasTop && hasBottom) || 
                     (hasTop && hasOuterwear) ||
                     (hasBottom && hasOuterwear) ||
                     selectedItems.length >= 3; // Allow creative 3+ item combinations
  
  if (!validOutfit) return false;
  
  // RULE 3: Relaxed color validation
  const allColors = selectedItems.flatMap(item => item.colors.map(c => c.toLowerCase()));
  const uniqueColors = Array.from(new Set(allColors));
  
  // Only block truly clashing combinations
  const forbiddenCombos = [
    ['orange', 'hot pink'], ['bright green', 'bright red']
  ];
  
  for (const [color1, color2] of forbiddenCombos) {
    const hasColor1 = uniqueColors.some(c => c.includes(color1));
    const hasColor2 = uniqueColors.some(c => c.includes(color2));
    if (hasColor1 && hasColor2) {
      return false;
    }
  }
  
  // Allow more colors for creative outfits
  if (uniqueColors.length > 5) return false;
  
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

// Global storage for preventing duplicate suggestions per session
const userSuggestionHistory = new Map<number, Set<string>>();



async function generateOutfitSuggestions(userId: number, occasion?: string): Promise<any[]> {
  const userItems = await storage.getClothingItems(userId);
  
  if (userItems.length < 2) {
    return [];
  }

  // Initialize suggestion history for user if not exists
  if (!userSuggestionHistory.has(userId)) {
    userSuggestionHistory.set(userId, new Set());
  }
  const previousSuggestions = userSuggestionHistory.get(userId)!;

  try {

    // Initialize genAI if not already done
    if (!genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        console.log("No Google API key available");
        return [];
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

    // Detect wardrobe gender orientation for consistent styling
    const wardrobeAnalysis = userItems.map(item => {
      const text = `${item.name} ${item.category}`.toLowerCase();
      let genderStyle = 'unisex';
      
      if (text.includes('dress') || text.includes('skirt') || text.includes('blouse') || 
          text.includes('heels') || text.includes('pumps') || item.category === 'dresses') {
        genderStyle = 'feminine';
      } else if (text.includes('suit') || text.includes('tie') || text.includes('men')) {
        genderStyle = 'masculine';
      }
      
      return { ...item, genderStyle };
    });

    const prompt = `You are an expert AI Fashion Stylist creating diverse, wearable outfit combinations.

AVAILABLE WARDROBE ITEMS: ${JSON.stringify(itemsDescription)}

PREVIOUS COMBINATIONS TO AVOID: ${Array.from(previousSuggestions).join(', ')}

STYLING GUIDELINES:
- Create 6-8 different outfit combinations using the available items
- Each outfit needs 2-4 clothing items for a complete look
- Focus on practical, wearable combinations
- Include variety: casual, business, formal, and creative looks
- Avoid repeating the exact same item combinations

OUTFIT REQUIREMENTS:
- Each outfit must have either: (top + bottom) OR (dress) OR (outerwear + other items)
- Only one bottom piece per outfit (pants, skirt, or dress)
- Colors should complement each other
- Consider the occasion and season

AVOID:
- Duplicate item combinations from previous suggestions
- More than one pair of pants/skirts in the same outfit
- Clashing bright colors (orange + pink, bright green + red)
✅ Colors follow approved harmony rules
✅ Appropriate for specified occasion: ${occasion || 'any'}
✅ Completely unique combination

Generate 3-5 COMPLETELY NEW outfit combinations in this JSON format:
{
  "outfits": [
    {
      "name": "unique descriptive name (never used before)",
      "occasion": "${occasion || 'casual'}",
      "item_ids": [1, 2, 3],
      "confidence": 85,
      "description": "explain why colors work together and style compatibility",
      "styling_tips": "specific practical advice for wearing this outfit",
      "weather": "appropriate weather conditions"
    }
  ]
}

RETURN ONLY VALID JSON - NO ADDITIONAL TEXT.`;

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
      
      // Enhanced validation with more permissive filtering
      const usedNames = new Set<string>();
      const validOutfits = outfits
        .filter((outfit: any) => {
          if (!outfit.item_ids || !Array.isArray(outfit.item_ids) || outfit.item_ids.length < 2) {
            return false;
          }
          
          // Check for duplicate item combinations
          const itemCombo = outfit.item_ids.sort().join(',');
          if (previousSuggestions.has(itemCombo)) {
            console.log(`Rejected duplicate combination: ${itemCombo}`);
            return false;
          }
          
          // Validate outfit composition
          const isValid = validateOutfitCombination(outfit.item_ids, userItems);
          if (!isValid) {
            console.log(`Outfit validation failed for items: ${outfit.item_ids.join(',')}`);
          }
          return isValid;
        })
        .map((outfit: any) => {
          // Track this combination to prevent future duplicates
          const itemCombo = outfit.item_ids.sort().join(',');
          previousSuggestions.add(itemCombo);
          
          // Ensure unique names
          if (usedNames.has(outfit.name)) {
            const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
            outfit.name = generateUniqueStyleName(outfit.occasion || 'casual', selectedItems, usedNames);
          } else {
            usedNames.add(outfit.name);
          }
          
          // Enhanced color coordination validation
          const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
          const allColors = selectedItems.flatMap(item => item.colors);
          const uniqueColors = Array.from(new Set(allColors));
          
          // Strict color harmony enforcement
          const hasApprovedColors = 
            (uniqueColors.includes('navy') && uniqueColors.includes('white')) ||
            (uniqueColors.includes('black') && uniqueColors.includes('white')) ||
            (uniqueColors.includes('burgundy') && uniqueColors.includes('cream')) ||
            uniqueColors.every(color => ['white', 'black', 'grey', 'navy', 'beige', 'khaki'].includes(color));
          
          if (hasApprovedColors) {
            outfit.confidence = Math.min(100, (outfit.confidence || 80) + 10);
          }
          
          // Penalty for too many colors
          if (uniqueColors.length > 3) {
            outfit.confidence = Math.max(60, (outfit.confidence || 80) - 15);
          }
          
          return outfit;
        })
        .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5); // Limit to top 5 outfits
      
      console.log(`Professional Fashion Styling: Filtered ${outfits.length} outfits down to ${validOutfits.length} expert-validated combinations`);
      console.log(`Duplicate prevention: ${previousSuggestions.size} combinations tracked for user ${userId}`);
      
      // Fallback: If no valid outfits after filtering, generate basic combinations
      if (validOutfits.length === 0 && userItems.length >= 2) {
        console.log("No valid AI suggestions, creating basic outfit combinations");
        const fallbackOutfits = [];
        
        // Group items by category
        const tops = userItems.filter(item => item.category === 'tops');
        const bottoms = userItems.filter(item => item.category === 'bottoms');
        
        // Generate basic top + bottom combinations
        for (const top of tops.slice(0, 2)) {
          for (const bottom of bottoms.slice(0, 2)) {
            const itemCombo = [top.id, bottom.id].sort().join(',');
            if (previousSuggestions.has(itemCombo)) continue;
            
            const outfit = {
              name: `${top.colors[0]} & ${bottom.colors[0]} Casual Look`,
              occasion: "casual",
              item_ids: [top.id, bottom.id],
              confidence: 75,
              description: `Simple combination of ${top.name} with ${bottom.name}.`,
              styling_tips: "Keep accessories minimal for a clean look.",
              weather: "Suitable for most weather conditions"
            };
            
            previousSuggestions.add(itemCombo);
            fallbackOutfits.push(outfit);
            
            if (fallbackOutfits.length >= 2) break;
          }
          if (fallbackOutfits.length >= 2) break;
        }
        
        return fallbackOutfits;
      }
      
      return validOutfits;
    } catch (parseError) {
      console.error("Failed to parse outfit suggestions:", text);
      console.error("Parse error:", parseError);
      return [];
    }
  } catch (error: any) {
    console.error("Failed to generate outfit suggestions:", error);
    
    // Handle API quota exceeded gracefully
    if (error.status === 429 || error.message?.includes('quota') || error.message?.includes('Too Many Requests')) {
      console.log("API quota exceeded, generating basic outfit combinations");
      return generateBasicOutfitCombinations(userItems, previousSuggestions, occasion);
    }
    
    return [];
  }
}

// Helper function to generate basic outfit combinations when AI is unavailable
function generateBasicOutfitCombinations(userItems: any[], previousSuggestions: Set<string>, occasion?: string): any[] {
  const basicOutfits = [];
  const tops = userItems.filter((item: any) => item.category === 'tops');
  const bottoms = userItems.filter((item: any) => item.category === 'bottoms');
  const dresses = userItems.filter((item: any) => item.category === 'dresses');
  
  // Create basic top + bottom combinations
  for (let i = 0; i < Math.min(tops.length, 2); i++) {
    for (let j = 0; j < Math.min(bottoms.length, 2); j++) {
      const top = tops[i];
      const bottom = bottoms[j];
      const itemCombo = [top.id, bottom.id].sort().join(',');
      
      if (previousSuggestions.has(itemCombo)) continue;
      
      basicOutfits.push({
        name: `${top.colors[0]} ${top.name} with ${bottom.colors[0]} ${bottom.name}`,
        occasion: occasion || "casual",
        item_ids: [top.id, bottom.id],
        confidence: 75,
        description: `Classic combination of ${top.name} and ${bottom.name}`,
        styling_tips: "Keep accessories simple for a clean look",
        weather: "Suitable for most conditions"
      });
      
      previousSuggestions.add(itemCombo);
      if (basicOutfits.length >= 3) break;
    }
    if (basicOutfits.length >= 3) break;
  }
  
  // Add dress outfits if available
  for (const dress of dresses.slice(0, 2)) {
    const itemCombo = [dress.id].join(',');
    if (previousSuggestions.has(itemCombo)) continue;
    
    basicOutfits.push({
      name: `Elegant ${dress.colors[0]} Dress`,
      occasion: "formal",
      item_ids: [dress.id],
      confidence: 80,
      description: `Beautiful ${dress.name} for special occasions`,
      styling_tips: "Add accessories to personalize the look",
      weather: "Perfect for mild weather"
    });
    
    previousSuggestions.add(itemCombo);
  }
  
  return basicOutfits.slice(0, 3);
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

      // Check for duplicate names to prevent duplicate uploads
      const existingItems = await storage.getClothingItems(DEMO_USER_ID);
      const duplicateName = existingItems.find(item => 
        item.name.toLowerCase().trim() === name.toLowerCase().trim()
      );
      
      if (duplicateName) {
        // Delete the uploaded file since we're rejecting it
        fs.unlinkSync(req.file.path);
        return res.status(409).json({ 
          error: "An item with this name already exists in your wardrobe",
          existingItem: duplicateName
        });
      }

      // Try to analyze image with AI, fallback if quota exceeded
      let analysis;
      try {
        console.log("Analyzing image with Gemini AI...");
        analysis = await analyzeClothingImage(req.file.path);
      } catch (error: any) {
        console.log("AI analysis failed, using fallback analysis:", error.message);
        // Provide basic fallback analysis when AI is unavailable
        analysis = {
          category: "other",
          style: "casual", 
          colors: ["unknown"],
          fabric_type: "unknown",
          pattern: "unknown",
          formality: "casual",
          season: "all_season",
          fit: "regular",
          description: `Clothing item: ${name}`,
          styling_tips: "Style according to occasion and personal preference",
          body_type_recommendations: "Suitable for various body types"
        };
      }
      
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
