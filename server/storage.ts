import {
  type User, type InsertUser, type UpdateUserProfile,
  type ClothingItem, type InsertClothingItem,
  type Outfit, type InsertOutfit,
  type WeatherData, type InsertWeatherData,
  type ShoppingRecommendation, type InsertShoppingRecommendation
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserProfile(id: number, profile: UpdateUserProfile): Promise<User | undefined>;

  getClothingItems(userId: number): Promise<ClothingItem[]>;
  getClothingItem(id: number): Promise<ClothingItem | undefined>;
  createClothingItem(item: InsertClothingItem): Promise<ClothingItem>;
  updateClothingItem(id: number, updates: Partial<ClothingItem>): Promise<ClothingItem | undefined>;
  deleteClothingItem(id: number): Promise<boolean>;
  deleteAllClothingItems(userId: number): Promise<boolean>;

  getOutfits(userId: number): Promise<Outfit[]>;
  createOutfit(outfit: InsertOutfit): Promise<Outfit>;
  updateOutfit(id: number, updates: Partial<Outfit>): Promise<Outfit | undefined>;
  deleteOutfit(id: number): Promise<boolean>;

  getWeatherData(location: string): Promise<WeatherData | undefined>;
  createWeatherData(weather: InsertWeatherData): Promise<WeatherData>;

  getShoppingRecommendations(userId: number): Promise<ShoppingRecommendation[]>;
  createShoppingRecommendation(recommendation: InsertShoppingRecommendation): Promise<ShoppingRecommendation>;
  deleteShoppingRecommendation(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private clothingItems: Map<number, ClothingItem>;
  private outfits: Map<number, Outfit>;
  private weatherData: Map<string, WeatherData>;
  private shoppingRecommendations: Map<number, ShoppingRecommendation>;
  private currentUserId: number;
  private currentClothingItemId: number;
  private currentOutfitId: number;
  private currentWeatherDataId: number;
  private currentShoppingRecommendationId: number;

  constructor() {
    this.users = new Map();
    this.clothingItems = new Map();
    this.outfits = new Map();
    this.weatherData = new Map();
    this.shoppingRecommendations = new Map();
    this.currentUserId = 1;
    this.currentClothingItemId = 1;
    this.currentOutfitId = 1;
    this.currentWeatherDataId = 1;
    this.currentShoppingRecommendationId = 1;

    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Initialize sample data in memory storage

    // Create sample user with personalization data
    const sampleUser: User = {
      id: 1,
      username: "demo",
      password: "demo",
      bodyType: "hourglass",
      skinTone: "warm",
      age: 28,
      height: 165,
      gender: "female",
      location: "New York, NY",
      preferences: JSON.stringify({
        favoriteColors: ["navy", "white", "black"],
        preferredStyles: ["casual", "business_casual"],
        avoidColors: ["orange"]
      })
    };
    this.users.set(1, sampleUser);

    // No sample items loaded automatically - users start with an empty wardrobe
    // Add sample weather data
    const sampleWeather: WeatherData = {
      id: 1,
      location: "New York, NY",
      temperature: 22,
      condition: "sunny",
      humidity: 55,
      windSpeed: 10,
      timestamp: new Date()
    };
    this.weatherData.set("New York, NY", sampleWeather);
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    for (const user of Array.from(this.users.values())) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = {
      ...insertUser,
      id,
      bodyType: null,
      skinTone: null,
      age: null,
      height: null,
      gender: null,
      location: null,
      preferences: null
    };
    this.users.set(id, user);
    return user;
  }

  async updateUserProfile(id: number, profile: UpdateUserProfile): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updatedUser = { ...user, ...profile };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async getClothingItems(userId: number): Promise<ClothingItem[]> {
    return Array.from(this.clothingItems.values()).filter(item => item.userId === userId);
  }

  async getClothingItem(id: number): Promise<ClothingItem | undefined> {
    return this.clothingItems.get(id);
  }

  async createClothingItem(insertItem: InsertClothingItem): Promise<ClothingItem> {
    const id = this.currentClothingItemId++;
    const item: ClothingItem = {
      ...insertItem,
      id,
      subcategory: insertItem.subcategory ?? null,
      isVerified: false,
      aiAnalysis: null,
      warmthLevel: insertItem.warmthLevel ?? null,
      weatherSuitability: insertItem.weatherSuitability ?? null,
      fabricType: insertItem.fabricType ?? null,
      genderStyle: insertItem.genderStyle ?? null,
      timeOfDay: insertItem.timeOfDay ?? null,
      occasionSuitability: insertItem.occasionSuitability ?? null
    };
    this.clothingItems.set(id, item);
    return item;
  }

  async updateClothingItem(id: number, updates: Partial<ClothingItem>): Promise<ClothingItem | undefined> {
    const item = this.clothingItems.get(id);
    if (!item) return undefined;

    const updatedItem = { ...item, ...updates };
    this.clothingItems.set(id, updatedItem);
    return updatedItem;
  }

  async deleteClothingItem(id: number): Promise<boolean> {
    return this.clothingItems.delete(id);
  }

  async deleteAllClothingItems(userId: number): Promise<boolean> {
    let deletedCount = 0;
    this.clothingItems.forEach((item, id) => {
      if (item.userId === userId) {
        this.clothingItems.delete(id);
        deletedCount++;
      }
    });
    return deletedCount > 0;
  }

  async getOutfits(userId: number): Promise<Outfit[]> {
    return Array.from(this.outfits.values()).filter(outfit => outfit.userId === userId);
  }

  async createOutfit(insertOutfit: InsertOutfit): Promise<Outfit> {
    const id = this.currentOutfitId++;
    const outfit: Outfit = {
      ...insertOutfit,
      id,
      isSaved: false,
      occasion: null,
      aiConfidence: null,
      weatherConditions: insertOutfit.weatherConditions ?? null,
      temperature: insertOutfit.temperature ?? null,
      seasonality: insertOutfit.seasonality ?? null,
      timeOfDay: insertOutfit.timeOfDay ?? null
    };
    this.outfits.set(id, outfit);
    return outfit;
  }

  async updateOutfit(id: number, updates: Partial<Outfit>): Promise<Outfit | undefined> {
    const outfit = this.outfits.get(id);
    if (!outfit) return undefined;

    const updatedOutfit = { ...outfit, ...updates };
    this.outfits.set(id, updatedOutfit);
    return updatedOutfit;
  }

  async deleteOutfit(id: number): Promise<boolean> {
    return this.outfits.delete(id);
  }

  async getWeatherData(location: string): Promise<WeatherData | undefined> {
    return this.weatherData.get(location);
  }

  async createWeatherData(weather: InsertWeatherData): Promise<WeatherData> {
    const id = this.currentWeatherDataId++;
    const data: WeatherData = {
      ...weather,
      id,
      timestamp: new Date()
    };
    this.weatherData.set(weather.location, data);
    return data;
  }

  async getShoppingRecommendations(userId: number): Promise<ShoppingRecommendation[]> {
    return Array.from(this.shoppingRecommendations.values()).filter(rec => rec.userId === userId);
  }

  async createShoppingRecommendation(recommendation: InsertShoppingRecommendation): Promise<ShoppingRecommendation> {
    const id = this.currentShoppingRecommendationId++;
    const rec: ShoppingRecommendation = {
      ...recommendation,
      id,
      created: new Date()
    };
    this.shoppingRecommendations.set(id, rec);
    return rec;
  }

  async deleteShoppingRecommendation(id: number): Promise<boolean> {
    return this.shoppingRecommendations.delete(id);
  }
}

export const storage = new MemStorage();