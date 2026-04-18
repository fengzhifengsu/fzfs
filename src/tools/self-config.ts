import { BaseTool, ToolResult } from '../tools/tools';
import { SelfConfig } from '../config/self-config';
import { getLogger } from '../utils/logger';

export class SelfConfigTool extends BaseTool {
  private selfConfig: SelfConfig;
  private logger: any;

  constructor(selfConfig: SelfConfig) {
    super();
    this.selfConfig = selfConfig;
    this.logger = getLogger();
  }

  getName(): string {
    return 'self_config';
  }

  getDescription(): string {
    return 'Modify KeleAgent own configuration. Change model provider, temperature, system prompt, gateway settings, memory settings, browser settings, and more. Use this to self-configure.';
  }

  getParameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'summary', 'history', 'undo'],
          description: 'The configuration action to perform',
        },
        path: {
          type: 'string',
          description: 'Configuration path (e.g., agent.temperature, gateway.port)',
        },
        value: {
          type: 'string',
          description: 'New value for the configuration (JSON string for complex types)',
        },
        reason: {
          type: 'string',
          description: 'Reason for the change',
        },
      },
      required: ['action'],
    };
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { action, path, value, reason } = args;
      let result = '';

      switch (action) {
        case 'get': {
          if (!path) throw new Error('Path required for get action');
          const currentValue = this.selfConfig.getNestedValue(path);
          result = currentValue !== undefined
            ? `${path} = ${JSON.stringify(currentValue)}`
            : `Path not found: ${path}`;
          break;
        }
        case 'set': {
          if (!path) throw new Error('Path required for set action');
          if (value === undefined) throw new Error('Value required for set action');

          const validation = this.selfConfig.validateConfigChange(path, value);
          if (!validation.valid) {
            result = `Invalid config change:\n${validation.errors.join('\n')}`;
            return { toolCallId: '', content: result, success: false };
          }

          const change = this.selfConfig.setNestedValue(path, value, reason || 'agent self-config');
          if (change) {
            this.selfConfig.persistConfig();
            result = `Configuration updated:\n${path}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(value)}\nReason: ${reason || 'agent self-config'}`;
            if (validation.warnings.length > 0) {
              result += `\n\nWarnings:\n${validation.warnings.join('\n')}`;
            }
          } else {
            result = `Path not found: ${path}`;
          }
          break;
        }
        case 'summary': {
          const summary = this.selfConfig.getConfigSummary();
          result = JSON.stringify(summary, null, 2);
          break;
        }
        case 'history': {
          const history = this.selfConfig.getChangeHistory(10);
          if (history.length === 0) {
            result = 'No configuration changes in history';
          } else {
            result = history.map(c =>
              `[${c.timestamp.toISOString()}] ${c.path}: ${JSON.stringify(c.oldValue)} -> ${JSON.stringify(c.newValue)} (${c.reason})`
            ).join('\n');
          }
          break;
        }
        case 'undo': {
          const lastChange = this.selfConfig.undoLastChange();
          result = lastChange
            ? `Undid change to ${lastChange.path}: restored ${JSON.stringify(lastChange.oldValue)}`
            : 'No changes to undo';
          break;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return { toolCallId: '', content: result, success: true };
    } catch (error: any) {
      return { toolCallId: '', content: `Self-config error: ${error.message}`, success: false };
    }
  }
}
