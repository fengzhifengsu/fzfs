import WebSocket from 'ws';
import { FeishuConfig, FeishuMessage } from './types';
import { getLogger } from '../../utils/logger';

const FEISHU_WS_BASE = 'wss://open.feishu.cn/open-apis/ws';
const LARK_WS_BASE = 'wss://open.larksuite.com/open-apis/ws';

interface WSFrame {
  seq: number;
  events?: any[];
  type?: number;
}

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

  constructor(config: FeishuConfig) {
    this.config = config;
    this.logger = getLogger();
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Feishu channel is disabled');
      return;
    }
    await this.getTenantAccessToken();
    this.connect();
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

    this.ws.on('message', async (data: WebSocket.Data) => {
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

      const data = await response.json();
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

      const data = await response.json();
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

      const data = await response.json();
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
}
