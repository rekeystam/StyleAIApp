import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  bodyType: text("body_type"), // pear, apple, hourglass, rectangle, inverted_triangle
  skinTone: text("skin_tone"), // warm, cool, neutral
  age: integer("age"),
  height: integer("height"), // in cm
  gender: text("gender"), // male, female, non_binary, prefer_not_to_say
  location: text("location"), // city, country for weather detection
  preferences: text("preferences"), // JSON string of style preferences
});

export const clothingItems = pgTable("clothing_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(), // tops, bottoms, dresses, accessories, etc.
  style: text("style").notNull(), // casual, formal, business, etc.
  colors: text("colors").array().notNull(), // array of detected colors
  imageUrl: text("image_url").notNull(),
  aiAnalysis: text("ai_analysis"), // JSON string of AI analysis results
  isVerified: boolean("is_verified").default(false),
  warmthLevel: integer("warmth_level"), // 1-5 scale for weather appropriateness
  weatherSuitability: text("weather_suitability").array(), // rain, sun, snow, wind
  fabricType: text("fabric_type"), // cotton, wool, synthetic, etc.
});

export const outfits = pgTable("outfits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  itemIds: integer("item_ids").array().notNull(), // array of clothing item IDs
  occasion: text("occasion"), // business, casual, date night, etc.
  aiConfidence: integer("ai_confidence"), // 0-100 match score
  isSaved: boolean("is_saved").default(false),
  weatherConditions: text("weather_conditions"), // JSON string of weather data
  temperature: integer("temperature"), // in celsius
  seasonality: text("seasonality"), // spring, summer, fall, winter
  timeOfDay: text("time_of_day"), // morning, afternoon, evening, night
});

export const weatherData = pgTable("weather_data", {
  id: serial("id").primaryKey(),
  location: text("location").notNull(),
  temperature: integer("temperature").notNull(),
  condition: text("condition").notNull(), // sunny, rainy, cloudy, snowy
  humidity: integer("humidity"),
  windSpeed: integer("wind_speed"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const shoppingRecommendations = pgTable("shopping_recommendations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(),
  reason: text("reason").notNull(),
  suggestedItems: text("suggested_items"), // JSON array of recommended items
  confidence: integer("confidence"), // confidence that triggered the recommendation
  created: timestamp("created").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const updateUserProfileSchema = createInsertSchema(users).pick({
  bodyType: true,
  skinTone: true,
  age: true,
  height: true,
  gender: true,
  location: true,
  preferences: true,
});

export const insertClothingItemSchema = createInsertSchema(clothingItems).omit({
  id: true,
});

export const insertOutfitSchema = createInsertSchema(outfits).omit({
  id: true,
});

export const insertWeatherDataSchema = createInsertSchema(weatherData).omit({
  id: true,
  timestamp: true,
});

export const insertShoppingRecommendationSchema = createInsertSchema(shoppingRecommendations).omit({
  id: true,
  created: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;

export type ClothingItem = typeof clothingItems.$inferSelect;
export type InsertClothingItem = z.infer<typeof insertClothingItemSchema>;

export type Outfit = typeof outfits.$inferSelect;
export type InsertOutfit = z.infer<typeof insertOutfitSchema>;

export type WeatherData = typeof weatherData.$inferSelect;
export type InsertWeatherData = z.infer<typeof insertWeatherDataSchema>;

export type ShoppingRecommendation = typeof shoppingRecommendations.$inferSelect;
export type InsertShoppingRecommendation = z.infer<typeof insertShoppingRecommendationSchema>;
