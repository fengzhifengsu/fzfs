import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';

const execAsync = promisify(exec);

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
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

export abstract class BaseTool {
  abstract getName(): string;
  abstract getDescription(): string;
  abstract getParameters(): Record<string, any>;
  abstract execute(args: Record<string, any>): Promise<ToolResult>;

  getDefinition(): ToolDefinition {
    return {
      name: this.getName(),
      description: this.getDescription(),
      parameters: this.getParameters(),
    };
  }
}

export class FileTool extends BaseTool {
  getName(): string {
    return 'file_operations';
  }

  getDescription(): string {
    return 'Read, write, and manage files on the local filesystem. Supports reading, writing, appending, listing directories, and deleting files.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read', 'write', 'append', 'list', 'delete', 'exists', 'move', 'copy'],
          description: 'The file operation to perform',
        },
        path: {
          type: 'string',
          description: 'The file or directory path',
        },
        content: {
          type: 'string',
          description: 'Content for write/append operations',
        },
        destination: {
          type: 'string',
          description: 'Destination path for move/copy operations',
        },
      },
      required: ['operation', 'path'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { operation, path: filePath, content, destination } = args;
      let result = '';

      switch (operation) {
        case 'read': {
          result = await fs.readFile(filePath, 'utf-8');
          break;
        }
        case 'write': {
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, content || '', 'utf-8');
          result = `File written successfully: ${filePath}`;
          break;
        }
        case 'append': {
          await fs.ensureDir(path.dirname(filePath));
          await fs.appendFile(filePath, content || '', 'utf-8');
          result = `Content appended to: ${filePath}`;
          break;
        }
        case 'list': {
          const files = await fs.readdir(filePath, { withFileTypes: true });
          result = files.map(f => `${f.isDirectory() ? '[D]' : '[F]'} ${f.name}`).join('\n');
          break;
        }
        case 'delete': {
          await fs.remove(filePath);
          result = `Deleted: ${filePath}`;
          break;
        }
        case 'exists': {
          const exists = await fs.pathExists(filePath);
          result = `Path ${exists ? 'exists' : 'does not exist'}: ${filePath}`;
          break;
        }
        case 'move': {
          if (!destination) throw new Error('Destination path required for move');
          await fs.move(filePath, destination, { overwrite: true });
          result = `Moved: ${filePath} -> ${destination}`;
          break;
        }
        case 'copy': {
          if (!destination) throw new Error('Destination path required for copy');
          await fs.copy(filePath, destination);
          result = `Copied: ${filePath} -> ${destination}`;
          break;
        }
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      return { toolCallId: '', content: result, success: true };
    } catch (error: any) {
      return { toolCallId: '', content: `Error: ${error.message}`, success: false };
    }
  }
}

export class TerminalTool extends BaseTool {
  private workingDir: string;
  private maxOutputLength: number = 10000;

  constructor(workingDir: string = process.cwd()) {
    super();
    this.workingDir = workingDir;
  }

  getName(): string {
    return 'terminal';
  }

  getDescription(): string {
    return 'Execute shell commands in the terminal. Returns the command output. Use for running scripts, installing packages, checking system status, etc.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        workingDir: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { command, workingDir, timeout } = args;
      const cwd = workingDir || this.workingDir;
      const timeoutMs = timeout || 30000;

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10,
      });

      let output = stdout || '';
      if (stderr) {
        output += '\n[stderr]\n' + stderr;
      }

      if (output.length > this.maxOutputLength) {
        output = output.substring(0, this.maxOutputLength) + '\n... [output truncated]';
      }

      return { toolCallId: '', content: output || '(empty output)', success: true };
    } catch (error: any) {
      let message = error.message;
      if (error.killed) {
        message = 'Command was killed due to timeout';
      }
      return { toolCallId: '', content: `Error: ${message}`, success: false };
    }
  }
}

export class WebSearchTool extends BaseTool {
  getName(): string {
    return 'web_search';
  }

  getDescription(): string {
    return 'Search the web for information. Returns relevant search results with titles, URLs, and snippets.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        numResults: {
          type: 'number',
          description: 'Number of results to return (default: 5)',
        },
      },
      required: ['query'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { query, numResults } = args;
      const count = numResults || 5;

      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KeleAgent/1.0)',
        },
      });

      const html = await response.text();
      
      const results: string[] = [];
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g;
      
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < count) {
        results.push(`Title: ${match[2]}\nURL: ${match[1]}`);
      }

      return {
        toolCallId: '',
        content: results.length > 0 
          ? results.join('\n\n---\n\n')
          : 'No results found',
        success: true,
      };
    } catch (error: any) {
      return { toolCallId: '', content: `Search error: ${error.message}`, success: false };
    }
  }
}

export class WebFetchTool extends BaseTool {
  getName(): string {
    return 'web_fetch';
  }

  getDescription(): string {
    return 'Fetch content from a URL. Returns the page content in markdown format.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        maxLength: {
          type: 'number',
          description: 'Maximum content length to return (default: 5000)',
        },
      },
      required: ['url'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { url, maxLength } = args;
      const maxLen = maxLength || 5000;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KeleAgent/1.0)',
        },
      });

      const html = await response.text();
      
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const content = text.length > maxLen 
        ? text.substring(0, maxLen) + '\n... [content truncated]'
        : text;

      return { toolCallId: '', content, success: true };
    } catch (error: any) {
      return { toolCallId: '', content: `Fetch error: ${error.message}`, success: false };
    }
  }
}

export class MemoryTool extends BaseTool {
  private memorySystem: any;

  constructor(memorySystem: any) {
    super();
    this.memorySystem = memorySystem;
  }

  getName(): string {
    return 'memory';
  }

  getDescription(): string {
    return 'Store and retrieve persistent memory. Use this to remember user preferences, facts, and important information across conversations.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['store', 'get', 'search', 'delete', 'list'],
          description: 'The memory operation to perform',
        },
        key: {
          type: 'string',
          description: 'The memory key',
        },
        value: {
          type: 'string',
          description: 'The value to store',
        },
        category: {
          type: 'string',
          description: 'Category for the memory',
        },
        query: {
          type: 'string',
          description: 'Search query for memories',
        },
      },
      required: ['operation'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { operation, key, value, category, query } = args;
      let result = '';

      switch (operation) {
        case 'store': {
          if (!key || !value) {
            throw new Error('Key and value required for store operation');
          }
          this.memorySystem.storeMemory({
            key,
            value,
            category: category || 'general',
            tags: [],
            importance: 0.5,
          });
          result = `Memory stored: ${key}`;
          break;
        }
        case 'get': {
          if (!key) throw new Error('Key required for get operation');
          const memory = this.memorySystem.getMemory(key);
          result = memory ? memory.value : `Memory not found: ${key}`;
          break;
        }
        case 'search': {
          if (!query) throw new Error('Query required for search operation');
          const memories = this.memorySystem.searchMemories(query, category);
          result = memories.length > 0
            ? memories.map(m => `${m.key}: ${m.value}`).join('\n')
            : 'No matching memories found';
          break;
        }
        case 'delete': {
          if (!key) throw new Error('Key required for delete operation');
          const deleted = this.memorySystem.deleteMemory(key);
          result = deleted ? `Memory deleted: ${key}` : `Memory not found: ${key}`;
          break;
        }
        case 'list': {
          const memories = this.memorySystem.getMemoriesByCategory(category || 'general');
          result = memories.length > 0
            ? memories.map(m => `${m.key}: ${m.value}`).join('\n')
            : 'No memories in this category';
          break;
        }
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      return { toolCallId: '', content: result, success: true };
    } catch (error: any) {
      return { toolCallId: '', content: `Memory error: ${error.message}`, success: false };
    }
  }
}
