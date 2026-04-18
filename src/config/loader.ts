import fs from 'fs-extra';
import path from 'path';
import { Config, defaultConfig } from './types';

const CONFIG_PATHS = [
  path.join(process.cwd(), 'neural-agent.json'),
  path.join(process.env.HOME || '', '.neural-agent', 'config.json'),
];

export function loadConfig(configPath?: string): Config {
  const targetPath = configPath || CONFIG_PATHS.find(p => fs.existsSync(p));
  
  if (!targetPath || !fs.existsSync(targetPath)) {
    console.log('No config found, using defaults');
    return defaultConfig;
  }

  try {
    const fileContent = fs.readFileSync(targetPath, 'utf-8');
    const userConfig = JSON.parse(fileContent) as Partial<Config>;
    return mergeConfig(defaultConfig, userConfig);
  } catch (error) {
    console.error(`Failed to load config from ${targetPath}:`, error);
    return defaultConfig;
  }
}

function mergeConfig(defaults: Config, user: Partial<Config>): Config {
  return {
    ...defaults,
    ...user,
    agent: { ...defaults.agent, ...user.agent },
    gateway: { ...defaults.gateway, ...user.gateway },
    channels: { ...defaults.channels, ...user.channels },
    memory: { ...defaults.memory, ...user.memory },
    skills: { ...defaults.skills, ...user.skills },
    automation: { ...defaults.automation, ...user.automation },
    browser: { ...defaults.browser, ...user.browser },
    logging: { ...defaults.logging, ...user.logging },
  };
}

export function saveConfig(config: Config, configPath?: string): void {
  const targetPath = configPath || CONFIG_PATHS[0];
  const dir = path.dirname(targetPath);
  fs.ensureDirSync(dir);
  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
}
