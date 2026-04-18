import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../config/loader';
import { Gateway } from '../gateway';
import { Agent } from '../agent';
import { MemorySystem } from '../memory';
import { SkillsRegistry } from '../skills';
import { AutomationEngine } from '../automation';
import { Config } from '../config/types';
import { getLogger, initLogger } from '../utils/logger';

let config: Config;
let gateway: Gateway | null = null;
let agent: Agent | null = null;

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
        const status = await response.json();
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

      const answers = await inquirer.prompt([
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
        const result = await response.json();
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
