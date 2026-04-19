import { Message } from '../gateway/session';
import { getLogger } from '../utils/logger';
import OpenAI from 'openai';

export interface ContextConfig {
  maxMessages: number;
  maxTokens: number;
  maxChars: number;
  summaryThreshold: number;
  summaryKeepRatio: number;
  charsPerToken: number;
  enableLLMSummary: boolean;
  systemPromptPriority: 'always_keep' | 'can_trim';
}

export interface ContextStats {
  messageCount: number;
  charCount: number;
  estimatedTokens: number;
  summaryCount: number;
  lastOptimized: Date | null;
}

const DEFAULT_CONFIG: ContextConfig = {
  maxMessages: 50,
  maxTokens: 8000,
  maxChars: 40000,
  summaryThreshold: 30,
  summaryKeepRatio: 0.6,
  charsPerToken: 4,
  enableLLMSummary: true,
  systemPromptPriority: 'always_keep',
};

export class ContextManager {
  private config: ContextConfig;
  private logger: any;
  private summaries: Map<string, string> = new Map();
  private optimizationHistory: Map<string, Date> = new Map();
  private openai: OpenAI | null = null;
  private modelName: string = '';

  constructor(config?: Partial<ContextConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = getLogger();
  }

  setLLMClient(client: OpenAI, modelName: string): void {
    this.openai = client;
    this.modelName = modelName;
  }

  analyze(messages: Message[]): ContextStats {
    const nonSystem = messages.filter(m => m.role !== 'system');
    const charCount = nonSystem.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.ceil(charCount / this.config.charsPerToken);

    return {
      messageCount: nonSystem.length,
      charCount,
      estimatedTokens,
      summaryCount: this.summaries.size,
      lastOptimized: null,
    };
  }

  shouldOptimize(messages: Message[]): boolean {
    const stats = this.analyze(messages);
    const statsCopy = { ...stats, lastOptimized: this.getLastOptimizationTime() };
    
    if (stats.messageCount >= this.config.maxMessages) return true;
    if (stats.charCount >= this.config.maxChars) return true;
    if (stats.estimatedTokens >= this.config.maxTokens) return true;
    if (stats.messageCount >= this.config.summaryThreshold && !this.summaries.has('default')) return true;
    
    return false;
  }

  private getLastOptimizationTime(): Date | null {
    if (this.optimizationHistory.size === 0) return null;
    const times = Array.from(this.optimizationHistory.values());
    return times[times.length - 1];
  }

  async optimize(messages: Message[], sessionId: string = 'default'): Promise<Message[]> {
    const stats = this.analyze(messages);
    this.logger.info(`Context optimization triggered: ${stats.messageCount} messages, ${stats.charCount} chars, ~${stats.estimatedTokens} tokens`);

    let optimized = [...messages];
    optimized = this.applyPriorityFilter(optimized);
    optimized = this.applySizeLimit(optimized);

    if (optimized.length > this.config.maxMessages * this.config.summaryKeepRatio) {
      optimized = await this.applySummarization(optimized, sessionId);
    }

    this.optimizationHistory.set(sessionId, new Date());
    return optimized;
  }

  private applyPriorityFilter(messages: Message[]): Message[] {
    const systemMessages = messages.filter(m => m.role === 'system');
    const toolMessages = messages.filter(m => m.role === 'tool');
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    if (this.config.systemPromptPriority === 'always_keep') {
      const nonSystem = [...toolMessages, ...userMessages, ...assistantMessages];
      return [...systemMessages, ...nonSystem];
    }

    return messages;
  }

  private applySizeLimit(messages: Message[]): Message[] {
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    let result = [...systemMessages];
    const maxNonSystem = this.config.maxMessages - systemMessages.length;

    if (nonSystem.length <= maxNonSystem) {
      return [...result, ...nonSystem];
    }

    let charCount = systemMessages.reduce((sum, m) => sum + m.content.length, 0);
    const selected: Message[] = [];

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      if (selected.length >= maxNonSystem) break;
      if (charCount + msg.content.length > this.config.maxChars && selected.length > 0) break;

      selected.unshift(msg);
      charCount += msg.content.length;
    }

    this.logger.debug(`Trimmed from ${nonSystem.length} to ${selected.length} messages`);
    return [...result, ...selected];
  }

  private async applySummarization(messages: Message[], sessionId: string): Promise<Message[]> {
    if (this.summaries.has(sessionId)) {
      return this.injectSummary(messages, sessionId);
    }

    if (this.config.enableLLMSummary && this.openai) {
      return this.generateLLMSummary(messages, sessionId);
    }

    return this.generateSimpleSummary(messages, sessionId);
  }

  private generateSimpleSummary(messages: Message[], sessionId: string): Message[] {
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    const keepCount = Math.floor(nonSystem.length * this.config.summaryKeepRatio);

    const messagesToSummarize = nonSystem.slice(0, -keepCount);
    const recentMessages = nonSystem.slice(-keepCount);

    const summary = this.buildSimpleSummaryText(messagesToSummarize);
    this.summaries.set(sessionId, summary);

    const summaryMessage: Message = {
      id: `summary-${sessionId}-${Date.now()}`,
      role: 'system',
      content: `[Previous conversation summary]\n${summary}`,
      timestamp: new Date(),
    };

    return [...systemMessages, summaryMessage, ...recentMessages];
  }

  private buildSimpleSummaryText(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    const topics: string[] = [];
    
    for (const msg of userMessages.slice(0, 5)) {
      const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
      topics.push(`User: ${preview}`);
    }

    if (assistantMessages.length > 0) {
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const preview = lastAssistant.content.substring(0, 100).replace(/\n/g, ' ');
      topics.push(`Last response: ${preview}`);
    }

    return topics.join('\n');
  }

  private async generateLLMSummary(messages: Message[], sessionId: string): Promise<Message[]> {
    try {
      const systemMessages = messages.filter(m => m.role === 'system');
      const nonSystem = messages.filter(m => m.role !== 'system');
      const keepCount = Math.floor(nonSystem.length * this.config.summaryKeepRatio);
      const messagesToSummarize = nonSystem.slice(0, -keepCount);
      const recentMessages = nonSystem.slice(-keepCount);

      const conversationText = messagesToSummarize
        .map(m => {
          const prefix = m.role === 'user' ? '用户' : '助手';
          return `${prefix}: ${m.content}`;
        })
        .join('\n\n');

      const response = await this.openai!.chat.completions.create({
        model: this.modelName,
        messages: [
          {
            role: 'system',
            content: '你是一个对话摘要助手。请将以下对话内容压缩成简洁的摘要，保留关键信息、用户需求和重要结论。摘要应控制在200字以内，使用中文。',
          },
          {
            role: 'user',
            content: `请总结以下对话的关键内容：\n\n${conversationText}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      const summary = response.choices[0]?.message?.content || this.buildSimpleSummaryText(messagesToSummarize);
      this.summaries.set(sessionId, summary);

      this.logger.info(`LLM summary generated: ${summary.substring(0, 50)}...`);

      const summaryMessage: Message = {
        id: `summary-${sessionId}-${Date.now()}`,
        role: 'system',
        content: `[Previous conversation summary]\n${summary}`,
        timestamp: new Date(),
      };

      return [...systemMessages, summaryMessage, ...recentMessages];
    } catch (error) {
      this.logger.warn(`LLM summary generation failed, falling back to simple summary: ${error}`);
      return this.generateSimpleSummary(messages, sessionId);
    }
  }

  private injectSummary(messages: Message[], sessionId: string): Message[] {
    const summary = this.summaries.get(sessionId);
    if (!summary) return messages;

    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const summaryMessage: Message = {
      id: `summary-${sessionId}-${Date.now()}`,
      role: 'system',
      content: `[Previous conversation summary]\n${summary}`,
      timestamp: new Date(),
    };

    return [...systemMessages, summaryMessage, ...nonSystem];
  }

  clearSummary(sessionId: string): void {
    this.summaries.delete(sessionId);
    this.logger.debug(`Cleared summary for session: ${sessionId}`);
  }

  clearAllSummaries(): void {
    this.summaries.clear();
    this.logger.debug('Cleared all summaries');
  }

  getConfig(): ContextConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
