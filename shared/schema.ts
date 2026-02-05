import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  googleId: text("google_id").unique(),
  email: text("email").unique(),
  displayName: text("display_name"),
  credits: integer("credits").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const stylometricAuthors = pgTable("stylometric_authors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  authorName: varchar("author_name", { length: 255 }).notNull(),
  sourceTitle: varchar("source_title", { length: 500 }),
  wordCount: integer("word_count"),
  verticalityScore: decimal("verticality_score", { precision: 4, scale: 3 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  rawFeatures: jsonb("raw_features"),
  signaturePhrases: jsonb("signature_phrases"),
  negativeMarkers: jsonb("negative_markers"),
  sampleSentences: jsonb("sample_sentences"),
  closestAuthorMatch: varchar("closest_author_match", { length: 255 }),
  matchExplanation: text("match_explanation"),
  psychologicalProfile: jsonb("psychological_profile"),
  narrativeSummary: text("narrative_summary"),
  clustering: jsonb("clustering"),
  fullReport: text("full_report"),
});

export const insertStylometricAuthorSchema = createInsertSchema(stylometricAuthors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStylometricAuthor = z.infer<typeof insertStylometricAuthorSchema>;
export type StylometricAuthor = typeof stylometricAuthors.$inferSelect;

export const analysisHistory = pgTable("analysis_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  analysisType: varchar("analysis_type", { length: 50 }).notNull(),
  provider: varchar("provider", { length: 50 }),
  inputPreview: text("input_preview"),
  outputData: jsonb("output_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAnalysisHistorySchema = createInsertSchema(analysisHistory).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalysisHistory = z.infer<typeof insertAnalysisHistorySchema>;
export type AnalysisHistory = typeof analysisHistory.$inferSelect;

// ============ AUTHOR CORPUS DATABASE ============
// For storing large collections of author works for Quote Finder

export const corpusAuthors = pgTable("corpus_authors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  aliases: text("aliases"), // Comma-separated aliases (e.g., "Kant, Immanuel Kant, I. Kant")
  era: varchar("era", { length: 100 }), // e.g., "Ancient", "Enlightenment", "Modern"
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCorpusAuthorSchema = createInsertSchema(corpusAuthors).omit({
  id: true,
  createdAt: true,
});

export type InsertCorpusAuthor = z.infer<typeof insertCorpusAuthorSchema>;
export type CorpusAuthor = typeof corpusAuthors.$inferSelect;

export const corpusWorks = pgTable("corpus_works", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").references(() => corpusAuthors.id),
  title: varchar("title", { length: 500 }).notNull(),
  year: integer("year"), // Publication year if known
  source: varchar("source", { length: 500 }), // Where the text came from
  wordCount: integer("word_count"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCorpusWorkSchema = createInsertSchema(corpusWorks).omit({
  id: true,
  createdAt: true,
});

export type InsertCorpusWork = z.infer<typeof insertCorpusWorkSchema>;
export type CorpusWork = typeof corpusWorks.$inferSelect;

export const workSections = pgTable("work_sections", {
  id: serial("id").primaryKey(),
  workId: integer("work_id").references(() => corpusWorks.id),
  sectionNumber: integer("section_number").notNull(),
  content: text("content").notNull(), // ~2-3k character chunks
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkSectionSchema = createInsertSchema(workSections).omit({
  id: true,
  createdAt: true,
});

export type InsertWorkSection = z.infer<typeof insertWorkSectionSchema>;
export type WorkSection = typeof workSections.$inferSelect;

// ============ COHERENCE TRACKING TABLES ============
// For maintaining state across chunks when processing large documents

export const coherenceDocuments = pgTable("coherence_documents", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  coherenceMode: text("coherence_mode").notNull(),
  globalState: jsonb("global_state").notNull(),
  originalWordCount: integer("original_word_count"),
  totalChunks: integer("total_chunks"),
  processedChunks: integer("processed_chunks").default(0),
  status: text("status").default("in_progress"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  userId: integer("user_id").references(() => users.id),
});

export const insertCoherenceDocumentSchema = createInsertSchema(coherenceDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCoherenceDocument = z.infer<typeof insertCoherenceDocumentSchema>;
export type CoherenceDocument = typeof coherenceDocuments.$inferSelect;

export const coherenceChunks = pgTable("coherence_chunks", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  coherenceMode: text("coherence_mode").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  processedOutput: text("processed_output"),
  evaluationResult: jsonb("evaluation_result"),
  stateAfter: jsonb("state_after"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCoherenceChunkSchema = createInsertSchema(coherenceChunks).omit({
  id: true,
  createdAt: true,
});

export type InsertCoherenceChunk = z.infer<typeof insertCoherenceChunkSchema>;
export type CoherenceChunk = typeof coherenceChunks.$inferSelect;

// ============ DOCUMENT SKELETON STORAGE ============
// For skeleton-informed extraction (Pattern B)

export const documentSkeletons = pgTable("document_skeletons", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  skeletonType: text("skeleton_type").notNull(),
  parentSkeletonId: integer("parent_skeleton_id"),
  skeleton: jsonb("skeleton").notNull(),
  wordCount: integer("word_count"),
  chunkRange: jsonb("chunk_range"),
  createdAt: timestamp("created_at").defaultNow(),
  userId: integer("user_id").references(() => users.id),
});

export const insertDocumentSkeletonSchema = createInsertSchema(documentSkeletons).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentSkeleton = z.infer<typeof insertDocumentSkeletonSchema>;
export type DocumentSkeleton = typeof documentSkeletons.$inferSelect;

// ============ PHILOSOPHICAL POSITIONS DATABASE ============
// For RAG-augmented Tractatus generation

export const philosophicalPositions = pgTable("philosophical_positions", {
  id: serial("id").primaryKey(),
  thinker: varchar("thinker", { length: 255 }).notNull(),
  statement: text("statement").notNull(),
  topic: varchar("topic", { length: 255 }).notNull(),
  source: varchar("source", { length: 500 }),
  era: varchar("era", { length: 100 }),
  keywords: text("keywords"),
  embedding: text("embedding"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPhilosophicalPositionSchema = createInsertSchema(philosophicalPositions).omit({
  id: true,
  createdAt: true,
});

export type InsertPhilosophicalPosition = z.infer<typeof insertPhilosophicalPositionSchema>;
export type PhilosophicalPosition = typeof philosophicalPositions.$inferSelect;
