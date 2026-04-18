import { Browser, chromium } from 'playwright';
import { BaseTool, ToolResult } from './tools';
import { getLogger } from '../utils/logger';

export class BrowserTool extends BaseTool {
  private browser: Browser | null = null;
  private headless: boolean;
  private timeout: number;
  private logger: any;

  constructor(headless: boolean = true, timeout: number = 30000) {
    super();
    this.headless = headless;
    this.timeout = timeout;
    this.logger = getLogger();
  }

  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({ headless: this.headless });
      this.logger.info('Browser initialized');
    } catch (error) {
      this.logger.warn('Browser not available:', error);
    }
  }

  getName(): string {
    return 'browser';
  }

  getDescription(): string {
    return 'Control a web browser to navigate, interact with pages, take screenshots, and extract content.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'screenshot', 'get_content', 'click', 'fill', 'evaluate'],
          description: 'The browser action to perform',
        },
        url: {
          type: 'string',
          description: 'URL to navigate to',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for click/fill actions',
        },
        value: {
          type: 'string',
          description: 'Value to fill in an input',
        },
        script: {
          type: 'string',
          description: 'JavaScript to evaluate',
        },
      },
      required: ['action'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    if (!this.browser) {
      return { toolCallId: '', content: 'Browser not initialized', success: false };
    }

    try {
      const { action, url, selector, value, script } = args;
      const context = await this.browser.newContext();
      const page = await context.newPage();

      let result = '';

      switch (action) {
        case 'navigate': {
          if (!url) throw new Error('URL required for navigate');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          result = `Navigated to ${url}\nTitle: ${await page.title()}`;
          break;
        }
        case 'get_content': {
          if (!url) throw new Error('URL required for get_content');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          result = await page.evaluate(() => document.body.innerText);
          if (result.length > 5000) {
            result = result.substring(0, 5000) + '\n... [content truncated]';
          }
          break;
        }
        case 'screenshot': {
          if (!url) throw new Error('URL required for screenshot');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          const screenshot = await page.screenshot({ type: 'jpeg' });
          result = `Screenshot captured (${screenshot.length} bytes)`;
          break;
        }
        case 'click': {
          if (!url || !selector) throw new Error('URL and selector required for click');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          await page.click(selector, { timeout: this.timeout });
          result = `Clicked ${selector} on ${url}`;
          break;
        }
        case 'fill': {
          if (!url || !selector || !value) throw new Error('URL, selector, and value required for fill');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          await page.fill(selector, value);
          result = `Filled ${selector} with "${value}" on ${url}`;
          break;
        }
        case 'evaluate': {
          if (!url || !script) throw new Error('URL and script required for evaluate');
          await page.goto(url, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
          result = String(await page.evaluate(script));
          break;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      await context.close();
      return { toolCallId: '', content: result, success: true };
    } catch (error: any) {
      return { toolCallId: '', content: `Browser error: ${error.message}`, success: false };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
