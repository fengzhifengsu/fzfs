import { Session, Message } from './session';
import { Agent } from '../agent';
import { ToolManager } from '../tools';
import { EnhancedMemory } from '../memory/enhanced-memory';
import { MemorySystem } from '../memory';
import { MemoryManager } from '../memory/memory-manager';
import { AutoSkillCreator } from '../skills/auto-creator';
import { SelfConfig } from '../config/self-config';
import { getLogger } from '../utils/logger';

const TOOL_CALL_TIMEOUT = 60000;
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;
const MEMORY_IMPORTANCE_THRESHOLD = 0.4;

export class MessageHandler {
  private sessionManager: any;
  private agent: Agent | null = null;
  private toolManager: ToolManager;
  private enhancedMemory: EnhancedMemory | null = null;
  private basicMemory: MemorySystem | null = null;
  private memoryManager: MemoryManager | null = null;
  private autoSkillCreator: AutoSkillCreator | null = null;
  private selfConfig: SelfConfig | null = null;
  private logger: any;
  private errorCounters: Map<string, number> = new Map();

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

  setMemoryManager(memoryManager: MemoryManager): void {
    this.memoryManager = memoryManager;
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
    this.logger.info(`Handling message for session ${session.id} from ${session.channel}`);

    await this.enrichContext(session);

    this.sessionManager.addMessage(session.id, {
      role: 'user',
      content,
    });

    if (!this.agent) {
      return 'Agent not initialized. Please configure your API key via "kele onboard".';
    }

    let iterationCount = 0;
    const maxIterations = this.agent.getMaxToolCallIterations();
    const toolCallHistory: string[] = [];
    let consecutiveErrors = 0;
    let finalResponse = '';

    try {
      while (iterationCount <= maxIterations) {
        const history = this.sessionManager.getSessionHistory(session.id, 30);
        const response = await this.agent.generateResponse(history, this.toolManager);

        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalResponse = response.content;
          break;
        }

        this.sessionManager.addMessage(session.id, {
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          const toolKey = `${toolCall.name}:${toolCall.arguments.substring(0, 100)}`;
          if (toolCallHistory.includes(toolKey)) {
            this.logger.warn(`Detected tool call loop: ${toolKey}`);
            finalResponse = 'I detected that I was about to repeat a task. Let me provide a summary instead.';
            iterationCount = maxIterations;
            break;
          }
          toolCallHistory.push(toolKey);

          const result = await this.executeToolWithTimeout(toolCall);
          consecutiveErrors = result.success ? 0 : consecutiveErrors + 1;

          this.sessionManager.addMessage(session.id, {
            role: 'tool',
            content: result.content,
            toolResults: [{
              toolCallId: toolCall.id,
              content: result.content,
              success: result.success,
            }],
          });

          if (consecutiveErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            this.logger.error(`Too many consecutive tool errors (${consecutiveErrors}), stopping`);
            finalResponse = 'I encountered multiple errors while processing your request. Please try rephrasing or try a different approach.';
            iterationCount = maxIterations;
            break;
          }
        }

        iterationCount++;
      }

      if (!finalResponse && iterationCount > maxIterations) {
        finalResponse = 'I have completed the task within the available iterations.';
      }

      await this.recordExperience(session, content, finalResponse, iterationCount > 0, []);
      await this.storeMemories(session, content, finalResponse);

      return finalResponse;
    } catch (error: any) {
      this.logger.error('Error generating response:', error);
      await this.recordExperience(session, content, 'Error occurred', false, []);
      return `Sorry, I encountered an error: ${error.message}`;
    }
  }

  private async executeToolWithTimeout(toolCall: any): Promise<any> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          toolCallId: toolCall.id,
          content: `Tool "${toolCall.name}" timed out after ${TOOL_CALL_TIMEOUT / 1000}s. The operation took too long.`,
          success: false,
        });
      }, TOOL_CALL_TIMEOUT);

      this.toolManager.executeTool(toolCall)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timeout);
          resolve({
            toolCallId: toolCall.id,
            content: `Tool "${toolCall.name}" error: ${error.message}`,
            success: false,
          });
        });
    });
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

    if (this.memoryManager) {
      const recentMemories = this.memoryManager.getRecentContext(session.userId, 5);
      if (recentMemories) {
        session.metadata.recentMemories = recentMemories;
      }
    }

    const sessionData = this.sessionManager.getSession(session.id);
    if (sessionData?.summary) {
      this.logger.debug(`Session ${session.id} has summary: ${sessionData.summary.substring(0, 50)}...`);
    }
  }

  private async recordExperience(
    session: Session,
    prompt: string,
    response: string,
    success: boolean,
    toolNames: string[]
  ): Promise<void> {
    if (!this.autoSkillCreator) return;

    this.autoSkillCreator.recordExperience(
      prompt,
      response.substring(0, 500),
      toolNames,
      success,
      session.channel
    );
  }

  private async storeMemories(
    session: Session,
    userMessage: string,
    agentResponse: string
  ): Promise<void> {
    const isImportant = userMessage.length > 50 ||
      this.detectImportantContent(userMessage) ||
      this.detectImportantContent(agentResponse);

    if (this.memoryManager) {
      this.memoryManager.extractFacts(userMessage, session.userId, session.id);
      
      if (isImportant) {
        const summary = `用户: ${userMessage.substring(0, 200)}\n回复: ${agentResponse.substring(0, 200)}`;
        this.memoryManager.store({
          key: `conv:${session.id}:${Date.now()}`,
          value: summary,
          category: session.channel,
          tags: isImportant ? ['important', 'conversation'] : ['conversation'],
          importance: isImportant ? 0.7 : MEMORY_IMPORTANCE_THRESHOLD,
          confidence: 0.8,
          userId: session.userId,
          sessionId: session.id,
          source: 'auto_extract',
          expiresAt: null,
        });
      }
    }

    if (this.basicMemory) {
      const key = `msg:${session.id}:${Date.now()}`;
      this.basicMemory.storeMemory({
        key,
        value: `User: ${userMessage.substring(0, 200)}\nAgent: ${agentResponse.substring(0, 200)}`,
        category: session.channel,
        tags: isImportant ? ['important'] : [],
        importance: isImportant ? 0.7 : MEMORY_IMPORTANCE_THRESHOLD,
      });
    }

    if (this.enhancedMemory) {
      this.enhancedMemory.storeActiveMemory({
        content: userMessage,
        context: agentResponse,
        source: 'conversation',
        userId: session.userId,
        sessionId: session.id,
        expiresAt: null,
        references: [],
        tags: isImportant ? ['important'] : [],
        importance: isImportant ? 0.7 : MEMORY_IMPORTANCE_THRESHOLD,
        confidence: 0.8,
      });
    }
  }

  private detectImportantContent(content: string): boolean {
    const importantKeywords = [
      'remember', 'forget', 'important', 'save', 'note', 'todo',
      '记住', '忘记', '重要', '保存', '笔记', '任务',
      'password', 'username', 'email', 'phone', 'address',
      '喜欢', '偏好', '不喜欢', '习惯',
    ];
    const lower = content.toLowerCase();
    return importantKeywords.some(kw => lower.includes(kw));
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

    if (!this.agent) {
      onChunk('Agent not initialized.');
      return;
    }

    try {
      let fullContent = '';
      await this.agent.generateStreamResponse(
        this.sessionManager.getSessionHistory(session.id, 30),
        this.toolManager,
        (chunk) => {
          fullContent += chunk;
          onChunk(chunk);
        }
      );

      this.sessionManager.addMessage(session.id, {
        role: 'assistant',
        content: fullContent,
      });

      await this.storeMemories(session, content, fullContent);
    } catch (error) {
      this.logger.error('Error in stream response:', error);
      onChunk('\n[Error generating response]');
    }
  }
}
