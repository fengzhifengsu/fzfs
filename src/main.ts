import { loadConfig } from './config/loader';
import { initLogger, getLogger } from './utils/logger';
import { Gateway } from './gateway';
import { Agent } from './agent';
import { MemorySystem } from './memory';
import { EnhancedMemory } from './memory/enhanced-memory';
import { SkillsRegistry } from './skills';
import { AutoSkillCreator } from './skills/auto-creator';
import { AutomationEngine } from './automation';
import { SelfConfig } from './config/self-config';
import { FeishuChannel } from './channels/feishu';
import { FeishuMessage } from './channels/feishu/types';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initLogger(config.logging.level, config.logging.filePath);

  logger.info('Initializing KeleAgent...');

  const basicMemory = new MemorySystem(config.memory.dbPath);
  const enhancedMemory = new EnhancedMemory('./data/enhanced-memory.db');
  const skills = new SkillsRegistry(config.skills.workspacePath);
  const automation = new AutomationEngine();
  const selfConfig = new SelfConfig(config);

  const agent = new Agent(config.agent);
  const autoSkillCreator = new AutoSkillCreator(skills, agent, basicMemory, './data/experiences.json');

  const gateway = new Gateway(config.gateway, './data/sessions.db');
  gateway.messageHandler.setBasicMemory(basicMemory);
  gateway.messageHandler.setEnhancedMemory(enhancedMemory);
  gateway.messageHandler.setAutoSkillCreator(autoSkillCreator);
  gateway.messageHandler.setSelfConfig(selfConfig);

  await gateway.messageHandler.initialize(agent);

  gateway.getSessionManager().cleanupOldSessions();

  automation.registerHandler(async (data: any) => {
    logger.info(`Automation triggered: ${data.type} - ${data.jobName || data.webhookName}`);
  });

  if (config.automation.enabled) {
    automation.loadJobs(config.automation.cronJobsPath);
    automation.loadWebhooks(config.automation.webhooksPath);
  }

  if (config.channels?.feishu?.enabled) {
    const feishuChannel = new FeishuChannel(config.channels.feishu, 'http');
    await feishuChannel.initialize();

    gateway.registerFeishuRoute(feishuChannel);

    feishuChannel.setMessageHandler(async (message: FeishuMessage) => {
      try {
        const pairingManager = feishuChannel.getPairingManager();
        if (pairingManager && !pairingManager.isPaired(message.senderId)) {
          return '⚠️ 您尚未配对，请先发送 /pair 或 配对 获取配对码，然后在终端运行 kele pair <配对码> 完成配对。';
        }

        const session = gateway.getSessionManager().getOrCreateSession(`feishu-${message.chatId}`, 'feishu');
        const response = await gateway.messageHandler.handleMessage(session, message.content);
        await feishuChannel.reply(message.chatId, response, message.messageId);
        return '';
      } catch (error: any) {
        logger.error('Feishu message handling error:', error);
        return '抱歉，处理消息时出现错误';
      }
    });

    logger.info('Feishu HTTP callback channel initialized');
    const webhookUrl = `http://${config.gateway.host}:${config.gateway.port}/api/feishu/webhook`;
    logger.info(`Feishu webhook URL: ${webhookUrl}`);
  }

  const dreamingSchedule = setInterval(async () => {
    logger.info('Running dreaming phase...');
    const allSessions = gateway.getSessionManager().getAllSessions();
    for (const session of allSessions) {
      try {
        await enhancedMemory.runDreamingPhase(session.userId);
      } catch (error) {
        logger.error(`Dreaming error for user ${session.userId}:`, error);
      }
    }
  }, 3600000);

  const sessionCleanupSchedule = setInterval(() => {
    const cleaned = gateway.getSessionManager().cleanupOldSessions();
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old sessions`);
    }
  }, 86400000);

  await gateway.start();

  const skillReviewSchedule = setInterval(async () => {
    logger.info('Reviewing experiences for auto-skill creation...');
    try {
      const results = await autoSkillCreator.reviewAllExperiences();
      for (const result of results) {
        if (result.created) {
          logger.info(`Auto skill created: ${result.skillName}`);
        }
      }
    } catch (error) {
      logger.error('Skill review error:', error);
    }
  }, 600000);

  logger.info('KeleAgent is fully operational');
  logger.info(`Gateway: ws://${config.gateway.host}:${config.gateway.port}/ws`);
  logger.info(`API: http://${config.gateway.host}:${config.gateway.port}`);

  process.on('SIGINT', async () => {
    logger.info('Shutting down KeleAgent...');
    clearInterval(dreamingSchedule);
    clearInterval(skillReviewSchedule);
    clearInterval(sessionCleanupSchedule);
    if (config.automation.enabled) {
      automation.saveJobs(config.automation.cronJobsPath);
      automation.saveWebhooks(config.automation.webhooksPath);
    }
    autoSkillCreator.saveExperiences();
    selfConfig.persistConfig();
    await gateway.stop();
    basicMemory.close();
    enhancedMemory.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await gateway.stop();
    basicMemory.close();
    enhancedMemory.close();
    process.exit(0);
  });
}

main().catch(console.error);
