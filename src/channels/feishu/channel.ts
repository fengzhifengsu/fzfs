import * as Lark from '@larksuiteoapi/node-sdk';
import { FeishuConfig, FeishuMessage } from './types';
import { getLogger } from '../../utils/logger';
import { PairingManager } from './pairing';

export type FeishuConnectMode = 'websocket' | 'http';

export class FeishuChannel {
  private config: FeishuConfig;
  private logger: any;
  private messageHandler: ((message: FeishuMessage) => Promise<string>) | null = null;
  private pairingManager: PairingManager | null = null;
  private mode: FeishuConnectMode;
  private wsClient: Lark.WSClient | null = null;
  private apiClient: Lark.Client | null = null;

  constructor(config: FeishuConfig, mode: FeishuConnectMode = 'websocket') {
    this.config = config;
    this.logger = getLogger();
    this.pairingManager = new PairingManager();
    this.mode = mode;
  }

  setMode(mode: FeishuConnectMode): void {
    this.mode = mode;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Feishu channel is disabled');
      return;
    }

    if (this.mode === 'websocket') {
      await this.initializeWebSocket();
    } else {
      await this.initializeHttp();
    }
  }

  private async initializeWebSocket(): Promise<void> {
    const loggerLevel = Lark.LoggerLevel.info;

    this.apiClient = new Lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: Lark.Domain.Feishu,
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel,
    });

    const self = this;

    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          const messageData = data.message;
          const senderData = data.sender;

          const chatType = messageData.chat_type === 'p2p' ? 'p2p' : 'group';

          if (chatType === 'group' && self.config.requireMention) {
            const content = JSON.parse(messageData.content || '{}');
            const mentions = content.mention || [];
            if (mentions.length === 0) {
              return;
            }
          }

          let content = '';
          try {
            const parsed = JSON.parse(messageData.content || '{}');
            content = parsed.text || '';
          } catch {
            content = messageData.content || '';
          }

          const feishuMessage: FeishuMessage = {
            messageId: messageData.message_id,
            chatId: messageData.chat_id,
            chatType,
            senderId: senderData?.sender_id?.open_id || '',
            senderType: 'user',
            content,
            messageType: messageData.message_type || 'text',
            timestamp: messageData.create_time,
          };

          self.logger.info(`Feishu WS message from ${feishuMessage.senderId} (${chatType}): ${content.substring(0, 50)}`);

          if (content.trim().startsWith('/pair') || content.trim().startsWith('配对')) {
            await self.handlePairCommand(feishuMessage);
            return;
          }

          if (self.messageHandler) {
            try {
              const reply = await self.messageHandler(feishuMessage);
              if (reply) {
                await self.reply(feishuMessage.chatId, reply, feishuMessage.messageId);
              }
            } catch (error) {
              self.logger.error('Error handling Feishu message:', error);
            }
          }
        },
      }),
    });

    this.logger.info('Feishu WebSocket long-connection channel initialized');
    this.logger.info('Mode: WebSocket (no public IP required)');
  }

  private async initializeHttp(): Promise<void> {
    if (!this.config.verificationToken && !this.config.encryptKey) {
      this.logger.warn('Feishu verificationToken is not set, URL verification may fail');
    }
    this.logger.info('Feishu HTTP callback mode initialized');
  }

  handleHttpRequest(body: any): { challenge?: string } {
    if (body.type === 'url_verification' && body.challenge) {
      this.logger.info('Feishu URL verification received');
      return { challenge: body.challenge };
    }

    if (body.schema === '2.0' && body.type === 'event_callback' && body.event) {
      const header = body.header || {};
      if (header.event_type === 'im.message.receive_v1') {
        this.processMessageEvent(body.event).catch((err) => {
          this.logger.error('Error processing HTTP message event:', err);
        });
      }
    }

    return {};
  }

  private async processMessageEvent(eventData: any): Promise<void> {
    const message = eventData.message;
    const sender = eventData.sender;

    const chatType = message.chat_type === 'p2p' ? 'p2p' : 'group';

    if (chatType === 'group' && this.config.requireMention) {
      const content = JSON.parse(message.content || '{}');
      const mentions = content.mention || [];
      if (mentions.length === 0) {
        return;
      }
    }

    let content = '';
    try {
      const parsed = JSON.parse(message.content || '{}');
      content = parsed.text || '';
    } catch {
      content = message.content || '';
    }

    const feishuMessage: FeishuMessage = {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType,
      senderId: sender?.sender_id?.open_id || '',
      senderType: 'user',
      content,
      messageType: message.message_type || 'text',
      timestamp: message.create_time,
    };

    this.logger.info(`Feishu HTTP message from ${feishuMessage.senderId} (${chatType}): ${content.substring(0, 50)}`);

    if (content.trim().startsWith('/pair') || content.trim().startsWith('配对')) {
      await this.handlePairCommand(feishuMessage);
      return;
    }

    if (this.messageHandler) {
      try {
        const reply = await this.messageHandler(feishuMessage);
        if (reply) {
          await this.reply(feishuMessage.chatId, reply, feishuMessage.messageId);
        }
      } catch (error) {
        this.logger.error('Error handling Feishu message:', error);
      }
    }
  }

  private async handlePairCommand(message: FeishuMessage): Promise<void> {
    if (!this.pairingManager) return;

    const parts = message.content.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    if (command === '/pair' || command === '配对') {
      const senderName = message.senderId.substring(0, 8);
      const code = this.pairingManager.generatePairCode(message.senderId, senderName);

      const replyText = `🔑 配对码已生成：\n\n${code}\n\n请在终端运行：\nkele pair ${code}\n\n配对码 5 分钟内有效`;
      await this.reply(message.chatId, replyText, message.messageId);
      this.logger.info(`Pair code generated for ${message.senderId}: ${code}`);
    }
  }

  async getTenantAccessToken(): Promise<string> {
    if (!this.apiClient) return '';
    try {
      const data = await this.apiClient.request({
        method: 'POST',
        url: '/open-apis/auth/v3/tenant_access_token/internal',
        data: {
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        },
      });
      return data.tenant_access_token || '';
    } catch (error) {
      this.logger.error('Error getting Feishu token:', error);
      return '';
    }
  }

  async reply(chatId: string, content: string, replyMessageId?: string): Promise<void> {
    try {
      const host = this.config.host === 'open.larksuite.com' ? 'open.larksuite.com' : 'open.feishu.cn';
      const token = await this.getTenantAccessToken();

      const body: any = {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      };

      let url = `https://${host}/open-apis/im/v1/messages?receive_id_type=chat_id`;
      if (replyMessageId) {
        url = `https://${host}/open-apis/im/v1/messages/${replyMessageId}/reply?receive_id_type=chat_id`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;
      if (data.code === 0) {
        this.logger.info(`Feishu reply sent to ${chatId}`);
      } else {
        this.logger.error('Failed to send Feishu reply:', JSON.stringify(data));
      }
    } catch (error) {
      this.logger.error('Error sending Feishu reply:', error);
    }
  }

  async replyCard(chatId: string, cardJson: string, replyMessageId?: string): Promise<void> {
    try {
      const host = this.config.host === 'open.larksuite.com' ? 'open.larksuite.com' : 'open.feishu.cn';
      const token = await this.getTenantAccessToken();

      const response = await fetch(
        `https://${host}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'interactive',
            content: cardJson,
          }),
        }
      );

      const data = await response.json() as any;
      if (data.code !== 0) {
        this.logger.error('Failed to send Feishu card:', data.msg);
      }
    } catch (error) {
      this.logger.error('Error sending Feishu card:', error);
    }
  }

  setMessageHandler(handler: (message: FeishuMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  disconnect(): void {
    this.logger.info('Feishu channel disconnected');
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getPairingManager(): PairingManager | null {
    return this.pairingManager;
  }
}
