import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';

export interface ActiveMemory {
  id: string;
  content: string;
  context: string;
  source: 'conversation' | 'observation' | 'user_input' | 'tool_result' | 'system';
  userId: string;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date | null;
  references: string[];
  tags: string[];
  importance: number;
  confidence: number;
}

export interface DreamEntry {
  id: string;
  date: string;
  phase: 'light' | 'deep' | 'rem';
  insights: string[];
  consolidatedFrom: string[];
  createdAt: Date;
}

export interface KnowledgeClaim {
  id: string;
  claim: string;
  evidence: string[];
  contradictions: string[];
  freshness: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
}

export interface MemoryGraph {
  nodeId: string;
  label: string;
  content: string;
  category: string;
  edges: { targetId: string; relationship: string; strength: number }[];
}

export class EnhancedMemory {
  private db: Database.Database;
  private logger: any;
  private shortTermBuffer: ActiveMemory[] = [];
  private maxShortTermBuffer: number = 100;

  constructor(dbPath: string = './data/enhanced-memory.db') {
    const dir = path.dirname(dbPath);
    fs.ensureDirSync(dir);
    this.db = new Database(dbPath);
    this.logger = getLogger();
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        context TEXT,
        source TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        \`references\` TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8
      );

      CREATE TABLE IF NOT EXISTS dream_entries (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        phase TEXT NOT NULL,
        insights TEXT NOT NULL,
        consolidated_from TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS knowledge_claims (
        id TEXT PRIMARY KEY,
        claim TEXT NOT NULL,
        evidence TEXT DEFAULT '[]',
        contradictions TEXT DEFAULT '[]',
        freshness REAL DEFAULT 1.0,
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        verified INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS memory_graph (
        id TEXT PRIMARY KEY,
        node_id TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        edges TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        profile_json TEXT NOT NULL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        topic TEXT,
        summary TEXT,
        key_points TEXT DEFAULT '[]',
        sentiment TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_active_memories_user ON active_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_active_memories_source ON active_memories(source);
      CREATE INDEX IF NOT EXISTS idx_knowledge_verified ON knowledge_claims(verified);
    `);
  }

  storeActiveMemory(entry: Omit<ActiveMemory, 'id' | 'createdAt'>): ActiveMemory {
    const memory: ActiveMemory = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date(),
    };

    this.shortTermBuffer.push(memory);

    if (this.shortTermBuffer.length > this.maxShortTermBuffer) {
      this.consolidateShortTermBuffer();
    }

    this.db.prepare(`
      INSERT INTO active_memories (id, content, context, source, user_id, session_id, expires_at, \`references\`, tags, importance, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.content,
      memory.context,
      memory.source,
      memory.userId,
      memory.sessionId,
      memory.expiresAt?.toISOString() || null,
      JSON.stringify(memory.references),
      JSON.stringify(memory.tags),
      memory.importance,
      memory.confidence
    );

    this.logger.debug(`Stored active memory: ${memory.content.substring(0, 50)}...`);
    return memory;
  }

  getActiveMemories(userId: string, limit: number = 20, category?: string): ActiveMemory[] {
    let sql = 'SELECT * FROM active_memories WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))';
    const params: any[] = [userId];

    if (category) {
      sql += ' AND tags LIKE ?';
      params.push(`%${category}%`);
    }

    sql += ' ORDER BY importance DESC, created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.parseActiveMemory(row));
  }

  getRecentContext(userId: string, limit: number = 10): string {
    const memories = this.getActiveMemories(userId, limit);
    return memories.map(m => `[${m.source}] ${m.content}`).join('\n');
  }

  private parseActiveMemory(row: any): ActiveMemory {
    return {
      id: row.id,
      content: row.content,
      context: row.context,
      source: row.source,
      userId: row.user_id,
      sessionId: row.session_id,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      references: JSON.parse(row.references || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      importance: row.importance,
      confidence: row.confidence,
    };
  }

  async runDreamingPhase(userId: string): Promise<DreamEntry> {
    const today = new Date().toISOString().split('T')[0];
    const memories = this.getActiveMemories(userId, 50);

    const lightInsights = this.runLightDreaming(memories);
    const deepInsights = this.runDeepDreaming(memories, lightInsights);
    const remInsights = await this.runREMDreaming(deepInsights);

    const dreamEntry: DreamEntry = {
      id: uuidv4(),
      date: today,
      phase: 'rem',
      insights: [...lightInsights, ...deepInsights, ...remInsights],
      consolidatedFrom: memories.map(m => m.id),
      createdAt: new Date(),
    };

    this.db.prepare(`
      INSERT INTO dream_entries (id, date, phase, insights, consolidated_from)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      dreamEntry.id,
      dreamEntry.date,
      dreamEntry.phase,
      JSON.stringify(dreamEntry.insights),
      JSON.stringify(dreamEntry.consolidatedFrom)
    );

    for (const memId of dreamEntry.consolidatedFrom) {
      this.db.prepare('UPDATE active_memories SET importance = importance * 0.9 WHERE id = ?').run(memId);
    }

    this.logger.info(`Dreaming phase complete for user ${userId}: ${dreamEntry.insights.length} insights`);
    return dreamEntry;
  }

  private runLightDreaming(memories: ActiveMemory[]): string[] {
    const insights: string[] = [];
    const grouped: Record<string, ActiveMemory[]> = {};

    for (const mem of memories) {
      const key = mem.tags.join(',') || 'untagged';
      grouped[key] = grouped[key] || [];
      grouped[key].push(mem);
    }

    for (const [tag, group] of Object.entries(grouped)) {
      if (group.length >= 3) {
        const combined = group.map(m => m.content).join(' ');
        insights.push(`Pattern in ${tag}: ${combined.substring(0, 200)}`);
      }
    }

    return insights;
  }

  private runDeepDreaming(memories: ActiveMemory[], lightInsights: string[]): string[] {
    const insights: string[] = [];
    const highImportance = memories.filter(m => m.importance > 0.7);
    const lowImportance = memories.filter(m => m.importance < 0.3);

    if (highImportance.length > 0) {
      const summary = highImportance
        .slice(0, 5)
        .map(m => m.content)
        .join('; ');
      insights.push(`High-priority context: ${summary.substring(0, 300)}`);
    }

    for (const mem of lowImportance.slice(0, 10)) {
      this.db.prepare('DELETE FROM active_memories WHERE id = ?').run(mem.id);
      insights.push(`Forgotten low-importance memory: ${mem.content.substring(0, 100)}`);
    }

    return insights;
  }

  private async runREMDreaming(insights: string[]): Promise<string[]> {
    return insights.map(i => `REM synthesis: ${i}`).slice(0, 5);
  }

  storeKnowledgeClaim(claim: Omit<KnowledgeClaim, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeClaim {
    const entry: KnowledgeClaim = {
      ...claim,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.db.prepare(`
      INSERT INTO knowledge_claims (id, claim, evidence, contradictions, freshness, source, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.claim,
      JSON.stringify(entry.evidence),
      JSON.stringify(entry.contradictions),
      entry.freshness,
      entry.source,
      entry.verified ? 1 : 0
    );

    return entry;
  }

  getKnowledgeClaims(verified?: boolean): KnowledgeClaim[] {
    let sql = 'SELECT * FROM knowledge_claims ORDER BY freshness DESC';
    const params: any[] = [];

    if (verified !== undefined) {
      sql += ' WHERE verified = ?';
      params.push(verified ? 1 : 0);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.parseKnowledgeClaim(row));
  }

  private parseKnowledgeClaim(row: any): KnowledgeClaim {
    return {
      id: row.id,
      claim: row.claim,
      evidence: JSON.parse(row.evidence || '[]'),
      contradictions: JSON.parse(row.contradictions || '[]'),
      freshness: row.freshness,
      source: row.source,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      verified: row.verified === 1,
    };
  }

  detectContradictions(newClaim: string): KnowledgeClaim[] {
    const existing = this.getKnowledgeClaims();
    return existing.filter(kc => {
      const words = new Set(newClaim.toLowerCase().split(' '));
      const claimWords = new Set(kc.claim.toLowerCase().split(' '));
      const overlap = [...words].filter(w => claimWords.has(w)).length;
      return overlap > 3 && kc.verified;
    });
  }

  storeMemoryGraph(node: Omit<MemoryGraph, 'nodeId'>): MemoryGraph {
    const graphNode: MemoryGraph = {
      ...node,
      nodeId: uuidv4(),
    };

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_graph (id, node_id, label, content, category, edges)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      graphNode.nodeId,
      graphNode.label,
      graphNode.content,
      graphNode.category,
      JSON.stringify(graphNode.edges)
    );

    return graphNode;
  }

  getRelatedMemories(nodeId: string, depth: number = 1): MemoryGraph[] {
    const rows = this.db.prepare('SELECT * FROM memory_graph WHERE node_id = ?').all(nodeId) as any[];
    if (rows.length === 0) return [];

    const node = rows[0];
    const edges = JSON.parse(node.edges || '[]');

    if (depth <= 1 || edges.length === 0) {
      return [this.parseMemoryGraph(node)];
    }

    const results = [this.parseMemoryGraph(node)];

    for (const edge of edges) {
      const related = this.getRelatedMemories(edge.targetId, depth - 1);
      results.push(...related);
    }

    return results;
  }

  private parseMemoryGraph(row: any): MemoryGraph {
    return {
      nodeId: row.node_id,
      label: row.label,
      content: row.content,
      category: row.category,
      edges: JSON.parse(row.edges || '[]'),
    };
  }

  updateUserProfile(userId: string, profile: Record<string, any>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO user_profiles (id, user_id, profile_json, last_updated)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(uuidv4(), userId, JSON.stringify(profile));
  }

  getUserProfile(userId: string): Record<string, any> | null {
    const row = this.db.prepare('SELECT profile_json FROM user_profiles WHERE user_id = ?').get(userId) as any;
    if (!row) return null;
    return JSON.parse(row.profile_json);
  }

  storeConversationThread(
    userId: string,
    topic: string,
    summary: string,
    keyPoints: string[],
    sentiment?: string
  ): void {
    this.db.prepare(`
      INSERT INTO conversation_threads (id, user_id, topic, summary, key_points, sentiment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, topic, summary, JSON.stringify(keyPoints), sentiment);
  }

  getRecentThreads(userId: string, limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM conversation_threads 
      WHERE user_id = ? 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(userId, limit);
  }

  cleanupExpiredMemories(): number {
    const result = this.db.prepare(`
      DELETE FROM active_memories 
      WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
    return result.changes;
  }

  decayLowImportanceMemories(daysOld: number = 7, threshold: number = 0.2): number {
    const result = this.db.prepare(`
      UPDATE active_memories 
      SET importance = importance * 0.8 
      WHERE importance < ? AND created_at < date('now', ?)
    `).run(threshold, `-${daysOld} days`);
    return result.changes;
  }

  getStats(): any {
    const activeCount = this.db.prepare('SELECT COUNT(*) as count FROM active_memories').get() as any;
    const dreamCount = this.db.prepare('SELECT COUNT(*) as count FROM dream_entries').get() as any;
    const claimCount = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_claims').get() as any;
    const graphCount = this.db.prepare('SELECT COUNT(*) as count FROM memory_graph').get() as any;
    const profileCount = this.db.prepare('SELECT COUNT(*) as count FROM user_profiles').get() as any;

    return {
      activeMemories: activeCount.count,
      dreamEntries: dreamCount.count,
      knowledgeClaims: claimCount.count,
      memoryGraphNodes: graphCount.count,
      userProfiles: profileCount.count,
      shortTermBuffer: this.shortTermBuffer.length,
    };
  }

  private consolidateShortTermBuffer(): void {
    if (this.shortTermBuffer.length < 10) return;

    const toPersist = this.shortTermBuffer
      .filter(m => m.importance > 0.5)
      .slice(0, 20);

    for (const mem of toPersist) {
      this.logger.debug(`Consolidating memory: ${mem.content.substring(0, 50)}`);
    }

    this.shortTermBuffer = this.shortTermBuffer.slice(-20);
  }

  close(): void {
    this.db.close();
  }
}
