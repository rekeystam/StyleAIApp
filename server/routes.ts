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
import crypto from "crypto";

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

// Rate limiting for Google API
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number = 14; // Keep under 15 limit
  private readonly timeWindow: number = 60000; // 1 minute

  canMakeRequest(): boolean {
    const now = Date.now();
    // Remove requests older than time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    return false;
  }

  getWaitTime(): number {
    if (this.requests.length === 0) return 0;
    const oldestRequest = Math.min(...this.requests);
    const waitTime = this.timeWindow - (Date.now() - oldestRequest);
    return Math.max(0, waitTime);
  }
}

const apiRateLimiter = new RateLimiter();

// Helper function to calculate image hash for duplicate detection
function calculateImageHash(imagePath: string): string {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    // Use multiple hashes for robust duplicate detection
    const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const md5Hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
    // Combine both hashes to create a unique signature
    const combinedHash = `${sha256Hash}:${md5Hash}`;
    console.log(`Calculated dual hash for ${path.basename(imagePath)}: ${sha256Hash.substring(0, 16)}...`);
    return combinedHash;
  } catch (error) {
    console.error(`Error calculating hash for ${imagePath}:`, error);
    // Return a unique hash if calculation fails to prevent false positives
    return crypto.createHash('sha256').update(imagePath + Date.now()).digest('hex') + ':error';
  }
}

// Enhanced filename validation to prevent bypass attempts
function validateFileName(fileName: string, existingItems: ClothingItem[]): { isValid: boolean; reason?: string; conflictingItem?: ClothingItem } {
  const normalizedName = fileName.toLowerCase().trim();
  
  // Check for suspicious patterns that indicate duplicate attempts
  const suspiciousPatterns = [
    { pattern: /copy/i, description: "contains 'copy'" },
    { pattern: /duplicate/i, description: "contains 'duplicate'" },
    { pattern: /\(\d+\)/i, description: "contains numbered parentheses" },
    { pattern: /_\d+$/, description: "ends with underscore and number" },
    { pattern: /-\d+$/, description: "ends with dash and number" },
    { pattern: /copy\s*\d*/i, description: "contains 'copy' with optional number" },
    { pattern: /version\s*\d*/i, description: "contains 'version' pattern" },
    { pattern: /new\s*copy/i, description: "contains 'new copy'" },
    { pattern: /another\s*copy/i, description: "contains 'another copy'" },
    { pattern: /final\s*copy/i, description: "contains 'final copy'" },
    { pattern: /backup/i, description: "contains 'backup'" },
    { pattern: /temp/i, description: "contains 'temp'" },
    { pattern: /test/i, description: "contains 'test'" }
  ];
  
  for (const { pattern, description } of suspiciousPatterns) {
    if (pattern.test(normalizedName)) {
      return { 
        isValid: false, 
        reason: `Filename ${description} - this suggests a duplicate attempt` 
      };
    }
  }
  
  // Check against existing item names with ultra-strict comparison
  const cleanName = (name: string) => name.toLowerCase().trim()
    .replace(/[^a-z0-9]/g, '');
  
  const cleanedNewName = cleanName(fileName);
  
  for (const item of existingItems) {
    const cleanedExistingName = cleanName(item.name);
    
    // Exact match after cleaning
    if (cleanedNewName === cleanedExistingName) {
      return {
        isValid: false,
        reason: "Identical name to existing item",
        conflictingItem: item
      };
    }
    
    // Remove substring matching - only exact matches are flagged
  }
  
  return { isValid: true };
}

// Helper function to check for duplicate images with AI-powered analysis
async function checkForDuplicateImage(imagePath: string, userId: number): Promise<ClothingItem | null> {
  const newImageHash = calculateImageHash(imagePath);
  const existingItems = await storage.getClothingItems(userId);
  
  console.log(`Checking for duplicates: new image hash ${newImageHash}`);
  
  // First level: Exact hash match only
  for (const item of existingItems) {
    try {
      const existingImagePath = path.join(process.cwd(), item.imageUrl);
      if (fs.existsSync(existingImagePath)) {
        const existingImageHash = calculateImageHash(existingImagePath);
        
        // Only exact hash matches are considered duplicates at this level
        if (newImageHash === existingImageHash) {
          console.log(`EXACT DUPLICATE DETECTED: Hash ${newImageHash} matches existing item "${item.name}" (ID: ${item.id})`);
          return item;
        }
      }
    } catch (error) {
      console.log(`Could not check hash for item ${item.id}: ${error}`);
    }
  }
  
  // Second level: AI-powered feature analysis for potential duplicates
  if (genAI) {
    try {
      const newImageAnalysis = await analyzeClothingImage(imagePath);
      
      for (const item of existingItems) {
        if (item.dominantColor && item.category && item.subcategory && item.style) {
          // Compare AI-analyzed features
          const featuresMatch = 
            newImageAnalysis.dominantColor === item.dominantColor &&
            newImageAnalysis.category === item.category &&
            newImageAnalysis.subcategory === item.subcategory &&
            newImageAnalysis.style === item.style;
          
          if (featuresMatch) {
            console.log(`AI DUPLICATE DETECTED: Features match existing item "${item.name}"`);
            console.log(`Matching features: ${newImageAnalysis.category}/${newImageAnalysis.subcategory}, ${newImageAnalysis.dominantColor}, ${newImageAnalysis.style}`);
            return item;
          }
        }
      }
    } catch (error) {
      console.log(`AI analysis failed, skipping feature comparison: ${error}`);
    }
  }
  
  return null;
}

// Weather API helper functions
async function fetchWeatherData(location: string): Promise<WeatherData | null> {
  try {
    // Check if we have cached weather data
    const cached = await storage.getWeatherData(location);
    if (cached && cached.timestamp && (Date.now() - cached.timestamp.getTime()) < 1800000) { // 30 minutes cache
      return cached;
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      console.error('OpenWeather API key not found');
      return null;
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric`
    );
    
    if (!response.ok) {
      console.error('Weather API request failed:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    
    const weatherData = await storage.createWeatherData({
      location,
      temperature: Math.round(data.main.temp),
      condition: data.weather[0].main.toLowerCase(),
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind?.speed * 3.6) || 0 // Convert m/s to km/h
    });
    
    return weatherData;
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return null;
  }
}

async function detectUserLocation(req: any): Promise<string> {
  // Try to get location from user profile first
  const userId = req.session?.user?.id || 1;
  const user = await storage.getUser(userId);
  
  if (user?.location) {
    return user.location;
  }
  
  // Fallback to IP-based detection (simplified)
  // In production, use a service like IPGeolocation API
  return "New York, NY";
}

function getSeasonFromTemperature(temp: number): string {
  if (temp < 5) return 'winter';
  if (temp < 15) return 'fall';
  if (temp < 25) return 'spring';
  return 'summer';
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

async function analyzeClothingImage(imagePath: string): Promise<any> {
  try {
    // Initialize genAI if not already done
    if (!genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        console.log("No Google API key available");
        return null;
      }
      genAI = new GoogleGenerativeAI(apiKey);
    }

    // Check rate limit before making API call
    if (!apiRateLimiter.canMakeRequest()) {
      const waitTime = apiRateLimiter.getWaitTime();
      console.log(`Rate limit reached. Need to wait ${Math.ceil(waitTime / 1000)} seconds.`);
      return null; // Return null instead of throwing error
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    
    const prompt = `You are an expert fashion AI analyzer. Analyze this clothing/accessory image with precision. Identify the SINGLE MOST PROMINENT item and provide detailed classification.

CRITICAL REQUIREMENTS:
1. NEVER use "unknown" for colors - always identify specific colors
2. Use VERY SPECIFIC subcategories and detailed descriptions
3. Classify style based on actual formality level, not default to casual
4. Detect brand indicators when visible
5. Provide EXTENSIVE details about the item type and characteristics

Provide analysis in this exact JSON format:

{
  "category": "accessories",
  "style": "business",
  "subcategory": "necktie",
  "item_type": "men's silk necktie",
  "colors": ["dusty_rose", "mauve"],
  "dominant_color": "dusty_rose",
  "accent_colors": ["mauve"],
  "fabric_type": "silk",
  "pattern": "textured_weave",
  "formality": "business",
  "suitable_occasions": ["business_meetings", "formal_events", "weddings"],
  "time_of_day": ["all_day"],
  "weather_suitability": ["all_weather"],
  "gender_style": "masculine",
  "brand_indicators": "premium_quality",
  "versatility_notes": "Classic professional necktie suitable for business and formal occasions",
  "season": "all_season",
  "fit": "standard_width",
  "description": "Men's dusty rose silk necktie with textured weave pattern, premium quality business accessory",
  "styling_tips": "Pairs excellently with white or light blue dress shirts, navy or charcoal suits",
  "body_type_recommendations": "Standard width suitable for most body types"
}

ENHANCED CLASSIFICATION RULES:

CATEGORY (MUST be ONE of):
- tops, bottoms, dresses, outerwear, accessories, shoes, swimwear

SUBCATEGORY & ITEM_TYPE (BE EXTREMELY SPECIFIC):

FOR ACCESSORIES - Use precise subcategory + detailed item_type:
- necktie → "men's silk necktie", "skinny tie", "bow tie", "formal necktie"
- belt → "leather dress belt", "casual fabric belt", "chain belt", "wide waist belt"
- watch → "luxury dress watch", "sports watch", "digital watch", "smartwatch"
- sunglasses → "aviator sunglasses", "cat-eye sunglasses", "round frame sunglasses"
- jewelry → "statement necklace", "delicate chain bracelet", "pearl earrings", "wedding ring"
- bags → "leather handbag", "canvas tote bag", "evening clutch", "crossbody bag"
- hat → "fedora hat", "baseball cap", "winter beanie", "sun hat"

FOR SHOES - Use specific subcategory + detailed seasonal/occasion type:
- sandals → "open-toe cork sandals", "strappy evening sandals", "sport sandals", "slide sandals"
- sneakers → "white leather sneakers", "running shoes", "high-top sneakers", "slip-on sneakers"
- boots → "ankle boots", "winter snow boots", "rain boots", "hiking boots", "dress boots"
- heels → "stiletto heels", "block heels", "wedge sandals", "kitten heels"
- flats → "ballet flats", "pointed-toe flats", "loafers", "boat shoes"
- dress_shoes → "oxford dress shoes", "penny loafers", "patent leather shoes", "monk strap shoes"

FOR TOPS:
- dress_shirt → "formal white dress shirt", "striped business shirt", "casual button-down"
- t_shirt → "basic cotton t-shirt", "graphic tee", "fitted v-neck", "oversized tee"
- blouse → "silk blouse", "peasant blouse", "wrap blouse", "sleeveless blouse"

STYLE CLASSIFICATION (detect actual formality):
- sporty: Athletic wear, gym clothes, branded sportswear (Adidas/Nike), athletic materials
- casual: T-shirts, jeans, hoodies, casual sneakers, everyday comfort wear
- smart_casual: Polo shirts, chinos, loafers, blazers with jeans, nice accessories
- business: Collared dress shirts, dress pants, blazers, professional attire, formal shoes
- formal: Suits, evening wear, dress shoes, formal dresses, ties, formal accessories
- fashion: Trendy accessories, designer pieces, statement items, stylish casual wear
- vintage: Retro styles, classic cuts, vintage-inspired pieces
- bohemian: Flowy fabrics, ethnic patterns, artistic styles, natural materials

MANDATORY COLOR DETECTION:
- NEVER use "unknown" for colors
- Always identify at least the dominant color
- Use specific color names: navy, burgundy, olive, coral, mustard, cream, charcoal, etc.
- For patterns: identify base color + pattern colors
- For metallics: specify gold, silver, rose_gold, bronze, copper
- For neutrals: be specific - ivory vs cream vs beige vs tan

DETAILED DESCRIPTION REQUIREMENTS:
- For accessories: Specify exact type (men's necktie vs bow tie vs ascot)
- For shoes: Include closure type (lace-up, slip-on, buckle, zipper)
- For shoes: Specify toe style (open-toe, closed-toe, pointed, round)
- For shoes: Include heel information (flat, low heel, high heel, platform)
- For shoes: Mention seasonal appropriateness (summer sandals, winter boots)
- For shoes: Include material details (leather, canvas, suede, synthetic)

ENHANCED COLOR DETECTION:
Detect ALL visible colors, not "unknown". Use specific color names:
- Primary colors: red, blue, yellow, green, orange, purple
- Neutrals: black, white, grey, beige, tan, cream, ivory
- Specific tones: navy, burgundy, olive, maroon, teal, coral, dusty_rose, mauve
- Always identify dominant_color and accent_colors separately

FOOTWEAR DETAILED ANALYSIS:
For shoes, specify these additional details:
- closure_type: "lace-up", "slip-on", "buckle", "zipper", "velcro", "elastic"
- toe_style: "open-toe", "closed-toe", "pointed", "round", "square", "peep-toe"
- heel_type: "flat", "low_heel", "high_heel", "stiletto", "block_heel", "wedge", "platform"
- seasonal_use: "summer", "winter", "all_season", "spring_fall"
- weather_protection: "waterproof", "breathable", "insulated", "ventilated"
- surface_finish: "matte", "glossy", "patent", "textured", "suede"

ACCESSORY DETAILED ANALYSIS:
For accessories, include these specifics:
- width_style: "standard", "skinny", "wide", "extra_wide" (for ties/belts)
- closure_type: "buckle", "snap", "magnetic", "tie", "clasp"
- occasion_formality: "everyday", "business", "formal_events", "special_occasions"

BUSINESS/FORMAL DETECTION:
- Collared shirts, tailored pants → business
- Fine materials (silk, wool), structured cuts → formal
- Athletic materials, loose fits → sporty
- Denim, cotton casual fits → casual

Return ONLY the JSON object, no other text.`;

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
      const parsed = JSON.parse(cleanText);
      
      // Normalize arrays to single values (take first element) and include new detailed fields
      const normalized = {
        category: Array.isArray(parsed.category) ? parsed.category[0] : parsed.category,
        subcategory: Array.isArray(parsed.subcategory) ? parsed.subcategory[0] : parsed.subcategory,
        item_type: parsed.item_type || parsed.subcategory, // New detailed item type
        style: Array.isArray(parsed.style) ? parsed.style[0] : parsed.style,
        colors: Array.isArray(parsed.colors) ? (Array.isArray(parsed.colors[0]) ? parsed.colors[0] : parsed.colors) : [parsed.colors],
        dominant_color: parsed.dominant_color,
        accent_colors: parsed.accent_colors,
        fabric_type: Array.isArray(parsed.fabric_type) ? parsed.fabric_type[0] : parsed.fabric_type,
        pattern: Array.isArray(parsed.pattern) ? parsed.pattern[0] : parsed.pattern,
        formality: Array.isArray(parsed.formality) ? parsed.formality[0] : parsed.formality,
        suitable_occasions: Array.isArray(parsed.suitable_occasions) ? parsed.suitable_occasions : [parsed.suitable_occasions],
        versatility_notes: parsed.versatility_notes,
        season: Array.isArray(parsed.season) ? parsed.season[0] : parsed.season,
        fit: Array.isArray(parsed.fit) ? parsed.fit[0] : parsed.fit,
        description: parsed.description,
        styling_tips: parsed.styling_tips,
        body_type_recommendations: parsed.body_type_recommendations,
        // New detailed fields for shoes and accessories
        closure_type: parsed.closure_type,
        toe_style: parsed.toe_style,
        heel_type: parsed.heel_type,
        seasonal_use: parsed.seasonal_use,
        weather_protection: parsed.weather_protection,
        surface_finish: parsed.surface_finish,
        width_style: parsed.width_style,
        occasion_formality: parsed.occasion_formality,
        gender_style: parsed.gender_style
      };
      
      return normalized;
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
  } catch (error: any) {
    console.error("AI analysis failed:", error);
    
    // Handle rate limit errors gracefully
    if (error?.status === 429 || error?.message?.includes('quota')) {
      console.log("Google API quota exceeded, skipping AI analysis");
      return null;
    }
    
    // For other errors, return null instead of throwing
    console.log("AI analysis unavailable, continuing without it");
    return null;
  }
}

// MANDATORY: Outfit Structure Validation Based on Upload Rules
function validateMandatoryOutfitStructure(itemIds: number[], userItems: ClothingItem[], temperature: number): boolean {
  const selectedItems = userItems.filter(item => itemIds.includes(item.id));
  
  if (selectedItems.length < 3) {
    console.log(`STRUCTURE VIOLATION: Outfit has ${selectedItems.length} items, minimum 3 required`);
    return false;
  }

  // Group items by category
  const categories = {
    bottoms: selectedItems.filter(item => item.category === 'bottoms'),
    tops: selectedItems.filter(item => item.category === 'tops'),
    shoes: selectedItems.filter(item => item.category === 'shoes'),
    outerwear: selectedItems.filter(item => item.category === 'outerwear'),
    accessories: selectedItems.filter(item => item.category === 'accessories')
  };

  // MANDATORY: Base requirements validation
  if (categories.bottoms.length === 0) {
    console.log(`STRUCTURE VIOLATION: No bottomwear (pants/jeans/skirts) included`);
    return false;
  }
  
  if (categories.tops.length === 0) {
    console.log(`STRUCTURE VIOLATION: No topwear (shirt/t-shirt/blouse) included`);
    return false;
  }
  
  if (categories.shoes.length === 0) {
    console.log(`STRUCTURE VIOLATION: No footwear (sneakers/boots/heels) included`);
    return false;
  }

  // CONDITIONAL: Outerwear rule for cold weather
  if (temperature < 14) {
    const availableOuterwear = userItems.filter(item => item.category === 'outerwear');
    if (availableOuterwear.length > 0 && categories.outerwear.length === 0) {
      console.log(`STRUCTURE VIOLATION: Temperature ${temperature}°C requires outerwear, but none included`);
      return false;
    }
  }

  // CONDITIONAL: Cold accessories rule
  if (temperature < 10) {
    const availableColdAccessories = userItems.filter(item => 
      item.category === 'accessories' && 
      (item.subcategory?.includes('glove') || item.subcategory?.includes('scarf') || item.subcategory?.includes('hat') || item.subcategory?.includes('beanie'))
    );
    if (availableColdAccessories.length > 0) {
      const includedColdAccessories = categories.accessories.filter(item =>
        item.subcategory?.includes('glove') || item.subcategory?.includes('scarf') || item.subcategory?.includes('hat') || item.subcategory?.includes('beanie')
      );
      if (includedColdAccessories.length === 0) {
        console.log(`STRUCTURE VIOLATION: Temperature ${temperature}°C requires cold weather accessories, but none included`);
        return false;
      }
    }
  }

  console.log(`STRUCTURE VALID: Outfit meets mandatory requirements for ${temperature}°C`);
  return true;
}

// ULTRA-FLEXIBLE: Fashion Stylist Validation System - Supporting Multi-Occasion Items
function validateOutfitCombination(itemIds: number[], userItems: ClothingItem[]): boolean {
  const selectedItems = userItems.filter(item => itemIds.includes(item.id));
  
  if (selectedItems.length === 0) return false;
  
  // RULE 1: MINIMAL STRUCTURE VALIDATION
  const categoryCount: { [key: string]: number } = {};
  selectedItems.forEach(item => {
    categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
  });
  
  // Need at least 2 items for an outfit
  if (selectedItems.length < 2) return false;
  
  // Prevent excessive duplicates in same category
  for (const [category, count] of Object.entries(categoryCount)) {
    // Allow up to 3 accessories, up to 2 shoes, but only 1 of other major categories
    if (category === 'accessories' && count > 3) return false;
    if (category === 'shoes' && count > 2) return false;
    if (!['accessories', 'shoes'].includes(category) && count > 1) return false;
  }
  
  // RULE 2: ULTRA-FLEXIBLE OUTFIT STRUCTURE
  const hasTop = categoryCount['tops'] > 0;
  const hasBottom = categoryCount['bottoms'] > 0;
  const hasDress = categoryCount['dresses'] > 0;
  const hasOuterwear = categoryCount['outerwear'] > 0;
  const hasShoes = categoryCount['shoes'] > 0;
  
  // Accept ANY reasonable combination - focus on completeness not style matching
  const coreOutfit = hasDress || (hasTop && hasBottom);
  const versatileOutfit = (hasTop && hasOuterwear) || (hasBottom && hasOuterwear) || selectedItems.length >= 3;
  const minimalOutfit = selectedItems.length >= 2; // Even just two pieces can work
  
  if (!coreOutfit && !versatileOutfit && !minimalOutfit) return false;
  
  // RULE 3: ULTRA-RELAXED COLOR VALIDATION
  const allColors = selectedItems.flatMap(item => item.colors.map(c => c.toLowerCase()));
  const uniqueColors = Array.from(new Set(allColors));
  
  // Only block extremely clashing neon combinations
  const extremeClashes = [
    ['neon orange', 'hot pink'], 
    ['bright lime', 'hot magenta'],
    ['fluorescent yellow', 'electric purple']
  ];
  
  for (const [color1, color2] of extremeClashes) {
    const hasColor1 = uniqueColors.some(c => c.includes(color1));
    const hasColor2 = uniqueColors.some(c => c.includes(color2));
    if (hasColor1 && hasColor2) {
      return false;
    }
  }
  
  // Allow up to 8 colors for maximum creative freedom
  if (uniqueColors.length > 8) return false;
  
  // RULE 4: COMPLETE STYLE FLEXIBILITY
  // Modern fashion allows ANY style mixing - business casual, smart casual, etc.
  // Blazers can be casual, dress shoes can be casual, suits can be broken up
  // NO STYLE RESTRICTIONS - let people express creativity
  
  // Only block truly impossible combinations
  const analysis = selectedItems.map(item => {
    try {
      return item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
    } catch {
      return {};
    }
  });
  
  // Only prevent swimwear with winter coats type combinations
  const hasSwimwear = selectedItems.some(item => 
    item.name.toLowerCase().includes('bikini') || 
    item.name.toLowerCase().includes('swimsuit')
  );
  
  const hasWinterCoat = selectedItems.some(item => 
    item.name.toLowerCase().includes('winter coat') || 
    item.name.toLowerCase().includes('parka')
  );
  
  if (hasSwimwear && hasWinterCoat) return false;
  
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

// Shopping recommendations logic
async function generateShoppingRecommendations(userId: number, outfits: any[], userItems: ClothingItem[], weatherData?: WeatherData): Promise<void> {
  const lowConfidenceOutfits = outfits.filter(outfit => outfit.confidence < 70);
  
  if (lowConfidenceOutfits.length === 0) return;
  
  // Analyze wardrobe gaps
  const categories = ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'];
  const userCategories = new Set(userItems.map(item => item.category));
  const missingCategories = categories.filter(cat => !userCategories.has(cat));
  
  // Weather-specific recommendations
  const weatherRecommendations: string[] = [];
  if (weatherData) {
    const temp = weatherData.temperature;
    const condition = weatherData.condition.toLowerCase();
    
    if (temp < 5) {
      weatherRecommendations.push('warm coat', 'wool sweater', 'thermal layers', 'winter boots');
    } else if (temp > 25) {
      weatherRecommendations.push('light cotton shirt', 'shorts', 'sandals', 'sun hat');
    }
    
    if (condition === 'rainy') {
      weatherRecommendations.push('waterproof jacket', 'rain boots', 'umbrella');
    }
  }
  
  // Color gap analysis
  const userColors = new Set(userItems.flatMap(item => item.colors.map(c => c.toLowerCase())));
  const essentialColors = ['black', 'white', 'navy', 'grey'];
  const missingColors = essentialColors.filter(color => !userColors.has(color));
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (missingCategories.includes('outerwear')) {
    recommendations.push('versatile blazer or cardigan for layering');
  }
  if (missingCategories.includes('shoes')) {
    recommendations.push('comfortable walking shoes or versatile flats');
  }
  if (missingColors.length > 0) {
    recommendations.push(`${missingColors.join(' or ')} colored basics for versatile mixing`);
  }
  
  recommendations.push(...weatherRecommendations);
  
  if (recommendations.length > 0) {
    await storage.createShoppingRecommendation({
      userId,
      category: 'wardrobe_gaps',
      reason: `Low outfit confidence (${lowConfidenceOutfits.length} outfits below 70% match)`,
      suggestedItems: JSON.stringify(recommendations.slice(0, 5)),
      confidence: Math.round(lowConfidenceOutfits.reduce((sum, outfit) => sum + outfit.confidence, 0) / lowConfidenceOutfits.length)
    });
  }
}



async function generateAdvancedOutfitSuggestions(userId: number, occasion?: string, weatherData?: WeatherData, userProfile?: User): Promise<any[]> {
  try {
    // Initialize genAI if not already done
    if (!genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        console.log("No Google API key available for advanced suggestions");
        return generateBasicOutfitCombinations(await storage.getClothingItems(userId), new Set(), occasion);
      }
      genAI = new GoogleGenerativeAI(apiKey);
    }

    // Check rate limit before making API call
    if (!apiRateLimiter.canMakeRequest()) {
      const waitTime = apiRateLimiter.getWaitTime();
      console.log(`Rate limit reached. Need to wait ${Math.ceil(waitTime / 1000)} seconds.`);
      return generateBasicOutfitCombinations(await storage.getClothingItems(userId), new Set(), occasion);
    }

    const userItems = await storage.getClothingItems(userId);
    const user = userProfile || await storage.getUser(userId);
    
    if (userItems.length === 0) {
      return [];
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    // Build comprehensive user profile for AI
    const profileData = {
      age: user?.age || null,
      bodyType: user?.bodyType || null,
      height: user?.height || null,
      skinTone: user?.skinTone || null,
      hairColor: user?.hairColor || null,
      hairLength: user?.hairLength || null,
      gender: user?.gender || null,
      makeupPreference: user?.makeupPreference || false,
      preferences: user?.preferences ? JSON.parse(user.preferences) : null
    };

    // Weather and environmental context
    const environmentalContext = {
      weather: weatherData ? {
        temperature: weatherData.temperature,
        condition: weatherData.condition,
        humidity: weatherData.humidity,
        windSpeed: weatherData.windSpeed
      } : null,
      season: weatherData ? getSeasonFromTemperature(weatherData.temperature) : 'spring',
      timeOfDay: getTimeOfDay(),
      occasion: occasion || 'casual'
    };

    // Prepare wardrobe data for AI analysis
    const wardrobeData = userItems.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      style: item.style,
      colors: item.colors,
      dominantColor: item.dominantColor,
      accentColors: item.accentColors,
      warmthLevel: item.warmthLevel,
      weatherSuitability: item.weatherSuitability,
      fabricType: item.fabricType,
      genderStyle: item.genderStyle,
      timeOfDay: item.timeOfDay,
      occasionSuitability: item.occasionSuitability,
      aiAnalysis: item.aiAnalysis ? JSON.parse(item.aiAnalysis) : null
    }));

    const advancedPrompt = `You are an expert fashion stylist AI using Gemini 2.0. Create sophisticated outfit combinations following MANDATORY outfit generation rules.

USER PROFILE:
${JSON.stringify(profileData, null, 2)}

ENVIRONMENTAL CONTEXT:
${JSON.stringify(environmentalContext, null, 2)}

AVAILABLE WARDROBE:
${JSON.stringify(wardrobeData, null, 2)}

MANDATORY OUTFIT GENERATION RULES:

1. BASE REQUIREMENTS (3 Items Minimum):
   - BOTTOMWEAR: Must include pants, jeans, joggers, or skirts (category: "bottoms")
   - TOPWEAR: Must include t-shirt, shirt, hoodie, or blouse (category: "tops")  
   - FOOTWEAR: Must include sneakers, boots, or heels (category: "shoes")

2. CONDITIONAL OUTERWEAR RULE:
   - IF temperature < 14°C AND outerwear exists in wardrobe
   - THEN add jacket, coat, padded vest, or parka (category: "outerwear")

3. COLD ACCESSORIES RULE:
   - IF temperature < 10°C AND items available in wardrobe
   - THEN add gloves, scarf, or beanie/hat (category: "accessories")

4. SOCKS RULE:
   - IF socks available in wardrobe AND wearing sneakers/boots
   - THEN add appropriate socks: sports socks for sportswear, casual socks for daily outfits

5. BELT RULE:
   - IF bottomwear supports belt AND belt available in wardrobe
   - THEN add matching belt (category: "accessories", subcategory: "belt")

6. OPTIONAL ACCESSORIES (Only if uploaded):
   - Sunglasses (if sunny weather)
   - Bag/backpack (for outing/casual/business occasions)
   - Watch, jewelry, cap (by user preference)

CRITICAL VALIDATION:
- Every outfit MUST have at least one item from each: bottoms, tops, shoes
- Never suggest items not in the available wardrobe
- Apply temperature-based rules strictly
- Validate all item IDs exist in wardrobe before including

ADVANCED STYLING REQUIREMENTS:

1. PERSONAL CHARACTERISTICS ADAPTATION:
   - Consider user's age for age-appropriate styling
   - Adapt to body type with flattering silhouettes
   - Account for height in proportions and styling
   - Match colors to skin tone for optimal appearance
   - Consider hair color/length for overall harmony

2. SMART LAYERING SYSTEM:
   - For temperatures below 15°C: Include warm outer layer (coat/jacket)
   - Add appropriate underlayers (shirts, sweaters, thermals) based on temperature
   - Suggest scarves, gloves, hats for temperatures below 5°C
   - Remove layers appropriately for temperatures above 25°C

3. GARMENT COORDINATION LOGIC:
   - Ensure color harmony using color theory principles
   - Match formality levels across all items
   - Consider fabric compatibility and texture mixing
   - Ensure style consistency or intentional contrast

4. WEATHER-APPROPRIATE SELECTIONS:
   - Rain: Suggest waterproof outerwear, appropriate footwear
   - Sun: Include sun protection, breathable fabrics
   - Wind: Consider wind-resistant outer layers
   - Snow: Ensure warm, weather-proof items

5. ACCESSORIES INTELLIGENCE:
   - Only suggest accessories that exist in the wardrobe
   - Match watch/jewelry to outfit formality
   - Coordinate bag style with occasion
   - Ensure belt matches shoes when both are included

6. FOOTWEAR LOGIC:
   - Match shoe style to occasion (formal/casual/athletic)
   - Consider weather appropriateness
   - Ensure comfort for planned activities
   - Coordinate colors with outfit palette

7. FORMAL WEAR STANDARDS:
   - For blazers/suits: Ensure proper shirt selection
   - Coordinate ties/pocket squares when available
   - Match belt to shoes in formal contexts
   - Consider dress code requirements

8. MAKEUP SUGGESTIONS:
   ${profileData.makeupPreference ? 'Include appropriate makeup palette suggestions based on outfit colors and occasion' : 'Skip makeup suggestions as user preference is set to false'}

Generate 3-5 expert outfit combinations. Each outfit MUST follow mandatory structure rules and include specific item IDs from the wardrobe.

MANDATORY VALIDATION CHECKLIST FOR EACH OUTFIT:
- ✓ Include at least one item from BOTTOMS category (pants/jeans/skirts)
- ✓ Include at least one item from TOPS category (shirts/t-shirts/blouses) 
- ✓ Include at least one item from SHOES category (sneakers/boots/heels)
- ✓ Add OUTERWEAR if temperature < 14°C and available
- ✓ Add cold accessories if temperature < 10°C and available
- ✓ Add socks if available and wearing sneakers/boots
- ✓ Add belt if bottomwear supports it and available
- ✓ Add sunglasses if sunny weather and available
- ✓ Only use item IDs that exist in the wardrobe

Response format (JSON only):
{
  "outfits": [
    {
      "name": "descriptive outfit name",
      "item_ids": [specific IDs from wardrobe that meet mandatory requirements],
      "confidence": 85,
      "description": "detailed outfit description with styling rationale",
      "personal_fit_analysis": "how this outfit works with user's personal characteristics",
      "layering_strategy": "detailed layering approach for current conditions",
      "color_coordination": "color theory explanation for chosen combination",
      "occasion_appropriateness": "why this works for the specified occasion",
      "weather_adaptation": "how outfit addresses current weather conditions",
      "styling_tips": "specific tips for wearing this outfit",
      "accessories_rationale": "explanation of accessory choices",
      "footwear_justification": "why these shoes work with this outfit",
      "makeup_suggestion": "${profileData.makeupPreference ? 'specific makeup palette and style recommendations' : 'N/A - user preference disabled'}",
      "body_type_optimization": "how outfit flatters user's body type",
      "age_appropriateness": "style considerations for user's age",
      "temperature_range": "suitable temperature range",
      "formality_level": "casual/business casual/formal classification",
      "structure_compliance": "confirmation that outfit meets mandatory base requirements"
    }
  ]
}`;

    const result = await model.generateContent(advancedPrompt);
    const response = await result.response;
    const text = response.text();
    
    console.log("Advanced Gemini 2.0 outfit suggestions response:", text);
    
    try {
      // Clean and parse the response
      let cleanText = text.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }
      
      const parsed = JSON.parse(cleanText);
      
      if (parsed.outfits && Array.isArray(parsed.outfits)) {
        // Apply mandatory outfit structure validation
        const structurallyValidOutfits = parsed.outfits.filter((outfit: any) => {
          if (!outfit.item_ids || !Array.isArray(outfit.item_ids)) return false;
          const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
          
          // Check mandatory base requirements: bottoms, tops, shoes
          const hasBottoms = selectedItems.some(item => item.category === 'bottoms');
          const hasTops = selectedItems.some(item => item.category === 'tops');
          const hasShoes = selectedItems.some(item => item.category === 'shoes');
          
          if (!hasBottoms || !hasTops || !hasShoes) {
            console.log(`STRUCTURE VIOLATION: Missing mandatory categories - bottoms: ${hasBottoms}, tops: ${hasTops}, shoes: ${hasShoes}`);
            return false;
          }
          
          return selectedItems.length >= 3;
        });

        // Validate that all item IDs exist in user's wardrobe
        const validatedOutfits = structurallyValidOutfits.filter((outfit: any) => {
          if (!outfit.item_ids || !Array.isArray(outfit.item_ids)) return false;
          return outfit.item_ids.every((id: any) => userItems.some(item => item.id === id));
        });
        
        console.log(`Advanced outfit generation: ${validatedOutfits.length} valid outfits created (${parsed.outfits.length - validatedOutfits.length} rejected for structure violations)`);
        
        // If no structurally valid outfits, fallback to basic generation
        if (validatedOutfits.length === 0) {
          console.log("No valid outfits from AI - falling back to basic generation with mandatory structure");
          return generateBasicOutfitCombinations(userItems, new Set(), occasion);
        }
        
        return validatedOutfits;
      }
    } catch (parseError) {
      console.error("Failed to parse advanced outfit suggestions:", parseError);
    }
    
    // Fallback to basic system if AI fails
    return generateBasicOutfitCombinations(userItems, new Set(), occasion);
    
  } catch (error) {
    console.error("Advanced outfit generation failed:", error);
    return generateBasicOutfitCombinations(await storage.getClothingItems(userId), new Set(), occasion);
  }
}

async function generateOutfitSuggestions(userId: number, occasion?: string, weatherData?: WeatherData, userProfile?: User): Promise<any[]> {
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

    // Enhanced color coordination logic with comprehensive color matching
    const getColorHarmony = (colors: string[]): string[] => {
      const colorMap: { [key: string]: string[] } = {
        // Neutrals - work with everything
        'white': ['black', 'navy', 'grey', 'blue', 'red', 'green', 'brown', 'beige', 'burgundy'],
        'black': ['white', 'grey', 'red', 'pink', 'yellow', 'silver', 'cream', 'ivory'],
        'grey': ['white', 'black', 'navy', 'pink', 'yellow', 'blue', 'purple', 'burgundy'],
        'beige': ['brown', 'navy', 'white', 'khaki', 'blue', 'cream', 'tan', 'olive'],
        'cream': ['navy', 'brown', 'khaki', 'burgundy', 'olive', 'tan'],
        'ivory': ['navy', 'brown', 'black', 'burgundy', 'forest_green'],
        'tan': ['navy', 'white', 'brown', 'olive', 'burgundy'],
        
        // Blues
        'navy': ['white', 'cream', 'light_blue', 'grey', 'khaki', 'beige', 'tan', 'burgundy'],
        'blue': ['white', 'navy', 'grey', 'khaki', 'brown', 'cream', 'yellow'],
        'light_blue': ['white', 'navy', 'grey', 'khaki', 'coral'],
        'teal': ['white', 'coral', 'navy', 'grey', 'cream'],
        
        // Earth tones
        'brown': ['cream', 'beige', 'white', 'navy', 'khaki', 'orange', 'tan'],
        'khaki': ['white', 'navy', 'brown', 'blue', 'green', 'olive'],
        'olive': ['white', 'khaki', 'brown', 'navy', 'cream', 'tan'],
        
        // Reds
        'red': ['white', 'black', 'navy', 'grey', 'cream'],
        'burgundy': ['white', 'grey', 'navy', 'cream', 'tan', 'olive'],
        'maroon': ['white', 'grey', 'cream', 'tan'],
        'coral': ['white', 'navy', 'teal', 'light_blue'],
        'pink': ['white', 'grey', 'navy', 'black'],
        
        // Greens
        'green': ['white', 'khaki', 'brown', 'navy', 'cream'],
        'forest_green': ['white', 'khaki', 'tan', 'ivory'],
        'lime': ['white', 'navy', 'grey'],
        
        // Purples
        'purple': ['white', 'grey', 'black', 'cream'],
        'lavender': ['white', 'grey', 'navy'],
        
        // Yellows/Oranges
        'yellow': ['white', 'grey', 'navy', 'blue'],
        'orange': ['white', 'brown', 'navy', 'cream'],
        'mustard': ['navy', 'white', 'brown']
      };
      
      return colors.flatMap(color => {
        const normalizedColor = color.toLowerCase().replace(/[^a-z]/g, '_');
        return colorMap[normalizedColor] || ['white', 'black', 'grey', 'navy'];
      });
    };

    // Enhanced wardrobe analysis with gender, style, and accessory detection
    const wardrobeAnalysis = userItems.map(item => {
      const text = `${item.name} ${item.category}`.toLowerCase();
      const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
      
      let genderStyle = analysis.gender_style || 'unisex';
      let subcategory = analysis.subcategory || item.category;
      let timeOfDay = analysis.time_of_day || ['all_day'];
      let weatherSuitability = analysis.weather_suitability || ['mild'];
      
      // Enhanced gender detection
      if (text.includes('dress') || text.includes('skirt') || text.includes('blouse') || 
          text.includes('heels') || text.includes('pumps') || item.category === 'dresses' ||
          text.includes('earrings') || analysis.subcategory === 'earrings') {
        genderStyle = 'feminine';
      } else if (text.includes('suit') || text.includes('tie') || text.includes('men') ||
                 text.includes('watch') || analysis.subcategory === 'watch') {
        genderStyle = 'masculine';
      }
      
      // Detect athletic/sporty items
      const isAthletic = text.includes('athletic') || text.includes('sport') || 
                        text.includes('gym') || text.includes('adidas') || 
                        text.includes('nike') || item.style === 'sporty' ||
                        analysis.style === 'sporty';
      
      // Detect business/formal items
      const isBusiness = text.includes('business') || text.includes('formal') ||
                        text.includes('blazer') || text.includes('suit') ||
                        item.style === 'business' || item.style === 'formal';
      
      return { 
        ...item, 
        genderStyle, 
        subcategory,
        timeOfDay,
        weatherSuitability,
        isAthletic,
        isBusiness,
        analysis
      };
    });

    // Build comprehensive context for AI styling
    const weatherContext = weatherData ? {
      temperature: weatherData.temperature,
      condition: weatherData.condition,
      humidity: weatherData.humidity,
      windSpeed: weatherData.windSpeed,
      season: getSeasonFromTemperature(weatherData.temperature),
      timeOfDay: getTimeOfDay()
    } : null;

    const userContext = userProfile ? {
      bodyType: userProfile.bodyType,
      skinTone: userProfile.skinTone,
      age: userProfile.age,
      height: userProfile.height,
      gender: userProfile.gender,
      preferences: userProfile.preferences ? JSON.parse(userProfile.preferences) : null
    } : null;

    // Enhanced occasion filtering with subcategory and style analysis
    const occasionFilteredItems = wardrobeAnalysis.filter(item => {
      const analysis = item.analysis || {};
      const itemStyle = item.style?.toLowerCase() || 'casual';
      const itemCategory = item.category?.toLowerCase() || '';
      const itemName = item.name?.toLowerCase() || '';
      const subcategory = analysis.subcategory || '';
      const suitableOccasions = analysis.suitable_occasions || [];
      
      if (!occasion || occasion === 'casual') {
        // Casual: allow most items, exclude very formal pieces
        return !itemName.includes('tuxedo') && analysis.style !== 'very_formal';
      }
      
      if (occasion === 'sporty' || occasion === 'athletic') {
        // Athletic: prioritize sporty items
        return item.isAthletic || itemStyle === 'sporty' || 
               suitableOccasions.includes('gym') || suitableOccasions.includes('athletic') ||
               subcategory.includes('athletic') || subcategory === 'tank_top';
      }
      
      if (occasion === 'business' || occasion === 'business_casual') {
        // Business: prioritize professional items
        const businessKeywords = ['business', 'formal', 'professional', 'blazer', 'suit', 'dress_shoes'];
        const isBusinessSuitable = businessKeywords.some(keyword => 
          itemStyle.includes(keyword) || subcategory.includes(keyword) || 
          suitableOccasions.includes('business') || suitableOccasions.includes('work')
        );
        
        // Include versatile pieces that work in business contexts
        const versatileForBusiness = 
          (itemCategory === 'tops' && !subcategory.includes('t_shirt') && !item.isAthletic) ||
          (itemCategory === 'bottoms' && (subcategory.includes('chinos') || subcategory.includes('dress_pants'))) ||
          (itemCategory === 'shoes' && !subcategory.includes('sneakers') && !item.isAthletic) ||
          (itemCategory === 'accessories' && (subcategory === 'belt' || subcategory === 'watch'));
        
        return isBusinessSuitable || versatileForBusiness;
      }
      
      if (occasion === 'formal') {
        // Formal: strict formal requirements
        const formalKeywords = ['formal', 'dress', 'suit', 'blazer', 'heels', 'dress_shoes'];
        return formalKeywords.some(keyword => 
          itemStyle.includes(keyword) || subcategory.includes(keyword) || 
          suitableOccasions.includes('formal') || analysis.formality === 'formal'
        );
      }
      
      if (occasion === 'date_night') {
        // Date night: versatile, attractive pieces
        return !item.isAthletic && analysis.style !== 'very_casual' &&
               !subcategory.includes('gym') && !suitableOccasions.includes('gym');
      }
      
      return true; // Default: include all items
    });

    // Filter items by weather suitability
    const weatherSuitableItems = weatherData ? occasionFilteredItems.filter(item => {
      if (!item.weatherSuitability) return true;
      const temp = weatherData.temperature;
      const condition = weatherData.condition.toLowerCase();
      
      // Temperature-based filtering
      if (temp < 5 && !item.weatherSuitability.includes('cold')) return false;
      if (temp > 25 && !item.weatherSuitability.includes('sun')) return false;
      if (condition === 'rainy' && !item.weatherSuitability.includes('rain')) return false;
      
      return true;
    }) : occasionFilteredItems;

    const prompt = `You are a PROFESSIONAL FASHION STYLIST with years of experience in personal styling, color theory, and trend forecasting. You work with high-end clients and understand the nuances of creating sophisticated, fashionable looks.

STYLIST SYSTEM INSTRUCTIONS:
Your outputs must:
- Always give unique outfit suggestions (no exact duplication of outfits)
- Allow a maximum of 1–2 items to be reused across different outfits
- Match colors, cuts, and styles in a fashionable and seasonally appropriate way
- Avoid repeating outfits or recycling combinations unless explicitly requested
- Provide clear, confident styling logic to explain each recommendation

Stay fully in character as a professional stylist.
NEVER break role or explain yourself as an AI.
NEVER include technical implementation details in responses unless specifically requested.

Your goal is to make the user feel like they are speaking with a real fashion expert who understands design, trends, body types, and occasion dressing.

When given a user wardrobe (images + metadata) and styling context, return:
- 3 to 5 stylish, diverse, and non-repetitive outfit suggestions
- A short stylist's note for each outfit explaining the match

NEVER repeat an outfit combination. Items may appear in at most two different outfits.

Remain focused, stylish, and sophisticated in tone at all times.

AVAILABLE WARDROBE ITEMS: ${JSON.stringify(itemsDescription)}

WEATHER CONTEXT: ${weatherContext ? JSON.stringify(weatherContext) : 'No specific weather data'}

USER PROFILE: ${userContext ? JSON.stringify(userContext) : 'No specific user profile'}

PREVIOUS COMBINATIONS TO AVOID: ${Array.from(previousSuggestions).join(', ')}

PERSONALIZATION GUIDELINES:
${userContext ? `
- Body Type: ${userContext.bodyType || 'Not specified'} - Choose flattering silhouettes
- Skin Tone: ${userContext.skinTone || 'Not specified'} - Select complementary colors
- Age: ${userContext.age || 'Not specified'} - Age-appropriate styling
- Gender: ${userContext.gender || 'Not specified'} - Respect style preferences
- Preferences: ${userContext.preferences ? JSON.stringify(userContext.preferences) : 'None specified'}
` : '- No specific user profile available'}

WEATHER CONSIDERATIONS:
${weatherContext ? `
- Temperature: ${weatherContext.temperature}°C (${weatherContext.season})
- Condition: ${weatherContext.condition}
- Time: ${weatherContext.timeOfDay}
- Humidity: ${weatherContext.humidity}%
- Wind: ${weatherContext.windSpeed} km/h

WEATHER-BASED STYLING:
- For cold weather (< 5°C): Include warm layers, outerwear, closed shoes
- For cool weather (5-15°C): Light layers, long sleeves, closed shoes
- For mild weather (15-25°C): Versatile pieces, light layers optional
- For warm weather (> 25°C): Breathable fabrics, light colors, minimal layers
- For rainy weather: Water-resistant materials, closed shoes, layering
- For windy weather: Fitted clothes, avoid loose flowing items
` : '- Consider general seasonal appropriateness'}

PROFESSIONAL STYLING GUIDELINES:
As a fashion expert, I create 3-5 sophisticated outfit combinations that showcase:

SIGNATURE STYLING APPROACH:
- Each look tells a cohesive style story with intentional color harmony
- Maximum 1-2 shared pieces across all outfits to ensure uniqueness
- Strategic layering that considers both aesthetics and functionality
- Accessories chosen to elevate rather than overwhelm the overall composition

OCCASION-SPECIFIC EXPERTISE for "${occasion}":
- Business: Sharp silhouettes, refined color palettes, investment pieces that command respect
- Casual: Effortless sophistication with unexpected details that show personal style
- Formal: Timeless elegance with contemporary touches that feel fresh and current
- Date Night: Alluring confidence through flattering cuts and rich textures

PROFESSIONAL COLOR COORDINATION:
- Monochromatic schemes for modern sophistication
- Complementary colors that enhance natural skin undertones
- Strategic use of neutral anchors with purposeful color accents
- Seasonal color psychology applied to mood and occasion
- If occasion is "business": prioritize professional items like blazers, dress shirts, dress pants, formal shoes
- If occasion is "formal": focus on suits, dresses, formal shoes, elegant pieces
- If occasion is "casual": emphasize comfortable, relaxed pieces like jeans, t-shirts, sneakers
- VERSATILITY IS KEY: Recognize that most items can work for multiple occasions:
  * Blazers: casual with jeans/chinos, business with dress pants, smart-casual with anything
  * Dress shoes/loafers: casual with chinos, business with suits, smart-casual with dark jeans
  * Button-down shirts: casual untucked with jeans, business tucked with trousers
  * Suits: formal as complete sets, casual when pieces are mixed separately
  * Jackets: business appropriate AND casual depending on styling
  * Quality shoes: work for both professional and casual settings
- Show how the SAME VERSATILE ITEM can work across different occasions
- Style mixing is encouraged - business pieces can be styled casually and vice versa
- Avoid repeating exact item combinations
- Consider user's body type and preferences
- Color Coordination: Ensure outfit colors complement each other based on color theory
- Weather Appropriateness: Consider temperature, precipitation, and time of year
- Occasion Matching: Strictly match the suggested outfits to the requested occasion
OUTFIT REQUIREMENTS:
- Each outfit must have either: (top + bottom) OR (dress) OR (outerwear + other items)
- Only one bottom piece per outfit (pants, skirt, or dress)
- Colors should complement user's skin tone and preferences
- Weather-appropriate warmth level and fabric choices
- Confidence score based on weather suitability and style match
- CRITICAL: ALL outfits MUST match the requested occasion: "${occasion}"
- Filter items by their suitability for the requested occasion

WEATHER-AWARE LAYERING RULES:
- Temperature < 10°C: MUST include outerwear (jacket/coat/blazer) + base layers
- Temperature 10-20°C: Suggest light outerwear or layering options
- Temperature > 20°C: Light clothing, breathable fabrics
- Cold weather outfits should have 3-4 pieces: base layer + mid layer + outerwear + bottoms
- Consider indoor comfort: suggest outfits that work when jacket is removed indoors
- For business in cold weather: blazer/suit jacket + shirt + outerwear for outside
- For casual in cold weather: sweater/hoodie + jacket + base layer

MULTI-OCCASION STYLING: Show how items can work across occasions:
  * Blazers: casual with jeans, business with dress pants
  * Loafers/dress shoes: casual with chinos, business with suits
  * Button-down shirts: casual untucked, business tucked in
  * Suits: formal for business, casual when mixed with other pieces

CONFIDENCE SCORING:
- 90-100: Perfect weather match, ideal style, great color harmony
- 80-89: Good weather match, suitable style, good colors
- 70-79: Adequate weather match, acceptable style
- Below 70: Poor weather match or style compatibility

Create 3-5 EXPERTLY CURATED outfit combinations in this JSON format:
{
  "outfits": [
    {
      "name": "sophisticated style name that captures the essence",
      "occasion": "${occasion}",
      "item_ids": [1, 2, 3, 4],
      "confidence": 95,
      "description": "Expert analysis of why this combination works: color theory, silhouette balance, and seasonal appropriateness explained with fashion authority",
      "styling_tips": "Professional styling advice with specific techniques for perfecting the look - how to wear it, adjust proportions, and transition between settings",
      "weather": "optimal conditions for this styled look",
      "temperature_range": "15-22°C",
      "season_suitability": "spring"
    }
  ]
}

SPECIAL COLD WEATHER INSTRUCTIONS (Temperature < 15°C):
- ALWAYS include outerwear (jackets, blazers, coats) in cold weather outfits
- Create 3-4 piece outfits: base layer + middle layer + outerwear + bottoms
- Mention in styling_tips how the outfit works when jacket is removed indoors
- For business: shirt + blazer/suit jacket + optional coat for outside
- For casual: t-shirt/shirt + sweater/hoodie + jacket + pants
- Prioritize items that work well in layers

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
          
          // Enhanced validation with weather-based confidence adjustments
          const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
          
          // Weather-based confidence adjustments with layering logic
          if (weatherData) {
            const temp = weatherData.temperature;
            const condition = weatherData.condition.toLowerCase();
            
            // Enhanced layering requirements for cold weather
            if (temp < 10) {
              const hasOuterwear = selectedItems.some(item => 
                item.category === 'outerwear' || 
                (item.category === 'tops' && (item.style === 'business' || item.aiAnalysis?.includes('blazer')))
              );
              
              if (!hasOuterwear) {
                outfit.confidence = Math.max(40, (outfit.confidence || 80) - 30);
                outfit.styling_tips = (outfit.styling_tips || '') + ' Add a jacket or coat for cold weather protection.';
              } else {
                outfit.confidence = Math.min(100, (outfit.confidence || 80) + 10);
                outfit.styling_tips = (outfit.styling_tips || '') + ' Perfect layering for cold weather - remove outer layer when indoors.';
              }
            }
            
            // Check if items are weather-appropriate
            const weatherAppropriate = selectedItems.every(item => {
              if (!item.weatherSuitability) return true;
              
              // Temperature appropriateness with enhanced logic
              if (temp < 5 && item.warmthLevel && item.warmthLevel < 2) return false;
              if (temp > 25 && item.warmthLevel && item.warmthLevel > 2) return false;
              
              // Condition appropriateness
              if (condition === 'rainy' && !item.weatherSuitability.includes('rain')) return false;
              
              return true;
            });
            
            if (!weatherAppropriate) {
              outfit.confidence = Math.max(50, (outfit.confidence || 80) - 20);
            } else {
              outfit.confidence = Math.min(100, (outfit.confidence || 80) + 5);
            }
          }
          
          // User personalization adjustments
          if (userContext?.preferences) {
            const preferences = userContext.preferences;
            const outfitColors = selectedItems.flatMap(item => item.colors);
            
            // Boost confidence for preferred colors
            if (preferences.favoriteColors?.some((color: string) => 
              outfitColors.some(outfitColor => outfitColor.toLowerCase().includes(color.toLowerCase())))) {
              outfit.confidence = Math.min(100, (outfit.confidence || 80) + 5);
            }
            
            // Reduce confidence for avoided colors
            if (preferences.avoidColors?.some((color: string) => 
              outfitColors.some(outfitColor => outfitColor.toLowerCase().includes(color.toLowerCase())))) {
              outfit.confidence = Math.max(60, (outfit.confidence || 80) - 10);
            }
          }
          
          return outfit;
        })
        .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5); // Limit to top 5 outfits
      
      console.log(`Professional Fashion Styling: Filtered ${outfits.length} outfits down to ${validOutfits.length} expert-validated combinations`);
      console.log(`Duplicate prevention: ${previousSuggestions.size} combinations tracked for user ${userId}`);
      
      // Generate shopping recommendations for low-confidence outfits
      await generateShoppingRecommendations(userId, validOutfits, userItems, weatherData);
      
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

// Auto-process untagged items on startup
async function processUntaggedItemsOnStartup() {
  try {
    console.log("Checking for untagged items on startup...");
    const allItems = await storage.getClothingItems(1);
    const untaggedItems = allItems.filter(item => 
      !item.isVerified || 
      !item.aiAnalysis || 
      item.category === 'unprocessed' ||
      item.style === 'pending' ||
      !item.colors?.length
    );

    if (untaggedItems.length > 0) {
      console.log(`Found ${untaggedItems.length} untagged items, processing...`);
      
      for (const item of untaggedItems) {
        try {
          if (item.imageUrl && fs.existsSync(path.join(process.cwd(), item.imageUrl.replace('/', '')))) {
            const imagePath = path.join(process.cwd(), item.imageUrl.replace('/', ''));
            const analysis = await analyzeClothingImage(imagePath);
            
            if (analysis) {
              await storage.updateClothingItem(item.id, {
                category: analysis.category || "other",
                subcategory: analysis.subcategory || null,
                style: analysis.style || "casual",
                colors: analysis.colors || [],
                dominantColor: analysis.dominant_color || null,
                accentColors: analysis.accent_colors || null,
                fabricType: analysis.fabric_type || null,
                genderStyle: analysis.gender_style || null,
                timeOfDay: analysis.time_of_day || null,
                occasionSuitability: analysis.suitable_occasions || null,
                aiAnalysis: JSON.stringify(analysis),
                isVerified: true
              });
              console.log(`Processed untagged item: ${item.name}`);
            }
          }
        } catch (error: any) {
          console.log(`Failed to process item ${item.id} on startup:`, error?.message || 'Unknown error');
        }
      }
    } else {
      console.log("No untagged items found on startup");
    }
  } catch (error: any) {
    console.log("Startup processing failed:", error?.message || 'Unknown error');
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Mock user ID for demo purposes (in real app, would use authentication)
  const DEMO_USER_ID = 1;

  // Process untagged items on startup
  setTimeout(processUntaggedItemsOnStartup, 5000); // Delay to ensure server is ready

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

  // AI analysis endpoint for untagged items
  app.post("/api/clothing-items/analyze-untagged", async (req, res) => {
    try {
      // Get all untagged/unverified items for the user
      const allItems = await storage.getClothingItems(DEMO_USER_ID);
      const untaggedItems = allItems.filter(item => 
        !item.isVerified || 
        !item.aiAnalysis || 
        !item.colors?.length || 
        !item.style ||
        !item.subcategory
      );

      if (untaggedItems.length === 0) {
        return res.json({ 
          message: "All items are already analyzed and tagged",
          processedCount: 0 
        });
      }

      let processedCount = 0;
      const results = [];

      for (const item of untaggedItems) {
        try {
          // Only analyze if image exists
          if (item.imageUrl && fs.existsSync(path.join(process.cwd(), item.imageUrl.replace('/', '')))) {
            const imagePath = path.join(process.cwd(), item.imageUrl.replace('/', ''));
            const analysis = await analyzeClothingImage(imagePath);
            
            if (analysis) {
              // Update item with AI analysis results
              const updatedItem = await storage.updateClothingItem(item.id, {
                subcategory: analysis.subcategory || null,
                style: analysis.style || "casual",
                colors: analysis.colors || [],
                dominantColor: analysis.dominant_color || null,
                accentColors: analysis.accent_colors || null,
                fabricType: analysis.fabric_type || null,
                genderStyle: analysis.gender_style || null,
                timeOfDay: analysis.time_of_day || null,
                occasionSuitability: analysis.suitable_occasions || null,
                weatherSuitability: analysis.weather_suitability || null,
                warmthLevel: analysis.formality === "formal" ? 2 : 
                           analysis.formality === "business" ? 3 : 
                           analysis.formality === "casual" ? 1 : 2,
                aiAnalysis: JSON.stringify(analysis),
                isVerified: true
              });

              if (updatedItem) {
                processedCount++;
                results.push({
                  id: item.id,
                  name: item.name,
                  category: analysis.category || item.category,
                  subcategory: analysis.subcategory,
                  style: analysis.style,
                  colors: analysis.colors,
                  useCase: analysis.formality,
                  stylingTips: analysis.styling_tips
                });
              }
            }
          }
        } catch (error) {
          console.error(`Failed to analyze item ${item.id}:`, error);
        }
      }

      res.json({
        message: `Successfully analyzed and tagged ${processedCount} items`,
        processedCount,
        results
      });

    } catch (error) {
      console.error("Failed to analyze untagged items:", error);
      res.status(500).json({ error: "Failed to analyze untagged items" });
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

      // Get existing items for comprehensive validation
      const existingItems = await storage.getClothingItems(DEMO_USER_ID);

      // STRICT RULE: Enhanced filename validation before any processing
      const fileNameValidation = validateFileName(name, existingItems);
      if (!fileNameValidation.isValid) {
        fs.unlinkSync(req.file.path);
        return res.status(409).json({
          error: "This item has already been uploaded. Duplicate items are not allowed.",
          message: `Upload rejected: ${fileNameValidation.reason}`,
          conflictingItem: fileNameValidation.conflictingItem,
          strictRule: "STRICT RULE APPLIED: Advanced detection prevents bypassing restrictions."
        });
      }

      // STRICT RULE: Additional filename pattern checks
      const originalFileName = req.file.originalname.toLowerCase();
      const uploadedFileName = req.file.filename.toLowerCase();
      
      const suspiciousFilePatterns = [
        /copy\s*of/i, /duplicate\s*of/i, /version\s*\d/i, /\(\d+\)\./i,
        /copy\./i, /duplicate\./i, /_copy\./i, /-copy\./i, /backup\./i
      ];
      
      for (const pattern of suspiciousFilePatterns) {
        if (pattern.test(originalFileName) || pattern.test(uploadedFileName)) {
          fs.unlinkSync(req.file.path);
          return res.status(409).json({
            error: "This item has already been uploaded. Duplicate images are not allowed.",
            message: `File name pattern suggests duplicate attempt: ${originalFileName}`,
            strictRule: "STRICT RULE APPLIED: Suspicious file naming patterns are blocked."
          });
        }
      }
      
      // Clean and normalize names for comparison
      const cleanName = (str: string) => str.toLowerCase().trim()
        .replace(/[-_\s]*(copy|duplicate|\(\d+\)|\s-\scopy).*$/i, '')
        .replace(/\s+/g, ' ');
      
      const normalizedNewName = cleanName(name);
      
      const duplicateName = existingItems.find(item => {
        const normalizedExistingName = cleanName(item.name);
        
        // Exact match after normalization
        if (normalizedExistingName === normalizedNewName) {
          return true;
        }
        
        // Check if one name contains the other (for variations like "jacket" vs "jacket - copy")
        if (normalizedNewName.length > 3 && normalizedExistingName.length > 3) {
          return normalizedExistingName.includes(normalizedNewName) || 
                 normalizedNewName.includes(normalizedExistingName);
        }
        
        return false;
      });
      
      if (duplicateName) {
        // Delete the uploaded file since we're rejecting it
        fs.unlinkSync(req.file.path);
        return res.status(409).json({ 
          error: "This item has already been uploaded. Duplicate items are not allowed.",
          existingItem: duplicateName,
          duplicateType: "name",
          message: `"${name}" is too similar to existing item "${duplicateName.name}". Each item must have a unique name.`,
          strictRule: "STRICT RULE APPLIED: Only one image per item is allowed."
        });
      }

      // STRICT RULE: Advanced content-level duplicate detection
      console.log(`STRICT VALIDATION: Starting comprehensive duplicate check for file: ${req.file.filename}, size: ${req.file.size}B`);
      const duplicateImage = await checkForDuplicateImage(req.file.path, DEMO_USER_ID);
      
      if (duplicateImage) {
        // Delete the uploaded file since we're rejecting it
        fs.unlinkSync(req.file.path);
        console.log(`STRICT DUPLICATE BLOCKED: "${name}" matches existing item "${duplicateImage.name}" (ID: ${duplicateImage.id})`);
        return res.status(409).json({ 
          error: "This item has already been uploaded. Duplicate images are not allowed.",
          existingItem: duplicateImage,
          duplicateType: "image",
          message: `This item already exists in your wardrobe. The uploaded image is identical or very similar to "${duplicateImage.name}" that you already have saved.`,
          strictRule: "STRICT RULE APPLIED: Advanced content-level comparison detected this duplicate. Single image per item enforced.",
          blockReason: "Content-level duplicate detection with hash comparison and similarity analysis"
        });
      }

      // STRICT RULE: Final validation - Check if user already has maximum items (optional limit)
      const MAX_ITEMS_PER_USER = 1000; // Reasonable limit to prevent spam
      if (existingItems.length >= MAX_ITEMS_PER_USER) {
        fs.unlinkSync(req.file.path);
        return res.status(409).json({
          error: "Maximum wardrobe limit reached",
          message: `You have reached the maximum limit of ${MAX_ITEMS_PER_USER} items in your wardrobe.`,
          strictRule: "STRICT RULE APPLIED: Wardrobe size limit enforced."
        });
      }
      
      console.log(`No duplicates found for "${name}" - proceeding with upload`);

      // Try to analyze image with AI, fallback if quota exceeded
      let analysis;
      try {
        console.log("Analyzing image with Gemini AI...");
        analysis = await analyzeClothingImage(req.file.path);
      } catch (error: any) {
        console.log("AI analysis failed, marking item for reprocessing:", error.message);
        // Mark item as unprocessed when AI analysis fails
        analysis = null;
      }
      
      // Create clothing item with proper handling of failed analysis
      const itemData = {
        userId: DEMO_USER_ID,
        name,
        category: analysis?.category || "unprocessed",
        subcategory: analysis?.subcategory || null,
        style: analysis?.style || "pending",
        colors: analysis?.colors || [],
        dominantColor: analysis?.dominant_color || null,
        accentColors: analysis?.accent_colors || null,
        imageUrl: `/uploads/${req.file.filename}`,
        aiAnalysis: analysis ? JSON.stringify(analysis) : null,
        isVerified: !!analysis,
        warmthLevel: null,
        weatherSuitability: null,
        fabricType: analysis?.fabric_type || null,
        genderStyle: analysis?.gender_style || null,
        timeOfDay: analysis?.time_of_day || null,
        occasionSuitability: analysis?.suitable_occasions || null
      };

      console.log("Item data before validation:", itemData);
      const validatedData = insertClothingItemSchema.parse(itemData);
      const item = await storage.createClothingItem(validatedData);

      // If AI analysis failed, automatically trigger reprocessing
      if (!analysis) {
        console.log(`Item ${item.id} marked for reprocessing - will retry AI analysis`);
        // Schedule immediate retry in the background
        setImmediate(async () => {
          try {
            console.log(`Retrying AI analysis for item ${item.id}...`);
            const retryAnalysis = await analyzeClothingImage(req.file!.path);
            if (retryAnalysis) {
              await storage.updateClothingItem(item.id, {
                category: retryAnalysis.category || "other",
                subcategory: retryAnalysis.subcategory || null,
                style: retryAnalysis.style || "casual",
                colors: retryAnalysis.colors || [],
                dominantColor: retryAnalysis.dominant_color || null,
                accentColors: retryAnalysis.accent_colors || null,
                fabricType: retryAnalysis.fabric_type || null,
                genderStyle: retryAnalysis.gender_style || null,
                timeOfDay: retryAnalysis.time_of_day || null,
                occasionSuitability: retryAnalysis.suitable_occasions || null,
                aiAnalysis: JSON.stringify(retryAnalysis),
                isVerified: true
              });
              console.log(`Successfully reprocessed item ${item.id}`);
            }
          } catch (retryError: any) {
            console.log(`Retry failed for item ${item.id}:`, retryError.message);
          }
        });
      }

      res.json(item);
    } catch (error) {
      console.error("Failed to create clothing item:", error);
      res.status(500).json({ error: "Failed to analyze and save clothing item" });
    }
  });

  // Serve placeholder images for sample items
  app.get('/sample-*.jpg', (req, res) => {
    const filename = req.path.slice(1); // Remove leading slash
    const itemName = filename.replace('sample-', '').replace('.jpg', '');
    
    // Generate SVG placeholder based on item type
    const colorMap: Record<string, string> = {
      'tshirt': '#3B82F6',
      'jeans': '#1E40AF', 
      'shirt': '#1F2937',
      'chinos': '#D97706',
      'dress': '#EC4899',
      'blouse': '#F472B6',
      'trousers': '#111827',
      'belt': '#92400E',
      'pumps': '#000000',
      'sneakers': '#FFFFFF',
      'skirt': '#6B7280',
      'cardigan': '#7C2D12'
    };
    
    const color = colorMap[itemName] || '#6B7280';
    const strokeColor = color === '#FFFFFF' ? '#000000' : '#FFFFFF';
    
    const svg = `
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="${color}"/>
        <rect x="50" y="50" width="100" height="100" fill="none" stroke="${strokeColor}" stroke-width="2" opacity="0.7"/>
        <text x="100" y="170" text-anchor="middle" fill="${strokeColor}" font-size="14" font-family="Arial, sans-serif" opacity="0.8">
          ${itemName.charAt(0).toUpperCase() + itemName.slice(1)}
        </text>
      </svg>
    `;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  });

  // Serve uploaded images with proper headers
  app.use('/uploads', (req, res, next) => {
    const fileName = req.path.slice(1); // Remove leading slash
    const filePath = path.join(uploadDir, fileName);
    
    if (fs.existsSync(filePath)) {
      // Set proper content type for images
      const ext = path.extname(fileName).toLowerCase();
      const contentType = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      }[ext] || 'image/jpeg';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.sendFile(filePath);
    } else {
      console.error(`Image not found: ${filePath}`);
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

  // Delete all clothing items for user
  app.delete("/api/clothing-items", async (req, res) => {
    try {
      const items = await storage.getClothingItems(DEMO_USER_ID);
      
      // Delete all image files
      for (const item of items) {
        const imagePath = path.join(process.cwd(), item.imageUrl);
        if (fs.existsSync(imagePath)) {
          try {
            fs.unlinkSync(imagePath);
          } catch (error) {
            console.log(`Could not delete image file: ${imagePath}`);
          }
        }
      }

      const deleted = await storage.deleteAllClothingItems(DEMO_USER_ID);
      if (deleted) {
        res.json({ success: true, deletedCount: items.length });
      } else {
        res.status(500).json({ error: "Failed to delete all items" });
      }
    } catch (error) {
      console.error("Failed to delete all clothing items:", error);
      res.status(500).json({ error: "Failed to delete all clothing items" });
    }
  });

  // Get weather-based outfit suggestions with automatic location detection
  app.get("/api/outfits/suggestions", async (req, res) => {
    try {
      const { occasion } = req.query;
      
      // Automatically detect user location
      const location = await detectUserLocation(req);
      
      // Fetch current weather data
      const weatherData = await fetchWeatherData(location);
      
      // Get user profile for personalization
      const userProfile = await storage.getUser(DEMO_USER_ID);
      
      // Try advanced Gemini 2.0 suggestions first, fallback to basic if needed
      const suggestions = await generateAdvancedOutfitSuggestions(
        DEMO_USER_ID, 
        occasion as string, 
        weatherData || undefined,
        userProfile || undefined
      );
      
      // Return suggestions directly for backward compatibility
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

  // Save outfit with weather context
  app.post("/api/outfits", async (req, res) => {
    try {
      const location = await detectUserLocation(req);
      const weatherData = await fetchWeatherData(location);
      
      const outfitData = {
        ...req.body,
        userId: DEMO_USER_ID,
        isSaved: true,
        weatherConditions: weatherData ? JSON.stringify({
          temperature: weatherData.temperature,
          condition: weatherData.condition,
          location: weatherData.location
        }) : null,
        temperature: weatherData?.temperature || null,
        seasonality: weatherData ? getSeasonFromTemperature(weatherData.temperature) : null,
        timeOfDay: getTimeOfDay()
      };

      const validatedData = insertOutfitSchema.parse(outfitData);
      const outfit = await storage.createOutfit(validatedData);
      res.json(outfit);
    } catch (error) {
      console.error("Failed to save outfit:", error);
      res.status(500).json({ error: "Failed to save outfit" });
    }
  });

  // User profile management
  app.get("/api/user/profile", async (req, res) => {
    try {
      const user = await storage.getUser(DEMO_USER_ID);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Parse preferences before sending response
      let parsedPreferences = null;
      if (user.preferences) {
        try {
          if (typeof user.preferences === 'string' && user.preferences.trim()) {
            parsedPreferences = JSON.parse(user.preferences);
          } else if (typeof user.preferences === 'object' && user.preferences !== null) {
            parsedPreferences = user.preferences;
          }
        } catch (e) {
          console.error("Error parsing preferences:", e);
          parsedPreferences = null;
        }
      }
      
      const profile = {
        bodyType: user.bodyType || "",
        skinTone: user.skinTone || "",
        age: user.age || null,
        height: user.height || null,
        gender: user.gender || "",
        location: user.location || "",
        preferences: parsedPreferences
      };
      
      res.json(profile);
    } catch (error) {
      console.error("Failed to get user profile:", error);
      res.status(500).json({ error: "Failed to get user profile" });
    }
  });

  app.put("/api/user/profile", async (req, res) => {
    try {
      const profileData = updateUserProfileSchema.parse(req.body);
      
      // If preferences are provided as an object, stringify them
      if (profileData.preferences && typeof profileData.preferences === 'object') {
        profileData.preferences = JSON.stringify(profileData.preferences);
      }
      
      const updatedUser = await storage.updateUserProfile(DEMO_USER_ID, profileData);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Parse preferences before sending response
      let parsedPreferences = null;
      if (updatedUser.preferences) {
        try {
          parsedPreferences = typeof updatedUser.preferences === 'string' 
            ? JSON.parse(updatedUser.preferences) 
            : updatedUser.preferences;
        } catch (e) {
          console.error("Error parsing preferences in response:", e);
          parsedPreferences = null;
        }
      }
      
      res.json({
        bodyType: updatedUser.bodyType,
        skinTone: updatedUser.skinTone,
        age: updatedUser.age,
        height: updatedUser.height,
        gender: updatedUser.gender,
        location: updatedUser.location,
        preferences: parsedPreferences
      });
    } catch (error) {
      console.error("Failed to update user profile:", error);
      res.status(500).json({ error: "Failed to update user profile" });
    }
  });

  // Weather data API
  app.get("/api/weather", async (req, res) => {
    try {
      const { location: queryLocation } = req.query;
      const location = queryLocation as string || await detectUserLocation(req);
      
      const weatherData = await fetchWeatherData(location);
      
      if (!weatherData) {
        return res.status(404).json({ error: "Weather data not available" });
      }
      
      res.json({
        ...weatherData,
        season: getSeasonFromTemperature(weatherData.temperature),
        timeOfDay: getTimeOfDay()
      });
    } catch (error) {
      console.error("Failed to get weather data:", error);
      res.status(500).json({ error: "Failed to get weather data" });
    }
  });

  // Shopping recommendations API
  app.get("/api/shopping/recommendations", async (req, res) => {
    try {
      const recommendations = await storage.getShoppingRecommendations(DEMO_USER_ID);
      res.json(recommendations);
    } catch (error) {
      console.error("Failed to get shopping recommendations:", error);
      res.status(500).json({ error: "Failed to get shopping recommendations" });
    }
  });

  app.delete("/api/shopping/recommendations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteShoppingRecommendation(id);
      
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Recommendation not found" });
      }
    } catch (error) {
      console.error("Failed to delete shopping recommendation:", error);
      res.status(500).json({ error: "Failed to delete shopping recommendation" });
    }
  });

  // Manual shopping recommendation trigger
  app.post("/api/shopping/analyze", async (req, res) => {
    try {
      const userItems = await storage.getClothingItems(DEMO_USER_ID);
      const location = await detectUserLocation(req);
      const weatherData = await fetchWeatherData(location);
      
      // Create mock outfits to analyze gaps
      const mockOutfits = [{ confidence: 65, item_ids: [] }]; // Trigger recommendations
      
      await generateShoppingRecommendations(DEMO_USER_ID, mockOutfits, userItems, weatherData || undefined);
      
      const recommendations = await storage.getShoppingRecommendations(DEMO_USER_ID);
      res.json(recommendations);
    } catch (error) {
      console.error("Failed to analyze shopping needs:", error);
      res.status(500).json({ error: "Failed to analyze shopping needs" });
    }
  });

  // User profile endpoints
  app.get("/api/user/profile", async (req, res) => {
    try {
      const user = await storage.getUser(DEMO_USER_ID);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Failed to get user profile:", error);
      res.status(500).json({ error: "Failed to get user profile" });
    }
  });

  app.put("/api/user/profile", async (req, res) => {
    try {
      const validatedData = updateUserProfileSchema.parse(req.body);
      const updatedUser = await storage.updateUserProfile(DEMO_USER_ID, validatedData);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Failed to update user profile:", error);
      res.status(500).json({ error: "Failed to update user profile" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
