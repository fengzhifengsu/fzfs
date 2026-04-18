import { AgentConfig } from '../config/types';
import { Message, ToolCall } from '../gateway/session';
import { ToolManager } from '../tools';
import { getLogger } from '../utils/logger';
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const DEFAULT_TIMEOUT = 120000;
const MAX_TOOL_CALL_ITERATIONS = 5;

export class Agent {
  private config: AgentConfig;
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private logger: any;

  constructor(config: AgentConfig) {
    this.config = config;
    this.logger = getLogger();
    this.initializeClient();
  }

  private initializeClient(): void {
    switch (this.config.model.provider) {
      case 'openai':
        this.openai = new OpenAI({
          apiKey: this.config.model.apiKey,
          baseURL: this.config.model.baseUrl || undefined,
          timeout: DEFAULT_TIMEOUT,
          maxRetries: 2,
        });
        break;
      case 'anthropic':
        this.anthropic = new Anthropic({
          apiKey: this.config.model.apiKey,
          baseURL: this.config.model.baseUrl || undefined,
          timeout: DEFAULT_TIMEOUT,
          maxRetries: 2,
        });
        break;
      case 'ollama':
        this.openai = new OpenAI({
          apiKey: 'ollama',
          baseURL: this.config.model.baseUrl || 'http://localhost:11434/v1',
          timeout: DEFAULT_TIMEOUT,
          maxRetries: 1,
        });
        break;
      default:
        this.openai = new OpenAI({
          apiKey: this.config.model.apiKey,
          baseURL: this.config.model.baseUrl,
          timeout: DEFAULT_TIMEOUT,
        });
    }
  }

  async generateResponse(history: Message[], toolManager?: ToolManager): Promise<AgentResponse> {
    if (!this.openai && !this.anthropic) {
      throw new Error('No AI client initialized');
    }

    const messages = this.buildMessages(history);

    if (this.anthropic) {
      return this.generateAnthropicResponse(messages, toolManager);
    }

    return this.generateOpenAIResponse(messages, toolManager);
  }

  async generateStreamResponse(
    history: Message[],
    toolManager: ToolManager | undefined,
    onChunk: (chunk: string) => void
  ): Promise<AgentResponse> {
    if (!this.openai && !this.anthropic) {
      throw new Error('No AI client initialized');
    }

    const messages = this.buildMessages(history);

    if (this.anthropic) {
      return this.generateAnthropicStreamResponse(messages, toolManager, onChunk);
    }

    return this.generateOpenAIStreamResponse(messages, toolManager, onChunk);
  }

  private buildMessages(history: Message[]): any[] {
    const messages = history.map(msg => {
      const base = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          ...base,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }

      if (msg.role === 'tool' && msg.toolResults && msg.toolResults.length > 0) {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolResults[0].toolCallId,
        };
      }

      return base;
    });

    const totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalLength > 100000) {
      this.logger.warn(`Large message payload: ${totalLength} chars, trimming older messages`);
      while (messages.length > 5 && messages.reduce((s, m) => s + m.content.length, 0) > 80000) {
        const idx = messages.findIndex((m: any) => m.role !== 'system');
        if (idx >= 0) messages.splice(idx, 1);
        else break;
      }
    }

    return messages;
  }

  private async generateOpenAIResponse(messages: any[], toolManager?: ToolManager): Promise<AgentResponse> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    const params: any = {
      model: this.config.model.name,
      messages: [
        { role: 'system', content: this.config.systemPrompt },
        ...messages,
      ],
      temperature: this.config.temperature,
      max_tokens: Math.min(this.config.maxTokens, 4096),
    };

    if (toolManager) {
      params.tools = toolManager.getToolDefinitions().map((tool: any) => ({
        type: 'function',
        function: tool,
      }));
      params.tool_choice = 'auto';
    } else {
      params.tools = [];
    }

    const response = await this.openai.chat.completions.create(params);
    const choice = response.choices[0];
    const message = choice.message;

    const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: message.content || '',
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }

  private async generateOpenAIStreamResponse(
    messages: any[],
    toolManager: ToolManager | undefined,
    onChunk: (chunk: string) => void
  ): Promise<AgentResponse> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    const params: any = {
      model: this.config.model.name,
      messages: [
        { role: 'system', content: this.config.systemPrompt },
        ...messages,
      ],
      temperature: this.config.temperature,
    };

    if (toolManager) {
      params.tools = toolManager.getToolDefinitions().map((tool: any) => ({
        type: 'function',
        function: tool,
      }));
    } else {
      params.tools = [];
    }

    const response = await this.openai.chat.completions.create(params);
    const fullContent = response.choices[0]?.message?.content || '';
    onChunk(fullContent);

    return { content: fullContent };
  }

  private async generateAnthropicResponse(messages: any[], toolManager?: ToolManager): Promise<AgentResponse> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const params: any = {
      model: this.config.model.name,
      max_tokens: Math.min(this.config.maxTokens, 4096),
      temperature: this.config.temperature,
      system: this.config.systemPrompt,
      messages: messages.filter(m => m.role !== 'system'),
    };

    if (toolManager) {
      params.tools = toolManager.getToolDefinitions();
    }

    const response = await this.anthropic.messages.create(params);

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content as any[]) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private async generateAnthropicStreamResponse(
    messages: any[],
    toolManager: ToolManager | undefined,
    onChunk: (chunk: string) => void
  ): Promise<AgentResponse> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const params: any = {
      model: this.config.model.name,
      max_tokens: Math.min(this.config.maxTokens, 4096),
      temperature: this.config.temperature,
      system: this.config.systemPrompt,
      messages: messages.filter(m => m.role !== 'system'),
    };

    if (toolManager) {
      params.tools = toolManager.getToolDefinitions();
    }

    const stream = await this.anthropic.messages.stream(params);
    let fullContent = '';

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullContent += chunk.delta.text;
        onChunk(chunk.delta.text);
      }
    }

    return { content: fullContent };
  }

  getMaxToolCallIterations(): number {
    return MAX_TOOL_CALL_ITERATIONS;
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.model) {
      this.initializeClient();
    }
  }
}
