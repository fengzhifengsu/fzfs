import { v4 as uuidv4 } from 'uuid';

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
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private maxSessions: number = 1000;
  private maxMessagesPerSession: number = 100;

  getOrCreateSession(sessionId: string, channel: string = 'web'): Session {
    let session = this.sessions.get(sessionId);
    
    if (!session) {
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
    }

    session.isActive = true;
    session.updatedAt = new Date();
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
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
      const systemMessages = session.messages.filter(m => m.role === 'system');
      const recentMessages = session.messages.slice(-this.maxMessagesPerSession + systemMessages.length);
      session.messages = [...systemMessages, ...recentMessages];
    }

    return fullMessage;
  }

  getSessionHistory(sessionId: string, limit?: number): Message[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    
    if (limit) {
      return session.messages.slice(-limit);
    }
    return session.messages;
  }

  clearSessionHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const systemMessages = session.messages.filter(m => m.role === 'system');
      session.messages = systemMessages;
    }
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
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

  setMaxSessions(max: number): void {
    this.maxSessions = max;
  }

  setMaxMessagesPerSession(max: number): void {
    this.maxMessagesPerSession = max;
  }
}
