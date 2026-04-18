import WebSocket from 'ws';
import { FeishuConfig, FeishuMessage } from './types';
import { getLogger } from '../../utils/logger';
import { PairingManager } from './pairing';

const FEISHU_WS_BASE = 'wss://open.feishu.cn/open-apis/ws';
const LARK_WS_BASE = 'wss://open.larksuite.com/open-apis/ws';

interface WSFrame {
  seq: number;
  events?: any[];
  type?: number;
}

export type FeishuConnectMode = 'websocket' | 'http';

export class FeishuChannel {
  private config: FeishuConfig;
  private ws: WebSocket | null = null;
  private logger: any;
  private messageHandler: ((message: FeishuMessage) => Promise<string>) | null = null;
  private onReply: ((chatId: string, content: string) => Promise<void>) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number = 5000;
  private tenantAccessToken: string = '';
  private tokenExpiry: number = 0;
  private pairingManager: PairingManager | null = null;
  private mode: FeishuConnectMode;

  constructor(config: FeishuConfig, mode: FeishuConnectMode = 'http') {
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
    const token = await this.getTenantAccessToken();
    if (!token) {
      this.logger.error('Failed to get Feishu tenant access token, WebSocket channel will not be available');
      this.logger.error('Please check your appId and appSecret in config');
      return;
    }
    this.logger.info('Feishu token acquired, connecting WebSocket...');
    this.connect();
  }

  private async initializeHttp(): Promise<void> {
    if (!this.config.verificationToken && !this.config.encryptKey) {
      this.logger.warn('Feishu verificationToken is not set, URL verification may fail');
    }
    this.logger.info('Feishu HTTP callback mode initialized');
  }

  private getWsUrl(): string {
    const base = this.config.host === 'open.larksuite.com' ? LARK_WS_BASE : FEISHU_WS_BASE;
    return `${base}?token=${this.tenantAccessToken}`;
  }

  private connect(): void {
    this.ws = new WebSocket(this.getWsUrl());

    this.ws.on('open', () => {
      this.logger.info('Feishu WebSocket connected');
      this.reconnectDelay = 5000;
    });

    this.ws.on('message', async (data: any) => {
      try {
        const frame: WSFrame = JSON.parse(data.toString());
        await this.handleFrame(frame);
        this.sendAck(frame.seq);
      } catch (error) {
        this.logger.error('Feishu message parse error:', error);
      }
    });

    this.ws.on('close', () => {
      this.logger.warn('Feishu WebSocket disconnected, reconnecting...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error('Feishu WebSocket error:', error);
      this.scheduleReconnect();
    });
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

    this.logger.info(`Feishu message from ${feishuMessage.senderId} (${chatType}): ${content.substring(0, 50)}`);

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

  private async handleFrame(frame: WSFrame): Promise<void> {
    if (!frame.events || frame.events.length === 0) return;

    for (const event of frame.events) {
      const { header, event: eventData } = event;

      if (header?.event_type === 'im.message.receive_v1') {
        await this.handleMessage(eventData);
      }
    }
  }

  private async handleMessage(eventData: any): Promise<void> {
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

    this.logger.info(`Feishu message from ${feishuMessage.senderId} (${chatType}): ${content.substring(0, 50)}`);

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

  private sendAck(seq: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ seq, type: 1 }));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.refreshToken();
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
  }

  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantAccessToken && now < this.tokenExpiry) {
      return this.tenantAccessToken;
    }
    await this.refreshToken();
    return this.tenantAccessToken;
  }

  private async refreshToken(): Promise<void> {
    try {
      const host = this.config.host;
      const response = await fetch(`https://${host}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      });

      const data = await response.json() as any;
      if (data.code === 0) {
        this.tenantAccessToken = data.tenant_access_token;
        this.tokenExpiry = Date.now() + (data.expire - 300) * 1000;
        this.logger.info('Feishu tenant access token refreshed');
      } else {
        this.logger.error('Failed to get Feishu token:', data.msg);
      }
    } catch (error) {
      this.logger.error('Error refreshing Feishu token:', error);
    }
  }

  async reply(chatId: string, content: string, replyMessageId?: string): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      const host = this.config.host;

      const body: any = {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      };

      const url = `https://${host}/open-apis/im/v1/messages?receive_id_type=chat_id`;
      if (replyMessageId) {
        url.replace('messages', `messages/${replyMessageId}/reply`);
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
        this.logger.error('Failed to send Feishu reply:', data.msg);
      }
    } catch (error) {
      this.logger.error('Error sending Feishu reply:', error);
    }
  }

  async replyCard(chatId: string, cardJson: string, replyMessageId?: string): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      const host = this.config.host;

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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getPairingManager(): PairingManager | null {
    return this.pairingManager;
  }
}
