import { BaseTool, ToolResult, FileTool, TerminalTool, WebSearchTool, WebFetchTool, MemoryTool, ToolDefinition, ToolCall } from './tools';
import { BrowserTool } from './browser';
import { SelfConfigTool } from './self-config';
import { MemorySystem } from '../memory';
import { SelfConfig } from '../config/self-config';
import { getLogger } from '../utils/logger';

export class ToolManager {
  private tools: Map<string, BaseTool> = new Map();
  private logger: any;

  constructor() {
    this.logger = getLogger();
  }

  async initialize(memorySystem?: MemorySystem, selfConfig?: SelfConfig): Promise<void> {
    this.registerTool(new FileTool());
    this.registerTool(new TerminalTool());
    this.registerTool(new WebSearchTool());
    this.registerTool(new WebFetchTool());

    if (memorySystem) {
      this.registerTool(new MemoryTool(memorySystem));
    }

    if (selfConfig) {
      this.registerTool(new SelfConfigTool(selfConfig));
    }

    const browserTool = new BrowserTool();
    await browserTool.initialize();
    this.registerTool(browserTool);
  }

  registerTool(tool: BaseTool): void {
    this.tools.set(tool.getName(), tool);
    this.logger.info(`Registered tool: ${tool.getName()}`);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }

  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Tool not found: ${toolCall.name}`,
        success: false,
      };
    }

    try {
      const args = JSON.parse(toolCall.arguments);
      const result = await tool.execute(args);
      result.toolCallId = toolCall.id;
      return result;
    } catch (error: any) {
      return {
        toolCallId: toolCall.id,
        content: `Execution error: ${error.message}`,
        success: false,
      };
    }
  }

  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolStats(): any {
    return {
      total: this.tools.size,
      tools: this.getAllToolNames(),
    };
  }
}

export { BaseTool, ToolDefinition, ToolCall, ToolResult };
export { FileTool, TerminalTool, WebSearchTool, WebFetchTool, MemoryTool } from './tools';
export { BrowserTool } from './browser';
