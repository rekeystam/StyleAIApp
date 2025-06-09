import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
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
});

export const outfits = pgTable("outfits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  itemIds: integer("item_ids").array().notNull(), // array of clothing item IDs
  occasion: text("occasion"), // business, casual, date night, etc.
  aiConfidence: integer("ai_confidence"), // 0-100 match score
  isSaved: boolean("is_saved").default(false),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertClothingItemSchema = createInsertSchema(clothingItems).omit({
  id: true,
});

export const insertOutfitSchema = createInsertSchema(outfits).omit({
  id: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type ClothingItem = typeof clothingItems.$inferSelect;
export type InsertClothingItem = z.infer<typeof insertClothingItemSchema>;

export type Outfit = typeof outfits.$inferSelect;
export type InsertOutfit = z.infer<typeof insertOutfitSchema>;
