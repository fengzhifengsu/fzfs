export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
  name: string;
  apiKey: string;
  baseUrl?: string;
}

export interface AgentConfig {
  name: string;
  model: ModelConfig;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface GatewayConfig {
  port: number;
  host: string;
  authToken: string;
  corsOrigins: string[];
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
}

export interface DiscordConfig {
  enabled: boolean;
  botToken: string;
  clientId: string;
}

export interface SlackConfig {
  enabled: boolean;
  botToken: string;
  signingSecret: string;
}

export interface FeishuChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  host: 'open.feishu.cn' | 'open.larksuite.com';
  requireMention: boolean;
}

export interface ChannelConfig {
  feishu: FeishuChannelConfig;
  telegram: TelegramConfig;
  discord: DiscordConfig;
  slack: SlackConfig;
}

export interface MemoryConfig {
  enabled: boolean;
  dbPath: string;
  maxContextLength: number;
  embeddingModel: string;
}

export interface SkillsConfig {
  workspacePath: string;
  autoInstall: boolean;
  allowList: string[];
}

export interface AutomationConfig {
  enabled: boolean;
  cronJobsPath: string;
  webhooksPath: string;
}

export interface BrowserConfig {
  enabled: boolean;
  headless: boolean;
  timeout: number;
}

export interface LoggingConfig {
  level: string;
  filePath: string;
}

export interface Config {
  agent: AgentConfig;
  gateway: GatewayConfig;
  channels: ChannelConfig;
  memory: MemoryConfig;
  skills: SkillsConfig;
  automation: AutomationConfig;
  browser: BrowserConfig;
  logging: LoggingConfig;
}

export const defaultConfig: Config = {
  agent: {
    name: 'NeuralAgent',
    model: {
      provider: 'openai',
      name: 'gpt-4',
      apiKey: '',
      baseUrl: '',
    },
    systemPrompt: 'You are NeuralAgent, a helpful AI assistant.',
    temperature: 0.7,
    maxTokens: 4096,
  },
  gateway: {
    port: 18789,
    host: '127.0.0.1',
    authToken: '',
    corsOrigins: ['http://localhost:3000'],
  },
  channels: {
    feishu: {
      enabled: false,
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
      host: 'open.feishu.cn' as const,
      requireMention: true,
    },
    telegram: { enabled: false, botToken: '' },
    discord: { enabled: false, botToken: '', clientId: '' },
    slack: { enabled: false, botToken: '', signingSecret: '' },
  },
  memory: {
    enabled: true,
    dbPath: './data/memory.db',
    maxContextLength: 50,
    embeddingModel: 'text-embedding-3-small',
  },
  skills: {
    workspacePath: './skills',
    autoInstall: false,
    allowList: [],
  },
  automation: {
    enabled: true,
    cronJobsPath: './data/cron.json',
    webhooksPath: './data/webhooks.json',
  },
  browser: {
    enabled: true,
    headless: true,
    timeout: 30000,
  },
  logging: {
    level: 'info',
    filePath: './logs/neural-agent.log',
  },
};
