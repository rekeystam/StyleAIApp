import { users, clothingItems, outfits, type User, type InsertUser, type ClothingItem, type InsertClothingItem, type Outfit, type InsertOutfit } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getClothingItems(userId: number): Promise<ClothingItem[]>;
  getClothingItem(id: number): Promise<ClothingItem | undefined>;
  createClothingItem(item: InsertClothingItem): Promise<ClothingItem>;
  updateClothingItem(id: number, updates: Partial<ClothingItem>): Promise<ClothingItem | undefined>;
  deleteClothingItem(id: number): Promise<boolean>;
  
  getOutfits(userId: number): Promise<Outfit[]>;
  createOutfit(outfit: InsertOutfit): Promise<Outfit>;
  updateOutfit(id: number, updates: Partial<Outfit>): Promise<Outfit | undefined>;
  deleteOutfit(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private clothingItems: Map<number, ClothingItem>;
  private outfits: Map<number, Outfit>;
  private currentUserId: number;
  private currentClothingItemId: number;
  private currentOutfitId: number;

  constructor() {
    this.users = new Map();
    this.clothingItems = new Map();
    this.outfits = new Map();
    this.currentUserId = 1;
    this.currentClothingItemId = 1;
    this.currentOutfitId = 1;
    
    // Add sample clothing items for testing
    this.initializeSampleData();
  }
  
  private initializeSampleData() {
    // Create sample user
    const sampleUser: User = {
      id: 1,
      username: "demo",
      password: "demo"
    };
    this.users.set(1, sampleUser);
    
    // Add sample clothing items with different categories
    const sampleItems: ClothingItem[] = [
      {
        id: 1,
        userId: 1,
        name: "White Cotton T-Shirt",
        category: "tops",
        style: "casual",
        colors: ["white"],
        imageUrl: "/sample-tshirt.jpg",
        aiAnalysis: '{"category":"tops","style":"casual","colors":["white"],"fabric_type":"cotton","pattern":"solid","formality":"casual","season":"all_season","fit":"regular","description":"Classic white cotton t-shirt","styling_tips":"Versatile basic piece","body_type_recommendations":"Suitable for all body types"}',
        isVerified: true
      },
      {
        id: 2,
        userId: 1,
        name: "Blue Denim Jeans",
        category: "bottoms",
        style: "casual",
        colors: ["blue"],
        imageUrl: "/sample-jeans.jpg",
        aiAnalysis: '{"category":"bottoms","style":"casual","colors":["blue"],"fabric_type":"denim","pattern":"solid","formality":"casual","season":"all_season","fit":"regular","description":"Classic blue denim jeans","styling_tips":"Essential wardrobe staple","body_type_recommendations":"Suitable for all body types"}',
        isVerified: true
      },
      {
        id: 3,
        userId: 1,
        name: "Black Business Shirt",
        category: "tops",
        style: "business",
        colors: ["black"],
        imageUrl: "/sample-shirt.jpg",
        aiAnalysis: '{"category":"tops","style":"business","colors":["black"],"fabric_type":"cotton","pattern":"solid","formality":"business_casual","season":"all_season","fit":"slim","description":"Professional black dress shirt","styling_tips":"Perfect for office wear","body_type_recommendations":"Suitable for all body types"}',
        isVerified: true
      },
      {
        id: 4,
        userId: 1,
        name: "Khaki Chinos",
        category: "bottoms",
        style: "business",
        colors: ["khaki", "beige"],
        imageUrl: "/sample-chinos.jpg",
        aiAnalysis: '{"category":"bottoms","style":"business","colors":["khaki","beige"],"fabric_type":"cotton","pattern":"solid","formality":"business_casual","season":"all_season","fit":"slim","description":"Smart khaki chino pants","styling_tips":"Great for business casual looks","body_type_recommendations":"Suitable for all body types"}',
        isVerified: true
      },
      {
        id: 5,
        userId: 1,
        name: "Brown Leather Belt",
        category: "accessories",
        style: "business",
        colors: ["brown"],
        imageUrl: "/sample-belt.jpg",
        aiAnalysis: '{"category":"accessories","style":"business","colors":["brown"],"fabric_type":"leather","pattern":"solid","formality":"business_casual","season":"all_season","fit":"adjustable","description":"Quality brown leather belt","styling_tips":"Complements business and casual outfits","body_type_recommendations":"Universal accessory"}',
        isVerified: true
      }
    ];
    
    sampleItems.forEach(item => {
      this.clothingItems.set(item.id, item);
    });
    
    this.currentClothingItemId = 6;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getClothingItems(userId: number): Promise<ClothingItem[]> {
    return Array.from(this.clothingItems.values()).filter(
      (item) => item.userId === userId
    );
  }

  async getClothingItem(id: number): Promise<ClothingItem | undefined> {
    return this.clothingItems.get(id);
  }

  async createClothingItem(insertItem: InsertClothingItem): Promise<ClothingItem> {
    const id = this.currentClothingItemId++;
    const item: ClothingItem = { 
      ...insertItem, 
      id, 
      isVerified: false,
      aiAnalysis: insertItem.aiAnalysis || null
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

  async getOutfits(userId: number): Promise<Outfit[]> {
    return Array.from(this.outfits.values()).filter(
      (outfit) => outfit.userId === userId
    );
  }

  async createOutfit(insertOutfit: InsertOutfit): Promise<Outfit> {
    const id = this.currentOutfitId++;
    const outfit: Outfit = { 
      ...insertOutfit, 
      id, 
      isSaved: false,
      occasion: insertOutfit.occasion ?? null,
      aiConfidence: insertOutfit.aiConfidence ?? null
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
}

export const storage = new MemStorage();
