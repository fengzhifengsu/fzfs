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

export interface AgentConfig {
  name: string;
  model: ModelConfig;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
  name: string;
  apiKey: string;
  baseUrl?: string;
}

export interface GatewayConfig {
  port: number;
  host: string;
  authToken: string;
  corsOrigins: string[];
}

export interface ChannelConfig {
  telegram: TelegramConfig;
  discord: DiscordConfig;
  slack: SlackConfig;
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
