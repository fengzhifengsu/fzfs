import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  tags: string[];
  importance: number;
  confidence: number;
  userId: string;
  sessionId: string;
  source: 'auto_extract' | 'user_request' | 'tool_result' | 'system';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  accessCount: number;
  lastAccessedAt: Date | null;
}

export interface MemoryConfig {
  dbPath: string;
  maxMemoriesPerUser: number;
  importanceThreshold: number;
  decayRate: number;
  decayIntervalDays: number;
  autoExtractEnabled: boolean;
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  dbPath: './data/memory.db',
  maxMemoriesPerUser: 500,
  importanceThreshold: 0.3,
  decayRate: 0.9,
  decayIntervalDays: 7,
  autoExtractEnabled: true,
};

export class MemoryManager {
  private db!: Database.Database;
  private logger: any;
  private config: MemoryConfig;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.logger = getLogger();
    this.initialize();
  }

  private initialize(): void {
    const dir = path.dirname(this.config.dbPath);
    fs.ensureDirSync(dir);
    this.db = new Database(this.config.dbPath);
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        tags TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8,
        user_id TEXT NOT NULL,
        session_id TEXT DEFAULT '',
        source TEXT DEFAULT 'auto_extract',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        access_count INTEGER DEFAULT 0,
        last_accessed_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
    `);
  }

  store(memory: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'>): MemoryEntry {
    const existing = this.findByKey(memory.userId, memory.key);
    
    if (existing) {
      return this.update(existing.id, {
        value: memory.value,
        importance: Math.max(existing.importance, memory.importance),
        confidence: memory.confidence,
        tags: [...new Set([...existing.tags, ...memory.tags])],
      });
    }

    const entry: MemoryEntry = {
      ...memory,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
      accessCount: 0,
      lastAccessedAt: null,
    };

    this.db.prepare(`
      INSERT INTO memories (id, key, value, category, tags, importance, confidence, user_id, session_id, source, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.key,
      entry.value,
      entry.category,
      JSON.stringify(entry.tags),
      entry.importance,
      entry.confidence,
      entry.userId,
      entry.sessionId,
      entry.source,
      entry.expiresAt?.toISOString() || null
    );

    this.logger.debug(`Stored memory [${entry.category}]: ${entry.key} = ${entry.value.substring(0, 50)}...`);
    this.enforceMemoryLimit(entry.userId);
    return entry;
  }

  update(id: string, updates: Partial<Pick<MemoryEntry, 'value' | 'importance' | 'confidence' | 'tags' | 'expiresAt'>>): MemoryEntry {
    const existing = this.findById(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.db.prepare(`
      UPDATE memories SET
        value = ?,
        importance = ?,
        confidence = ?,
        tags = ?,
        expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      updated.value,
      updated.importance,
      updated.confidence,
      JSON.stringify(updated.tags),
      updated.expiresAt?.toISOString() || null,
      id
    );

    return updated;
  }

  findById(id: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    return row ? this.parseRow(row) : null;
  }

  findByKey(userId: string, key: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE user_id = ? AND key = ?').get(userId, key) as any;
    return row ? this.parseRow(row) : null;
  }

  get(userId: string, key?: string): MemoryEntry[] {
    if (key) {
      const row = this.db.prepare('SELECT * FROM memories WHERE user_id = ? AND key = ?').get(userId, key) as any;
      return row ? [this.parseRow(row)] : [];
    }
    
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY importance DESC, access_count DESC
    `).all(userId) as any[];
    
    return rows.map(r => this.parseRow(r));
  }

  search(userId: string, query: string, limit: number = 10): MemoryEntry[] {
    const searchPattern = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      WHERE user_id = ? 
      AND (value LIKE ? OR key LIKE ?)
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY importance DESC, access_count DESC
      LIMIT ?
    `).all(userId, searchPattern, searchPattern, limit) as any[];
    
    return rows.map(r => {
      const memory = this.parseRow(r);
      this.incrementAccess(r.id);
      return memory;
    });
  }

  getByCategory(userId: string, category: string, limit: number = 20): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      WHERE user_id = ? AND category = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY importance DESC, access_count DESC
      LIMIT ?
    `).all(userId, category, limit) as any[];
    
    return rows.map(r => this.parseRow(r));
  }

  getImportant(userId: string, minImportance: number = 0.7, limit: number = 20): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories 
      WHERE user_id = ? AND importance >= ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY importance DESC, access_count DESC
      LIMIT ?
    `).all(userId, minImportance, limit) as any[];
    
    return rows.map(r => this.parseRow(r));
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByCategory(userId: string, category: string): number {
    const result = this.db.prepare('DELETE FROM memories WHERE user_id = ? AND category = ?').run(userId, category);
    return result.changes;
  }

  clearUserMemories(userId: string): number {
    const result = this.db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    return result.changes;
  }

  extractFacts(content: string, userId: string, sessionId: string): MemoryEntry[] {
    if (!this.config.autoExtractEnabled) return [];
    
    const extracted: MemoryEntry[] = [];
    const lines = content.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      const fact = this.parseFact(line, userId, sessionId);
      if (fact) extracted.push(fact);
    }
    
    for (const memory of extracted) {
      this.store(memory);
    }
    
    return extracted;
  }

  private parseFact(line: string, userId: string, sessionId: string): MemoryEntry | null {
    const patterns = [
      { regex: /(?:我叫|名字是|我是)\s*(.+)/i, category: 'user_info', key: 'name' },
      { regex: /(?:我的邮箱|email是?)\s*(.+)/i, category: 'user_info', key: 'email' },
      { regex: /(?:我的电话|手机号是?)\s*(.+)/i, category: 'user_info', key: 'phone' },
      { regex: /(?:我喜欢|我偏好)\s*(.+)/i, category: 'preferences', key: 'likes' },
      { regex: /(?:我讨厌|我不喜欢)\s*(.+)/i, category: 'preferences', key: 'dislikes' },
      { regex: /(?:记住|保存)\s*(.+)/i, category: 'user_requests', key: 'request' },
      { regex: /(?:我的项目是|项目名是?)\s*(.+)/i, category: 'project_info', key: 'project_name' },
      { regex: /(?:工作在|工作目录是?)\s*(.+)/i, category: 'project_info', key: 'workspace' },
    ];
    
    for (const { regex, category, key } of patterns) {
      const match = line.match(regex);
      if (match) {
        const value = match[1].trim();
        if (value.length > 2 && value.length < 200) {
          return {
            id: '',
            key: `${key}_${userId}`,
            value,
            category,
            tags: ['auto_extracted'],
            importance: 0.6,
            confidence: 0.7,
            userId,
            sessionId,
            source: 'auto_extract',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
            accessCount: 0,
            lastAccessedAt: null,
          };
        }
      }
    }
    
    return null;
  }

  getRecentContext(userId: string, limit: number = 10): string {
    const memories = this.getImportant(userId, 0.5, limit);
    if (memories.length === 0) return '';
    
    const context = memories
      .map(m => `[${m.category}] ${m.value}`)
      .join('\n');
    
    return `📝 相关记忆:\n${context}`;
  }

  runDecay(): number {
    const result = this.db.prepare(`
      UPDATE memories 
      SET importance = importance * ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE importance < ? 
      AND access_count = 0
      AND created_at < date('now', ?)
    `).run(this.config.decayRate, this.config.importanceThreshold, `-${this.config.decayIntervalDays} days`);
    
    this.logger.info(`Memory decay: affected ${result.changes} memories`);
    return result.changes;
  }

  cleanupExpired(): number {
    const result = this.db.prepare(`
      DELETE FROM memories 
      WHERE expires_at IS NOT NULL 
      AND expires_at < datetime('now')
    `).run();
    
    this.logger.info(`Cleaned up ${result.changes} expired memories`);
    return result.changes;
  }

  private enforceMemoryLimit(userId: string): void {
    const count = this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?').get(userId) as any;
    
    if (count.cnt > this.config.maxMemoriesPerUser) {
      const toRemove = count.cnt - this.config.maxMemoriesPerUser;
      this.db.prepare(`
        DELETE FROM memories 
        WHERE id IN (
          SELECT id FROM memories 
          WHERE user_id = ? 
          ORDER BY importance ASC, access_count ASC
          LIMIT ?
        )
      `).run(userId, toRemove);
      
      this.logger.info(`Enforced memory limit for user ${userId}: removed ${toRemove} low-importance memories`);
    }
  }

  private incrementAccess(id: string): void {
    this.db.prepare(`
      UPDATE memories 
      SET access_count = access_count + 1,
          last_accessed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
  }

  private parseRow(row: any): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      category: row.category,
      tags: JSON.parse(row.tags || '[]'),
      importance: row.importance,
      confidence: row.confidence,
      userId: row.user_id,
      sessionId: row.session_id,
      source: row.source,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    };
  }

  getStats(userId?: string): any {
    if (userId) {
      const row = this.db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN importance >= 0.7 THEN 1 END) as important,
          COUNT(CASE WHEN access_count > 0 THEN 1 END) as accessed,
          AVG(importance) as avg_importance
        FROM memories 
        WHERE user_id = ?
      `).get(userId) as any;
      
      return {
        userId,
        totalMemories: row.total,
        importantMemories: row.important,
        accessedMemories: row.accessed,
        avgImportance: row.avg_importance?.toFixed(2) || '0.00',
      };
    }
    
    const row = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT user_id) as users
      FROM memories
    `).get() as any;
    
    return {
      totalMemories: row.total,
      totalUsers: row.users,
    };
  }

  close(): void {
    this.db.close();
  }
}
