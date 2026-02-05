import { 
  type User, 
  type InsertUser, 
  type StylometricAuthor, 
  type InsertStylometricAuthor,
  type AnalysisHistory,
  type InsertAnalysisHistory,
  type CorpusAuthor,
  type InsertCorpusAuthor,
  type CorpusWork,
  type InsertCorpusWork,
  type WorkSection,
  type InsertWorkSection,
  type PhilosophicalPosition,
  type InsertPhilosophicalPosition,
  users, 
  stylometricAuthors,
  analysisHistory,
  corpusAuthors,
  corpusWorks,
  workSections,
  philosophicalPositions
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createUserWithGoogle(user: { username: string; googleId: string; email: string | null; displayName: string | null }): Promise<User>;
  updateUserGoogle(id: number, data: { googleId?: string; displayName?: string | null }): Promise<User>;
  addCredits(userId: number, amount: number): Promise<User>;
  deductCredits(userId: number, amount: number): Promise<User>;
  getUserCredits(userId: number): Promise<number>;
  
  getStylometricAuthors(userId: number): Promise<StylometricAuthor[]>;
  getStylometricAuthor(id: number): Promise<StylometricAuthor | undefined>;
  getStylometricAuthorByName(userId: number, authorName: string): Promise<StylometricAuthor | undefined>;
  createStylometricAuthor(author: InsertStylometricAuthor): Promise<StylometricAuthor>;
  updateStylometricAuthor(id: number, author: Partial<InsertStylometricAuthor>): Promise<StylometricAuthor | undefined>;
  deleteStylometricAuthor(id: number): Promise<boolean>;
  
  createAnalysisHistory(history: InsertAnalysisHistory): Promise<AnalysisHistory>;
  getAnalysisHistory(userId: number): Promise<AnalysisHistory[]>;
  getAnalysisHistoryByType(userId: number, analysisType: string): Promise<AnalysisHistory[]>;
  getAnalysisHistoryItem(id: number): Promise<AnalysisHistory | undefined>;
  deleteAnalysisHistoryItem(id: number): Promise<boolean>;
  
  // Corpus management
  getAllCorpusAuthors(): Promise<CorpusAuthor[]>;
  getCorpusAuthor(id: number): Promise<CorpusAuthor | undefined>;
  findCorpusAuthorByName(name: string): Promise<CorpusAuthor | undefined>;
  createCorpusAuthor(author: InsertCorpusAuthor): Promise<CorpusAuthor>;
  deleteCorpusAuthor(id: number): Promise<boolean>;
  
  getCorpusWorks(authorId: number): Promise<CorpusWork[]>;
  getCorpusWork(id: number): Promise<CorpusWork | undefined>;
  createCorpusWork(work: InsertCorpusWork): Promise<CorpusWork>;
  deleteCorpusWork(id: number): Promise<boolean>;
  
  getWorkSections(workId: number): Promise<WorkSection[]>;
  createWorkSections(sections: InsertWorkSection[]): Promise<WorkSection[]>;
  searchCorpusByAuthor(authorName: string, searchTerm: string): Promise<{ section: WorkSection; workTitle: string; authorName: string }[]>;
  
  // Philosophical positions for RAG
  getAllPhilosophicalPositions(): Promise<PhilosophicalPosition[]>;
  getPhilosophicalPositionsByTopic(topic: string): Promise<PhilosophicalPosition[]>;
  getPhilosophicalPositionsByThinker(thinker: string): Promise<PhilosophicalPosition[]>;
  searchPhilosophicalPositions(searchTerm: string): Promise<PhilosophicalPosition[]>;
  createPhilosophicalPosition(position: InsertPhilosophicalPosition): Promise<PhilosophicalPosition>;
  batchCreatePhilosophicalPositions(positions: InsertPhilosophicalPosition[]): Promise<PhilosophicalPosition[]>;
  deletePhilosophicalPosition(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUserWithGoogle(userData: { username: string; googleId: string; email: string | null; displayName: string | null }): Promise<User> {
    const [user] = await db.insert(users).values({
      username: userData.username,
      googleId: userData.googleId,
      email: userData.email,
      displayName: userData.displayName,
    }).returning();
    return user;
  }

  async updateUserGoogle(id: number, data: { googleId?: string; displayName?: string | null }): Promise<User> {
    const [user] = await db.update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async addCredits(userId: number, amount: number): Promise<User> {
    const [user] = await db.update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async deductCredits(userId: number, amount: number): Promise<User> {
    const [user] = await db.update(users)
      .set({ credits: sql`GREATEST(${users.credits} - ${amount}, 0)` })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getUserCredits(userId: number): Promise<number> {
    const user = await this.getUserById(userId);
    return user?.credits ?? 0;
  }
  
  async getStylometricAuthors(userId: number): Promise<StylometricAuthor[]> {
    return await db.select().from(stylometricAuthors).where(eq(stylometricAuthors.userId, userId));
  }
  
  async getStylometricAuthor(id: number): Promise<StylometricAuthor | undefined> {
    const [author] = await db.select().from(stylometricAuthors).where(eq(stylometricAuthors.id, id));
    return author;
  }
  
  async getStylometricAuthorByName(userId: number, authorName: string): Promise<StylometricAuthor | undefined> {
    const [author] = await db.select().from(stylometricAuthors).where(
      and(
        eq(stylometricAuthors.userId, userId),
        eq(stylometricAuthors.authorName, authorName)
      )
    );
    return author;
  }
  
  async createStylometricAuthor(author: InsertStylometricAuthor): Promise<StylometricAuthor> {
    const [created] = await db.insert(stylometricAuthors).values(author).returning();
    return created;
  }
  
  async updateStylometricAuthor(id: number, author: Partial<InsertStylometricAuthor>): Promise<StylometricAuthor | undefined> {
    const [updated] = await db.update(stylometricAuthors)
      .set({ ...author, updatedAt: new Date() })
      .where(eq(stylometricAuthors.id, id))
      .returning();
    return updated;
  }
  
  async deleteStylometricAuthor(id: number): Promise<boolean> {
    const result = await db.delete(stylometricAuthors).where(eq(stylometricAuthors.id, id));
    return true;
  }
  
  async createAnalysisHistory(history: InsertAnalysisHistory): Promise<AnalysisHistory> {
    const [created] = await db.insert(analysisHistory).values(history).returning();
    return created;
  }
  
  async getAnalysisHistory(userId: number): Promise<AnalysisHistory[]> {
    return await db.select()
      .from(analysisHistory)
      .where(eq(analysisHistory.userId, userId))
      .orderBy(desc(analysisHistory.createdAt));
  }
  
  async getAnalysisHistoryByType(userId: number, analysisType: string): Promise<AnalysisHistory[]> {
    return await db.select()
      .from(analysisHistory)
      .where(and(
        eq(analysisHistory.userId, userId),
        eq(analysisHistory.analysisType, analysisType)
      ))
      .orderBy(desc(analysisHistory.createdAt));
  }
  
  async getAnalysisHistoryItem(id: number): Promise<AnalysisHistory | undefined> {
    const [item] = await db.select().from(analysisHistory).where(eq(analysisHistory.id, id));
    return item;
  }
  
  async deleteAnalysisHistoryItem(id: number): Promise<boolean> {
    await db.delete(analysisHistory).where(eq(analysisHistory.id, id));
    return true;
  }
  
  // Corpus management implementations
  async getAllCorpusAuthors(): Promise<CorpusAuthor[]> {
    return await db.select().from(corpusAuthors).orderBy(corpusAuthors.name);
  }
  
  async getCorpusAuthor(id: number): Promise<CorpusAuthor | undefined> {
    const [author] = await db.select().from(corpusAuthors).where(eq(corpusAuthors.id, id));
    return author;
  }
  
  async findCorpusAuthorByName(name: string): Promise<CorpusAuthor | undefined> {
    // Search by name or aliases (case-insensitive)
    const [author] = await db.select().from(corpusAuthors).where(
      or(
        ilike(corpusAuthors.name, `%${name}%`),
        ilike(corpusAuthors.aliases, `%${name}%`)
      )
    );
    return author;
  }
  
  async createCorpusAuthor(author: InsertCorpusAuthor): Promise<CorpusAuthor> {
    const [created] = await db.insert(corpusAuthors).values(author).returning();
    return created;
  }
  
  async deleteCorpusAuthor(id: number): Promise<boolean> {
    // First delete all work sections for this author's works
    const works = await db.select().from(corpusWorks).where(eq(corpusWorks.authorId, id));
    for (const work of works) {
      await db.delete(workSections).where(eq(workSections.workId, work.id));
    }
    // Delete works
    await db.delete(corpusWorks).where(eq(corpusWorks.authorId, id));
    // Delete author
    await db.delete(corpusAuthors).where(eq(corpusAuthors.id, id));
    return true;
  }
  
  async getCorpusWorks(authorId: number): Promise<CorpusWork[]> {
    return await db.select().from(corpusWorks).where(eq(corpusWorks.authorId, authorId)).orderBy(corpusWorks.title);
  }
  
  async getCorpusWork(id: number): Promise<CorpusWork | undefined> {
    const [work] = await db.select().from(corpusWorks).where(eq(corpusWorks.id, id));
    return work;
  }
  
  async createCorpusWork(work: InsertCorpusWork): Promise<CorpusWork> {
    const [created] = await db.insert(corpusWorks).values(work).returning();
    return created;
  }
  
  async deleteCorpusWork(id: number): Promise<boolean> {
    // Delete sections first
    await db.delete(workSections).where(eq(workSections.workId, id));
    // Delete work
    await db.delete(corpusWorks).where(eq(corpusWorks.id, id));
    return true;
  }
  
  async getWorkSections(workId: number): Promise<WorkSection[]> {
    return await db.select().from(workSections).where(eq(workSections.workId, workId)).orderBy(workSections.sectionNumber);
  }
  
  async createWorkSections(sections: InsertWorkSection[]): Promise<WorkSection[]> {
    if (sections.length === 0) return [];
    const created = await db.insert(workSections).values(sections).returning();
    return created;
  }
  
  async searchCorpusByAuthor(authorName: string, searchTerm: string): Promise<{ section: WorkSection; workTitle: string; authorName: string }[]> {
    // Find the author
    const author = await this.findCorpusAuthorByName(authorName);
    if (!author) return [];
    
    // Get all works by this author
    const works = await this.getCorpusWorks(author.id);
    if (works.length === 0) return [];
    
    const results: { section: WorkSection; workTitle: string; authorName: string }[] = [];
    
    // Search through sections of all works
    for (const work of works) {
      const sections = await db.select()
        .from(workSections)
        .where(
          and(
            eq(workSections.workId, work.id),
            ilike(workSections.content, `%${searchTerm}%`)
          )
        );
      
      for (const section of sections) {
        results.push({
          section,
          workTitle: work.title,
          authorName: author.name
        });
      }
    }
    
    return results;
  }
  
  // Philosophical positions for RAG
  async getAllPhilosophicalPositions(): Promise<PhilosophicalPosition[]> {
    return await db.select().from(philosophicalPositions).orderBy(desc(philosophicalPositions.createdAt));
  }
  
  async getPhilosophicalPositionsByTopic(topic: string): Promise<PhilosophicalPosition[]> {
    return await db.select().from(philosophicalPositions)
      .where(ilike(philosophicalPositions.topic, `%${topic}%`))
      .orderBy(desc(philosophicalPositions.createdAt));
  }
  
  async getPhilosophicalPositionsByThinker(thinker: string): Promise<PhilosophicalPosition[]> {
    return await db.select().from(philosophicalPositions)
      .where(ilike(philosophicalPositions.thinker, `%${thinker}%`))
      .orderBy(desc(philosophicalPositions.createdAt));
  }
  
  async searchPhilosophicalPositions(searchTerm: string): Promise<PhilosophicalPosition[]> {
    return await db.select().from(philosophicalPositions)
      .where(
        or(
          ilike(philosophicalPositions.statement, `%${searchTerm}%`),
          ilike(philosophicalPositions.topic, `%${searchTerm}%`),
          ilike(philosophicalPositions.thinker, `%${searchTerm}%`),
          ilike(philosophicalPositions.keywords, `%${searchTerm}%`)
        )
      )
      .orderBy(desc(philosophicalPositions.createdAt));
  }
  
  async createPhilosophicalPosition(position: InsertPhilosophicalPosition): Promise<PhilosophicalPosition> {
    const [created] = await db.insert(philosophicalPositions).values(position).returning();
    return created;
  }
  
  async batchCreatePhilosophicalPositions(positions: InsertPhilosophicalPosition[]): Promise<PhilosophicalPosition[]> {
    if (positions.length === 0) return [];
    const created = await db.insert(philosophicalPositions).values(positions).returning();
    return created;
  }
  
  async deletePhilosophicalPosition(id: number): Promise<boolean> {
    const result = await db.delete(philosophicalPositions).where(eq(philosophicalPositions.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
