import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { getLogger } from '../../utils/logger';

export interface PairedUser {
  feishuOpenId: string;
  feishuName: string;
  pairedAt: Date;
  lastActive: Date;
}

export interface PendingPair {
  code: string;
  feishuOpenId: string;
  feishuName: string;
  createdAt: Date;
  expiresAt: Date;
}

export class PairingManager {
  private storePath: string;
  private pairedUsers: Map<string, PairedUser> = new Map();
  private pendingPairs: Map<string, PendingPair> = new Map();
  private logger: any;

  constructor(storePath: string = './data/paired-users.json') {
    this.storePath = storePath;
    this.logger = getLogger();
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.storePath)) {
      fs.ensureDirSync(path.dirname(this.storePath));
      return;
    }

    try {
      const data = fs.readJsonSync(this.storePath);
      for (const user of data.pairedUsers || []) {
        this.pairedUsers.set(user.feishuOpenId, {
          ...user,
          pairedAt: new Date(user.pairedAt),
          lastActive: new Date(user.lastActive),
        });
      }
      for (const pair of data.pendingPairs || []) {
        this.pendingPairs.set(pair.code, {
          ...pair,
          createdAt: new Date(pair.createdAt),
          expiresAt: new Date(pair.expiresAt),
        });
      }
      this.cleanupExpiredPairs();
      this.logger.info(`Loaded ${this.pairedUsers.size} paired users, ${this.pendingPairs.size} pending pairs`);
    } catch (error) {
      this.logger.error('Failed to load paired users:', error);
    }
  }

  save(): void {
    const data = {
      pairedUsers: Array.from(this.pairedUsers.values()),
      pendingPairs: Array.from(this.pendingPairs.values()),
    };
    fs.writeJsonSync(this.storePath, data, { spaces: 2 });
  }

  generatePairCode(feishuOpenId: string, feishuName: string): string {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    const pair: PendingPair = {
      code,
      feishuOpenId,
      feishuName,
      createdAt: now,
      expiresAt,
    };

    this.pendingPairs.set(code, pair);
    this.save();

    this.logger.info(`Generated pair code: ${code} for ${feishuName} (${feishuOpenId})`);
    return code;
  }

  verifyPairCode(code: string): { success: boolean; userId?: string; feishuName?: string; error?: string } {
    const normalizedCode = code.toUpperCase().trim();
    const pair = this.pendingPairs.get(normalizedCode);

    if (!pair) {
      return { success: false, error: 'Invalid pairing code' };
    }

    if (new Date() > pair.expiresAt) {
      this.pendingPairs.delete(normalizedCode);
      this.save();
      return { success: false, error: 'Pairing code has expired (5 minutes)' };
    }

    const userId = `feishu-${pair.feishuOpenId}`;

    const pairedUser: PairedUser = {
      feishuOpenId: pair.feishuOpenId,
      feishuName: pair.feishuName,
      pairedAt: new Date(),
      lastActive: new Date(),
    };

    this.pairedUsers.set(pair.feishuOpenId, pairedUser);
    this.pendingPairs.delete(normalizedCode);
    this.save();

    this.logger.info(`Paired user: ${pair.feishuName} (${pair.feishuOpenId}) -> ${userId}`);
    return { success: true, userId, feishuName: pair.feishuName };
  }

  isPaired(feishuOpenId: string): boolean {
    return this.pairedUsers.has(feishuOpenId);
  }

  getPairedUser(feishuOpenId: string): PairedUser | undefined {
    return this.pairedUsers.get(feishuOpenId);
  }

  getUserId(feishuOpenId: string): string | undefined {
    if (this.pairedUsers.has(feishuOpenId)) {
      return `feishu-${feishuOpenId}`;
    }
    return undefined;
  }

  getFeishuOpenId(userId: string): string | undefined {
    if (userId.startsWith('feishu-')) {
      const openId = userId.slice(7);
      if (this.pairedUsers.has(openId)) {
        return openId;
      }
    }
    return undefined;
  }

  removePairedUser(feishuOpenId: string): boolean {
    const result = this.pairedUsers.delete(feishuOpenId);
    if (result) {
      this.save();
      this.logger.info(`Removed paired user: ${feishuOpenId}`);
    }
    return result;
  }

  listPairedUsers(): PairedUser[] {
    return Array.from(this.pairedUsers.values());
  }

  private cleanupExpiredPairs(): void {
    const now = new Date();
    let removed = 0;
    for (const [code, pair] of this.pendingPairs) {
      if (now > pair.expiresAt) {
        this.pendingPairs.delete(code);
        removed++;
      }
    }
    if (removed > 0) {
      this.save();
      this.logger.info(`Cleaned up ${removed} expired pair codes`);
    }
  }

  getStats(): any {
    return {
      pairedUsers: this.pairedUsers.size,
      pendingPairs: this.pendingPairs.size,
    };
  }
}
