import { Session, Message, ToolCall } from './session';
import { Agent } from '../agent';
import { ToolManager } from '../tools';
import { EnhancedMemory } from '../memory/enhanced-memory';
import { MemorySystem } from '../memory';
import { AutoSkillCreator } from '../skills/auto-creator';
import { SelfConfig } from '../config/self-config';
import { getLogger } from '../utils/logger';

export class MessageHandler {
  private sessionManager: any;
  private agent: Agent | null = null;
  private toolManager: ToolManager;
  private enhancedMemory: EnhancedMemory | null = null;
  private basicMemory: MemorySystem | null = null;
  private autoSkillCreator: AutoSkillCreator | null = null;
  private selfConfig: SelfConfig | null = null;
  private logger: any;
  private experienceTracker: Map<string, { prompt: string; tools: string[]; success: boolean }[]> = new Map();

  constructor(sessionManager: any) {
    this.sessionManager = sessionManager;
    this.toolManager = new ToolManager();
    this.logger = getLogger();
  }

  setEnhancedMemory(memory: EnhancedMemory): void {
    this.enhancedMemory = memory;
  }

  setBasicMemory(memory: MemorySystem): void {
    this.basicMemory = memory;
  }

  setAutoSkillCreator(creator: AutoSkillCreator): void {
    this.autoSkillCreator = creator;
  }

  setSelfConfig(selfConfig: SelfConfig): void {
    this.selfConfig = selfConfig;
  }

  async initialize(agent: Agent): Promise<void> {
    this.agent = agent;
    if (this.selfConfig) {
      await this.toolManager.initialize(this.basicMemory || undefined, this.selfConfig);
    } else {
      await this.toolManager.initialize(this.basicMemory || undefined);
    }
  }

  async handleMessage(session: Session, content: string): Promise<string> {
    this.logger.info(`Handling message for session ${session.id}`);

    await this.enrichContext(session);

    this.sessionManager.addMessage(session.id, {
      role: 'user',
      content,
    });

    const history = this.sessionManager.getSessionHistory(session.id, 20);

    if (!this.agent) {
      return 'Agent not initialized. Please configure your API key.';
    }

    try {
      const response = await this.agent.generateResponse(history, this.toolManager);

      this.sessionManager.addMessage(session.id, {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      const toolNames: string[] = [];
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const result = await this.toolManager.executeTool(toolCall);
          toolNames.push(toolCall.name);

          this.sessionManager.addMessage(session.id, {
            role: 'tool',
            content: result.content,
            toolResults: [{
              toolCallId: toolCall.id,
              content: result.content,
              success: result.success,
            }],
          });
        }

        const followUp = await this.agent.generateResponse(
          this.sessionManager.getSessionHistory(session.id, 30),
          this.toolManager
        );

        await this.recordExperience(session, content, toolNames, true, followUp.content);
        await this.storeEnhancedMemory(session, content, followUp.content, toolNames);

        return followUp.content;
      }

      await this.recordExperience(session, content, toolNames, true, response.content);
      await this.storeEnhancedMemory(session, content, response.content, toolNames);

      return response.content;
    } catch (error) {
      this.logger.error('Error generating response:', error);
      await this.recordExperience(session, content, [], false, 'Error occurred');
      return 'Sorry, I encountered an error processing your request.';
    }
  }

  private async enrichContext(session: Session): Promise<void> {
    if (this.enhancedMemory) {
      const context = this.enhancedMemory.getRecentContext(session.userId, 5);
      if (context) {
        session.metadata.recentContext = context;
      }
    }

    if (this.basicMemory) {
      const prefs = this.basicMemory.getUserPreferences(session.userId);
      if (prefs.length > 0) {
        session.metadata.preferences = prefs;
      }
    }
  }

  private async recordExperience(
    session: Session,
    prompt: string,
    toolNames: string[],
    success: boolean,
    response: string
  ): Promise<void> {
    if (!this.autoSkillCreator) return;

    const tracked = this.experienceTracker.get(session.userId) || [];
    tracked.push({ prompt, tools: toolNames, success });
    this.experienceTracker.set(session.userId, tracked);

    this.autoSkillCreator.recordExperience(prompt, response, toolNames, success, session.channel);
  }

  private async storeEnhancedMemory(
    session: Session,
    userMessage: string,
    agentResponse: string,
    toolNames: string[]
  ): Promise<void> {
    if (!this.enhancedMemory) return;

    this.enhancedMemory.storeActiveMemory({
      content: userMessage,
      context: agentResponse,
      source: 'conversation',
      userId: session.userId,
      sessionId: session.id,
      expiresAt: null,
      references: [],
      tags: toolNames,
      importance: 0.5,
      confidence: 0.8,
    });
  }

  async handleStreamMessage(
    session: Session,
    content: string,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    this.logger.info(`Handling stream message for session ${session.id}`);

    this.sessionManager.addMessage(session.id, {
      role: 'user',
      content,
    });

    const history = this.sessionManager.getSessionHistory(session.id, 20);

    if (!this.agent) {
      onChunk('Agent not initialized.');
      return;
    }

    try {
      let fullContent = '';
      await this.agent.generateStreamResponse(history, this.toolManager, (chunk) => {
        fullContent += chunk;
        onChunk(chunk);
      });

      this.sessionManager.addMessage(session.id, {
        role: 'assistant',
        content: fullContent,
      });

      await this.storeEnhancedMemory(session, content, fullContent, []);
    } catch (error) {
      this.logger.error('Error in stream response:', error);
      onChunk('\n[Error generating response]');
    }
  }
}
