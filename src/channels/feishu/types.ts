export interface FeishuConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  host: 'open.feishu.cn' | 'open.larksuite.com';
  requireMention: boolean;
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderType: 'user' | 'bot' | 'app';
  content: string;
  messageType: 'text' | 'post' | 'image' | 'file' | 'audio' | 'media' | 'sticker' | 'interactive';
  mentionKeyMap?: Record<string, { id: string; name: string; key: string }>;
  timestamp: string;
}

export interface FeishuCardAction {
  actionId: string;
  value: Record<string, any>;
  timezone: string;
}
