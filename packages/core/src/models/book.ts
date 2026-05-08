import { z } from "zod";

export const PlatformSchema = z.enum(["tomato", "feilu", "qidian", "other"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.enum(["canon", "au", "ooc", "cp"]);
export type FanficMode = z.infer<typeof FanficModeSchema>;

export const WebnovelTemplateSchema = z.enum(["xuanhuan"]);
export type WebnovelTemplate = z.infer<typeof WebnovelTemplateSchema>;

export const BookTypeSchema = z.enum(["novel", "short_story"]);
export type BookType = z.infer<typeof BookTypeSchema>;

export const NumericExpressionModeSchema = z.enum(["immersive", "system", "light_numeric"]);
export type NumericExpressionMode = z.infer<typeof NumericExpressionModeSchema>;

export const WritingRulesSchema = z.object({
  numericExpressionMode: NumericExpressionModeSchema.optional(),
}).passthrough();
export type WritingRules = z.infer<typeof WritingRulesSchema>;

export const BookConfigSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  type: BookTypeSchema.optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1).default(200),
  chapterWordCount: z.number().int().min(1000).default(3000),
  language: z.enum(["zh", "en"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
  webnovelTemplate: WebnovelTemplateSchema.optional(),
  writingRules: WritingRulesSchema.optional(),
});

export type BookConfig = z.infer<typeof BookConfigSchema>;
