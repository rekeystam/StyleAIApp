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

// Weather API helper functions
async function fetchWeatherData(location: string): Promise<WeatherData | null> {
  try {
    // Check if we have cached weather data
    const cached = await storage.getWeatherData(location);
    if (cached && cached.timestamp && (Date.now() - cached.timestamp.getTime()) < 3600000) {
      return cached; // Return cached data if less than 1 hour old
    }

    // For demo purposes, generate realistic weather data based on location
    // In production, this would use a real weather API like OpenWeatherMap
    const weatherConditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
    const baseTemp = location.toLowerCase().includes('new york') ? 15 : 20;
    const temp = baseTemp + Math.floor(Math.random() * 20) - 10;
    
    const weatherData = await storage.createWeatherData({
      location,
      temperature: temp,
      condition: weatherConditions[Math.floor(Math.random() * weatherConditions.length)],
      humidity: 40 + Math.floor(Math.random() * 40),
      windSpeed: Math.floor(Math.random() * 25)
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
        throw new Error("GOOGLE_API_KEY environment variable is not set");
      }
      genAI = new GoogleGenerativeAI(apiKey);
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    
    const prompt = `Analyze this clothing item image and identify the SINGLE MOST PROMINENT item. If multiple items are visible, focus on the main/central piece. Provide analysis in this exact JSON format:

{
  "category": "tops",
  "style": "formal",
  "colors": ["beige", "tan"],
  "fabric_type": "wool",
  "pattern": "solid",
  "formality": "formal",
  "suitable_occasions": ["business", "formal"],
  "versatility_notes": "Can be styled for business meetings or formal events",
  "season": "all_season",
  "fit": "regular",
  "description": "Business blazer in neutral tone",
  "styling_tips": "Pair with dress pants and shirt for professional look",
  "body_type_recommendations": "Flattering for most body types"
}

CRITICAL RULES:
- category: MUST be ONE of: tops, bottoms, dresses, outerwear, accessories, shoes
- style: MUST be ONE of: casual, formal, business, sporty, bohemian, vintage, modern
- formality: MUST be ONE of: very_casual, casual, smart_casual, business_casual, formal, very_formal
- season: MUST be ONE of: spring, summer, fall, winter, all_season
- fit: MUST be ONE of: loose, regular, slim, tight
- fabric_type: MUST be ONE of: cotton, denim, silk, wool, polyester, leather, other

FORMALITY CLASSIFICATION:
- Blazers, suits, sport coats = style: "formal", formality: "formal"
- Dress shirts = style: "business", formality: "business_casual"  
- Ties, dress shoes = style: "formal", formality: "formal"
- T-shirts, hoodies = style: "casual", formality: "casual"

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
      
      // Normalize arrays to single values (take first element)
      const normalized = {
        category: Array.isArray(parsed.category) ? parsed.category[0] : parsed.category,
        style: Array.isArray(parsed.style) ? parsed.style[0] : parsed.style,
        colors: Array.isArray(parsed.colors) ? (Array.isArray(parsed.colors[0]) ? parsed.colors[0] : parsed.colors) : [parsed.colors],
        fabric_type: Array.isArray(parsed.fabric_type) ? parsed.fabric_type[0] : parsed.fabric_type,
        pattern: Array.isArray(parsed.pattern) ? parsed.pattern[0] : parsed.pattern,
        formality: Array.isArray(parsed.formality) ? parsed.formality[0] : parsed.formality,
        suitable_occasions: Array.isArray(parsed.suitable_occasions) ? parsed.suitable_occasions : [parsed.suitable_occasions],
        versatility_notes: parsed.versatility_notes,
        season: Array.isArray(parsed.season) ? parsed.season[0] : parsed.season,
        fit: Array.isArray(parsed.fit) ? parsed.fit[0] : parsed.fit,
        description: parsed.description,
        styling_tips: parsed.styling_tips,
        body_type_recommendations: parsed.body_type_recommendations
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
  } catch (error) {
    console.error("AI analysis failed:", error);
    throw new Error("Failed to analyze image with AI");
  }
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

    // Filter items by occasion suitability first
    const occasionFilteredItems = userItems.filter(item => {
      const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};
      const itemStyle = item.style?.toLowerCase() || 'casual';
      const itemCategory = item.category?.toLowerCase() || '';
      const itemName = item.name?.toLowerCase() || '';
      
      if (!occasion || occasion === 'casual') {
        // Casual: allow most items, exclude very formal pieces
        return !itemName.includes('suit') || !itemName.includes('tuxedo');
      }
      
      if (occasion === 'business' || occasion === 'business_casual') {
        // Business: prioritize professional items
        const businessItems = [
          'business', 'formal', 'professional', 'smart', 'dress',
          'blazer', 'suit', 'shirt', 'trousers', 'chinos', 'pumps', 'loafers'
        ];
        
        const isBusinessSuitable = businessItems.some(keyword => 
          itemStyle.includes(keyword) || itemCategory.includes(keyword) || itemName.includes(keyword)
        );
        
        // Also include versatile casual items that can be dressed up
        const versatileCasual = itemCategory === 'tops' && !itemName.includes('t-shirt') ||
                               itemCategory === 'bottoms' && (itemName.includes('chinos') || itemName.includes('trousers')) ||
                               itemCategory === 'shoes' && !itemName.includes('sneakers');
        
        return isBusinessSuitable || versatileCasual;
      }
      
      if (occasion === 'formal') {
        // Formal: only dress up items
        const formalItems = ['formal', 'dress', 'suit', 'blazer', 'pumps', 'heels', 'tie', 'elegant'];
        return formalItems.some(keyword => 
          itemStyle.includes(keyword) || itemCategory.includes(keyword) || itemName.includes(keyword)
        );
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

    const prompt = `You are an expert AI Fashion Stylist creating personalized, weather-appropriate outfit combinations.

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

STYLING GUIDELINES:
- Create 4 different outfit combinations using available items
- Each outfit can include up to six items, such as socks, accessories, hats, watches, ties, and sunglasses, if they are shown in the attached image and depend on the occasion
- Focus on practical, weather-appropriate combinations
- STRICTLY MATCH THE REQUESTED OCCASION: "${occasion}"
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
- MULTI-OCCASION STYLING: Show how items can work across occasions:
  * Blazers: casual with jeans, business with dress pants
  * Loafers/dress shoes: casual with chinos, business with suits
  * Button-down shirts: casual untucked, business tucked in
  * Suits: formal for business, casual when mixed with other pieces

CONFIDENCE SCORING:
- 90-100: Perfect weather match, ideal style, great color harmony
- 80-89: Good weather match, suitable style, good colors
- 70-79: Adequate weather match, acceptable style
- Below 70: Poor weather match or style compatibility

Generate 5-6 COMPLETELY NEW outfit combinations in this JSON format:
{
  "outfits": [
    {
      "name": "unique descriptive name",
      "occasion": "${occasion}",
      "item_ids": [1, 2, 3],
      "confidence": 85,
      "description": "explain weather appropriateness, color harmony, and style compatibility",
      "styling_tips": "specific advice for the user's body type and preferences",
      "weather": "specific weather conditions this outfit suits",
      "temperature_range": "5-15°C",
      "season_suitability": "fall/winter"
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
          
          // Enhanced validation with weather-based confidence adjustments
          const selectedItems = userItems.filter(item => outfit.item_ids.includes(item.id));
          
          // Weather-based confidence adjustments
          if (weatherData) {
            const temp = weatherData.temperature;
            const condition = weatherData.condition.toLowerCase();
            
            // Check if items are weather-appropriate
            const weatherAppropriate = selectedItems.every(item => {
              if (!item.weatherSuitability) return true;
              
              // Temperature appropriateness
              if (temp < 5 && item.warmthLevel && item.warmthLevel < 3) return false;
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
      
      // Create clothing item with normalized data
      const itemData = {
        userId: DEMO_USER_ID,
        name,
        category: analysis.category || "other",
        style: analysis.style || "casual",
        colors: analysis.colors || ["unknown"],
        imageUrl: `/uploads/${req.file.filename}`,
        aiAnalysis: JSON.stringify(analysis),
      };

      console.log("Item data before validation:", itemData);
      const validatedData = insertClothingItemSchema.parse(itemData);
      const item = await storage.createClothingItem(validatedData);

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
      
      const suggestions = await generateOutfitSuggestions(
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
      
      const profile = {
        bodyType: user.bodyType,
        skinTone: user.skinTone,
        age: user.age,
        height: user.height,
        gender: user.gender,
        location: user.location,
        preferences: user.preferences ? JSON.parse(user.preferences) : null
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
      
      res.json({
        bodyType: updatedUser.bodyType,
        skinTone: updatedUser.skinTone,
        age: updatedUser.age,
        height: updatedUser.height,
        gender: updatedUser.gender,
        location: updatedUser.location,
        preferences: updatedUser.preferences ? JSON.parse(updatedUser.preferences) : null
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
