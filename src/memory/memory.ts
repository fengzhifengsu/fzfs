import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
  importance: number;
}

export interface ConversationMemory {
  id: string;
  sessionId: string;
  userId: string;
  summary: string;
  content: string;
  timestamp: Date;
}

export interface UserPreference {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: string;
}

export class MemorySystem {
  private db: Database.Database;
  private initialized: boolean = false;

  constructor(dbPath: string = './data/memory.db') {
    const dir = path.dirname(dbPath);
    fs.ensureDirSync(dir);
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        tags TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0,
        importance REAL DEFAULT 0.5
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        summary TEXT,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general'
      );

      CREATE TABLE IF NOT EXISTS daily_notes (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_preferences_user ON preferences(user_id);
    `);

    this.initialized = true;
  }

  storeMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): MemoryEntry {
    const memory: MemoryEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
      accessCount: 0,
    };

    this.db.prepare(`
      INSERT INTO memories (id, key, value, category, tags, importance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.key,
      memory.value,
      memory.category,
      JSON.stringify(memory.tags),
      memory.importance
    );

    return memory;
  }

  getMemory(key: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE key = ?').get(key) as any;
    if (!row) return null;

    this.db.prepare('UPDATE memories SET access_count = access_count + 1 WHERE id = ?').run(row.id);

    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  searchMemories(query: string, category?: string): MemoryEntry[] {
    let sql = 'SELECT * FROM memories WHERE key LIKE ? OR value LIKE ?';
    const params: any[] = [`%${query}%`, `%${query}%`];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY importance DESC, access_count DESC LIMIT 50';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  getMemoriesByCategory(category: string): MemoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM memories WHERE category = ? ORDER BY importance DESC').all(category) as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  updateMemory(key: string, value: string, importance?: number): MemoryEntry | null {
    const existing = this.getMemory(key);
    if (!existing) return null;

    this.db.prepare(`
      UPDATE memories 
      SET value = ?, updated_at = CURRENT_TIMESTAMP, importance = COALESCE(?, importance)
      WHERE key = ?
    `).run(value, importance, key);

    return this.getMemory(key);
  }

  deleteMemory(key: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE key = ?').run(key);
    return result.changes > 0;
  }

  storeConversation(sessionId: string, userId: string, summary: string, content: string): ConversationMemory {
    const conversation: ConversationMemory = {
      id: uuidv4(),
      sessionId,
      userId,
      summary,
      content,
      timestamp: new Date(),
    };

    this.db.prepare(`
      INSERT INTO conversations (id, session_id, user_id, summary, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(conversation.id, sessionId, userId, summary, content);

    return conversation;
  }

  getConversationsByUser(userId: string, limit: number = 20): ConversationMemory[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE user_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(userId, limit) as any[];
    return rows.map(row => ({ ...row, timestamp: new Date(row.timestamp) }));
  }

  getConversationsBySession(sessionId: string): ConversationMemory[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE session_id = ? 
      ORDER BY timestamp ASC
    `).all(sessionId) as any[];
    return rows.map(row => ({ ...row, timestamp: new Date(row.timestamp) }));
  }

  storePreference(userId: string, key: string, value: string, category: string = 'general'): UserPreference {
    const preference: UserPreference = {
      id: uuidv4(),
      userId,
      key,
      value,
      category,
    };

    this.db.prepare(`
      INSERT OR REPLACE INTO preferences (id, user_id, key, value, category)
      VALUES (?, ?, ?, ?, ?)
    `).run(preference.id, userId, key, value, category);

    return preference;
  }

  getPreference(userId: string, key: string): UserPreference | null {
    const row = this.db.prepare('SELECT * FROM preferences WHERE user_id = ? AND key = ?').get(userId, key) as any;
    if (!row) return null;
    return row;
  }

  getUserPreferences(userId: string): UserPreference[] {
    return this.db.prepare('SELECT * FROM preferences WHERE user_id = ?').all(userId) as UserPreference[];
  }

  storeDailyNote(date: string, content: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO daily_notes (id, date, content)
      VALUES (?, ?, ?)
    `).run(uuidv4(), date, content);
  }

  getDailyNote(date: string): string | null {
    const row = this.db.prepare('SELECT content FROM daily_notes WHERE date = ?').get(date) as any;
    return row?.content || null;
  }

  getRecentDailyNotes(days: number): { date: string; content: string }[] {
    const rows = this.db.prepare(`
      SELECT date, content FROM daily_notes 
      WHERE date >= date('now', ?) 
      ORDER BY date DESC
    `).all(`-${days} days`) as any[];
    return rows;
  }

  getImportantMemories(limit: number = 10): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      ORDER BY importance DESC, access_count DESC 
      LIMIT ?
    `).all(limit) as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  forgetOldMemories(daysOld: number = 30): number {
    const result = this.db.prepare(`
      DELETE FROM memories 
      WHERE importance < 0.3 
      AND updated_at < date('now', ?)
    `).run(`-${daysOld} days`);
    return result.changes;
  }

  getStats(): any {
    const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
    const conversationCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as any;
    const preferenceCount = this.db.prepare('SELECT COUNT(*) as count FROM preferences').get() as any;

    return {
      memories: memoryCount.count,
      conversations: conversationCount.count,
      preferences: preferenceCount.count,
    };
  }

  close(): void {
    this.db.close();
  }
}
