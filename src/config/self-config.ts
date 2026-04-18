import { Config } from '../config/types';
import { saveConfig } from '../config/loader';
import { getLogger } from '../utils/logger';

export interface ConfigChange {
  path: string;
  oldValue: any;
  newValue: any;
  timestamp: Date;
  reason: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SelfConfig {
  private config: Config;
  private changeHistory: ConfigChange[] = [];
  private logger: any;
  private maxHistoryLength: number = 100;

  constructor(config: Config) {
    this.config = config;
    this.logger = getLogger();
  }

  getConfig(): Config {
    return this.config;
  }

  getNestedValue(path: string): any {
    const keys = path.split('.');
    let current: any = this.config;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  setNestedValue(path: string, value: any, reason: string = 'user request'): ConfigChange | null {
    const keys = path.split('.');
    let current: any = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (current[keys[i]] === undefined) {
        return null;
      }
      current = current[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (current[lastKey] === undefined) {
      return null;
    }

    const oldValue = current[lastKey];
    current[lastKey] = value;

    const change: ConfigChange = {
      path,
      oldValue,
      newValue: value,
      timestamp: new Date(),
      reason,
    };

    this.changeHistory.push(change);
    if (this.changeHistory.length > this.maxHistoryLength) {
      this.changeHistory = this.changeHistory.slice(-this.maxHistoryLength);
    }

    this.logger.info(`Config changed: ${path} = ${JSON.stringify(value)} (was: ${JSON.stringify(oldValue)})`);
    return change;
  }

  applyAgentSuggestedConfig(suggestions: Record<string, { value: any; reason: string }>): ConfigChange[] {
    const changes: ConfigChange[] = [];

    for (const [path, suggestion] of Object.entries(suggestions)) {
      const validation = this.validateConfigChange(path, suggestion.value);
      if (validation.valid) {
        const change = this.setNestedValue(path, suggestion.value, suggestion.reason);
        if (change) {
          changes.push(change);
        }
      } else {
        this.logger.warn(`Rejected config change: ${path}`, validation.errors);
      }
    }

    if (changes.length > 0) {
      this.persistConfig();
    }

    return changes;
  }

  validateConfigChange(path: string, value: any): ConfigValidationResult {
    const result: ConfigValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const validations: Record<string, (val: any) => boolean> = {
      'agent.model.provider': (val) => ['openai', 'anthropic', 'google', 'ollama', 'custom'].includes(val),
      'agent.temperature': (val) => typeof val === 'number' && val >= 0 && val <= 2,
      'agent.maxTokens': (val) => typeof val === 'number' && val > 0 && val <= 32768,
      'gateway.port': (val) => typeof val === 'number' && val > 0 && val < 65536,
      'gateway.host': (val) => typeof val === 'string' && val.length > 0,
      'memory.maxContextLength': (val) => typeof val === 'number' && val > 0 && val <= 200,
      'browser.headless': (val) => typeof val === 'boolean',
      'browser.enabled': (val) => typeof val === 'boolean',
      'logging.level': (val) => ['error', 'warn', 'info', 'debug', 'trace'].includes(val),
    };

    const validator = validations[path];
    if (validator && !validator(value)) {
      result.valid = false;
      result.errors.push(`Invalid value for ${path}: ${JSON.stringify(value)}`);
    }

    if (path === 'gateway.host' && value !== '127.0.0.1' && value !== 'localhost') {
      result.warnings.push(`Exposing gateway on ${value} may be a security risk`);
    }

    if (path === 'agent.model.provider' && value === 'custom' && !this.config.agent.model.baseUrl) {
      result.warnings.push('Custom provider requires baseUrl');
    }

    return result;
  }

  getConfigSummary(): Record<string, any> {
    return {
      agent: {
        provider: this.config.agent.model.provider,
        model: this.config.agent.model.name,
        temperature: this.config.agent.temperature,
        hasApiKey: !!this.config.agent.model.apiKey,
      },
      gateway: {
        host: this.config.gateway.host,
        port: this.config.gateway.port,
        hasAuthToken: !!this.config.gateway.authToken,
      },
      channels: {
        feishu: this.config.channels?.feishu?.enabled || false,
        telegram: this.config.channels.telegram.enabled,
        discord: this.config.channels.discord.enabled,
        slack: this.config.channels.slack.enabled,
      },
      memory: {
        enabled: this.config.memory.enabled,
        maxContextLength: this.config.memory.maxContextLength,
      },
      automation: {
        enabled: this.config.automation.enabled,
      },
      browser: {
        enabled: this.config.browser.enabled,
        headless: this.config.browser.headless,
      },
    };
  }

  getChangeHistory(limit?: number): ConfigChange[] {
    if (limit) {
      return this.changeHistory.slice(-limit);
    }
    return [...this.changeHistory];
  }

  undoLastChange(): ConfigChange | null {
    if (this.changeHistory.length === 0) return null;

    const lastChange = this.changeHistory.pop();
    if (lastChange) {
      this.setNestedValue(lastChange.path, lastChange.oldValue, 'undo');
      this.persistConfig();
    }

    return lastChange || null;
  }

  revertToSnapshot(snapshot: Config): void {
    this.config = snapshot;
    this.persistConfig();
    this.logger.info('Configuration reverted to snapshot');
  }

  createSnapshot(): Config {
    return JSON.parse(JSON.stringify(this.config));
  }

  persistConfig(): void {
    try {
      saveConfig(this.config);
    } catch (error) {
      this.logger.error('Failed to persist configuration:', error);
    }
  }

  async generateConfigPrompt(): Promise<string> {
    const summary = this.getConfigSummary();
    return `Current NeuralAgent configuration:
${JSON.stringify(summary, null, 2)}

Available configuration paths:
- agent.model.provider: ${this.config.agent.model.provider}
- agent.model.name: ${this.config.agent.model.name}
- agent.temperature: ${this.config.agent.temperature}
- agent.maxTokens: ${this.config.agent.maxTokens}
- agent.systemPrompt: [system prompt hidden]
- gateway.port: ${this.config.gateway.port}
- gateway.host: ${this.config.gateway.host}
- memory.enabled: ${this.config.memory.enabled}
- memory.maxContextLength: ${this.config.memory.maxContextLength}
- browser.enabled: ${this.config.browser.enabled}
- browser.headless: ${this.config.browser.headless}
- logging.level: ${this.config.logging.level}
- automation.enabled: ${this.config.automation.enabled}

To change a setting, specify the path and new value. Example:
"Set agent.temperature to 0.5" -> { "agent.temperature": { "value": 0.5, "reason": "user request" } }`;
  }
}
