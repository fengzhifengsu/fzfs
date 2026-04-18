import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { getLogger } from '../utils/logger';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  success: boolean;
}

export interface Session {
  id: string;
  channel: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
  isActive: boolean;
  summary?: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private db: Database.Database;
  private logger: any;
  private maxInMemorySessions: number = 200;
  private maxMessagesPerSession: number = 50;
  private sessionTTL: number = 2592000000;

  constructor(dbPath: string = './data/sessions.db') {
    this.logger = getLogger();
    const dir = path.dirname(dbPath);
    fs.ensureDirSync(dir);
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        summary TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_results TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    `);
  }

  getOrCreateSession(sessionId: string, channel: string = 'web'): Session {
    let session = this.sessions.get(sessionId);

    if (session) {
      session.isActive = true;
      session.updatedAt = new Date();
      return session;
    }

    const loadedSession = this.loadSessionFromDB(sessionId);
    if (loadedSession) {
      session = loadedSession;
      session.isActive = true;
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      return session;
    }

    session = {
      id: sessionId,
      channel,
      userId: sessionId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      isActive: true,
    };

    this.sessions.set(sessionId, session);
    this.saveSessionToDB(session);

    return session;
  }

  private loadSessionFromDB(sessionId: string): Session | null {
    const sessionRow = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
    if (!sessionRow) return null;

    const messageRows = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    const messages: Message[] = messageRows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: new Date(row.timestamp),
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
    }));

    return {
      id: sessionRow.id,
      channel: sessionRow.channel,
      userId: sessionRow.user_id,
      messages,
      createdAt: new Date(sessionRow.created_at),
      updatedAt: new Date(sessionRow.updated_at),
      metadata: {},
      isActive: sessionRow.is_active === 1,
      summary: sessionRow.summary || undefined,
    };
  }

  private saveSessionToDB(session: Session): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, channel, user_id, summary, updated_at, is_active)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(session.id, session.channel, session.userId, session.summary || null, session.isActive ? 1 : 0);
  }

  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fullMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date(),
    };

    session.messages.push(fullMessage);
    session.updatedAt = new Date();

    if (session.messages.length > this.maxMessagesPerSession) {
      this.summarizeAndTruncate(session);
    }

    this.saveMessageToDB(sessionId, fullMessage);
    this.db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);

    return fullMessage;
  }

  private summarizeAndTruncate(session: Session): void {
    const nonSystemMessages = session.messages.filter(m => m.role !== 'system');
    const systemMessages = session.messages.filter(m => m.role === 'system');

    if (!session.summary && nonSystemMessages.length > this.maxMessagesPerSession * 0.6) {
      const earlyMessages = nonSystemMessages.slice(0, Math.floor(this.maxMessagesPerSession * 0.5));
      session.summary = this.generateSimpleSummary(earlyMessages);
      this.db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(session.summary, session.id);
    }

    const keepCount = Math.floor(this.maxMessagesPerSession * 0.7);
    const recentMessages = nonSystemMessages.slice(-keepCount);

    if (systemMessages.length > 0) {
      session.messages = [...systemMessages, ...recentMessages];
    } else {
      session.messages = recentMessages;
    }
  }

  private generateSimpleSummary(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const topics = userMessages.slice(0, 5).map(m => {
      const text = m.content.substring(0, 100);
      return text;
    });
    return `Previous conversation covered: ${topics.join('; ')}`;
  }

  private saveMessageToDB(sessionId: string, message: Message): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, session_id, role, content, tool_calls, tool_results, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.timestamp.toISOString()
    );
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionHistory(sessionId: string, limit?: number): Message[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const messages = limit ? session.messages.slice(-limit) : session.messages;

    if (session.summary && messages.length > 5) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg) {
        systemMsg.content += `\n\n[Previous conversation summary]\n${session.summary}`;
      } else {
        messages.unshift({
          id: uuidv4(),
          role: 'system',
          content: `[Previous conversation summary]\n${session.summary}`,
          timestamp: new Date(),
        });
      }
    }

    return messages;
  }

  clearSessionHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.summary = undefined;
      session.messages = session.messages.filter(m => m.role === 'system');
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      this.db.prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
    }
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
      this.db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);
      return true;
    }
    return false;
  }

  clearAllSessions(): void {
    this.sessions.forEach(session => {
      session.isActive = false;
    });
    this.sessions.clear();
  }

  cleanupOldSessions(): number {
    const cutoffDate = new Date(Date.now() - this.sessionTTL).toISOString();
    const oldSessions = this.db.prepare('SELECT id FROM sessions WHERE updated_at < ? AND is_active = 0').all(cutoffDate) as any[];
    let count = 0;
    for (const s of oldSessions) {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      count++;
    }
    return count;
  }

  getActiveSessions(): number {
    let count = 0;
    this.sessions.forEach(session => {
      if (session.isActive) count++;
    });
    return count;
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionsByChannel(channel: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.channel === channel);
  }

  getSessionsByUser(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId);
  }

  setMaxInMemorySessions(max: number): void {
    this.maxInMemorySessions = max;
  }

  setMaxMessagesPerSession(max: number): void {
    this.maxMessagesPerSession = max;
  }

  close(): void {
    this.db.close();
  }
}
