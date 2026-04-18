import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../config/loader';
import { Gateway } from '../gateway';
import { Agent } from '../agent';
import { MemorySystem } from '../memory';
import { SkillsRegistry } from '../skills';
import { AutomationEngine } from '../automation';
import { Config } from '../config/types';
import { getLogger, initLogger } from '../utils/logger';
import { PairingManager } from '../channels/feishu/pairing';

let config: Config;
let gateway: Gateway | null = null;
let agent: Agent | null = null;

async function prompt(questions: any[]): Promise<any> {
  // @ts-ignore - inquirer types not available
  const inquirer = await import('inquirer');
  const promptFn = (inquirer.default as any).prompt || (inquirer as any).prompt;
  return promptFn(questions);
}

export function createCLI(): Command {
  const program = new Command();

  program
    .name('kele')
    .description('KeleAgent - Local-first AI Agent Platform')
    .version('1.0.0');

  program
    .command('start')
    .description('Start the KeleAgent gateway')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (opts) => {
      config = loadConfig(opts.config);
      initLogger(config.logging.level, config.logging.filePath);
      const logger = getLogger();

      logger.info('Starting KeleAgent...');

      const memory = new MemorySystem(config.memory.dbPath);
      agent = new Agent(config.agent);
      gateway = new Gateway(config.gateway);

      await gateway.messageHandler.initialize(agent);

      await gateway.start();
      logger.info(chalk.green('KeleAgent is running!'));
      logger.info(`Dashboard: http://${config.gateway.host}:${config.gateway.port}/ui`);
      logger.info(`WebSocket: ws://${config.gateway.host}:${config.gateway.port}/ws`);

      process.on('SIGINT', async () => {
        logger.info('Shutting down...');
        await gateway?.stop();
        memory.close();
        process.exit(0);
      });
    });

  program
    .command('status')
    .description('Check the status of KeleAgent')
    .action(async () => {
      const healthUrl = `http://${config.gateway.host}:${config.gateway.port}/health`;
      try {
        const response = await fetch(healthUrl);
        const status = await response.json() as any;
        console.log(chalk.green('KeleAgent is running'));
        console.log(`Status: ${status.status}`);
        console.log(`Uptime: ${Math.floor(status.uptime)}s`);
        console.log(`Active sessions: ${status.sessions}`);
        console.log(`Connections: ${status.connections}`);
      } catch {
        console.log(chalk.red('KeleAgent is not running'));
      }
    });

  program
    .command('onboard')
    .description('Interactive setup wizard')
    .option('--install-daemon', 'Install as a background daemon')
    .action(async () => {
      console.log(chalk.blue('\nWelcome to KeleAgent Setup Wizard!\n'));

      const answers = await prompt([
        {
          type: 'list',
          name: 'provider',
          message: 'Which AI model provider do you want to use?',
          choices: ['openai', 'anthropic', 'google', 'ollama'],
        },
        {
          type: 'input',
          name: 'apiKey',
          message: 'Enter your API key:',
          mask: '*',
          when: (answers: any) => answers.provider !== 'ollama',
        },
        {
          type: 'input',
          name: 'modelName',
          message: 'Which model do you want to use? (e.g., gpt-4, claude-3-opus-20240229)',
          default: 'gpt-4',
        },
        {
          type: 'input',
          name: 'gatewayPort',
          message: 'Gateway port:',
          default: '18789',
        },
        {
          type: 'input',
          name: 'systemPrompt',
          message: 'System prompt for your agent:',
          default: 'You are KeleAgent, a helpful AI assistant with persistent memory and extensible skills.',
        },
      ]);

      const newConfig = loadConfig();
      newConfig.agent.model.provider = answers.provider as any;
      newConfig.agent.model.name = answers.modelName;
      newConfig.agent.model.apiKey = answers.apiKey || '';
      newConfig.agent.systemPrompt = answers.systemPrompt;
      newConfig.gateway.port = parseInt(answers.gatewayPort);

      saveConfig(newConfig);
      console.log(chalk.green('\nConfiguration saved! Run "kele start" to begin.'));
    });

  program
    .command('config')
    .description('Manage configuration')
    .action(() => {
      config = loadConfig();
      console.log(chalk.blue('\nCurrent Configuration:\n'));
      console.log(JSON.stringify(config, null, 2));
    });

  program
    .command('message')
    .description('Send a message to the agent')
    .argument('<message>', 'The message to send')
    .option('-s, --session <id>', 'Session ID')
    .action(async (message, opts) => {
      const url = `http://${config.gateway.host}:${config.gateway.port}/message`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message,
            sessionId: opts.session,
            channel: 'cli',
          }),
        });
        const result = await response.json() as any;
        console.log(chalk.green('\nAgent Response:\n'));
        console.log(result.response);
      } catch (error) {
        console.error(chalk.red('Failed to send message. Is the gateway running?'));
      }
    });

  program
    .command('skills')
    .description('Manage skills')
    .addCommand(
      new Command('list')
        .description('List installed skills')
        .action(() => {
          console.log(chalk.blue('Skills management coming soon...'));
        })
    )
    .addCommand(
      new Command('install')
        .description('Install a skill')
        .argument('<name>', 'Skill name')
        .action((name) => {
          console.log(chalk.blue(`Installing skill: ${name}...`));
        })
    );

  program
    .command('pair')
    .description('Complete Feishu pairing with a code')
    .argument('<code>', 'Pairing code from Feishu')
    .action((code) => {
      const pairingManager = new PairingManager();
      const result = pairingManager.verifyPairCode(code);

      if (result.success) {
        console.log(chalk.green(`\n配对成功！`));
        console.log(chalk.green(`用户: ${result.feishuName}`));
        console.log(chalk.green(`ID: ${result.userId}`));
        console.log(chalk.green('现在您可以通过飞书与 KeleAgent 对话了'));
      } else {
        console.log(chalk.red(`\n配对失败: ${result.error}`));
        console.log(chalk.yellow('提示: 请在飞书中发送 /pair 或 配对 获取新的配对码'));
      }
    });

  program
    .command('pair-list')
    .description('List all paired Feishu users')
    .action(() => {
      const pairingManager = new PairingManager();
      const users = pairingManager.listPairedUsers();

      if (users.length === 0) {
        console.log(chalk.yellow('No paired users'));
        return;
      }

      console.log(chalk.blue(`\nPaired Users (${users.length}):\n`));
      for (const user of users) {
        console.log(chalk.green(`- ${user.feishuName}`));
        console.log(`  OpenId: ${user.feishuOpenId}`);
        console.log(`  Paired: ${user.pairedAt.toLocaleString()}`);
        console.log(`  Last Active: ${user.lastActive.toLocaleString()}`);
        console.log('');
      }
    });

  program
    .command('pair-unpair')
    .description('Remove a paired Feishu user')
    .argument('<openId>', 'Feishu OpenId to unpair')
    .action((openId) => {
      const pairingManager = new PairingManager();
      const result = pairingManager.removePairedUser(openId);

      if (result) {
        console.log(chalk.green(`\n已取消配对: ${openId}`));
      } else {
        console.log(chalk.yellow(`\n用户未找到: ${openId}`));
      }
    });

  program
    .command('pair-stats')
    .description('Show pairing statistics')
    .action(() => {
      const pairingManager = new PairingManager();
      const stats = pairingManager.getStats();

      console.log(chalk.blue('\nPairing Statistics:\n'));
      console.log(`Paired users: ${stats.pairedUsers}`);
      console.log(`Pending pairs: ${stats.pendingPairs}`);
    });

  program
    .command('memory')
    .description('Manage memory')
    .addCommand(
      new Command('stats')
        .description('Show memory statistics')
        .action(() => {
          config = loadConfig();
          const memory = new MemorySystem(config.memory.dbPath);
          const stats = memory.getStats();
          console.log(chalk.blue('\nMemory Statistics:\n'));
          console.log(`Memories: ${stats.memories}`);
          console.log(`Conversations: ${stats.conversations}`);
          console.log(`Preferences: ${stats.preferences}`);
          memory.close();
        })
    )
    .addCommand(
      new Command('clear')
        .description('Clear all memories')
        .action(() => {
          console.log(chalk.yellow('Memory clear functionality'));
        })
    );

  program
    .command('cron')
    .description('Manage scheduled tasks')
    .addCommand(
      new Command('list')
        .description('List scheduled jobs')
        .action(() => {
          console.log(chalk.blue('Cron jobs management'));
        })
    )
    .addCommand(
      new Command('add')
        .description('Add a scheduled job')
        .argument('<schedule>', 'Cron schedule expression')
        .argument('<prompt>', 'Prompt to send to agent')
        .action((schedule, prompt) => {
          console.log(chalk.blue(`Adding job: ${schedule} - ${prompt}`));
        })
    );

  program
    .command('stop')
    .description('Stop the KeleAgent gateway')
    .action(async () => {
      console.log(chalk.yellow('Stopping KeleAgent...'));
      process.exit(0);
    });

  return program;
}
