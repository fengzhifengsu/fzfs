import cron from 'node-cron';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  channel?: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  createdAt: Date;
}

export interface Webhook {
  id: string;
  name: string;
  path: string;
  method: string;
  prompt: string;
  secret?: string;
  enabled: boolean;
  createdAt: Date;
  lastTriggered?: Date;
}

export type JobHandler = (data: any) => Promise<void>;

export class AutomationEngine {
  private jobs: Map<string, CronJob> = new Map();
  private webhooks: Map<string, Webhook> = new Map();
  private handlers: JobHandler[] = [];
  private logger: any;

  constructor() {
    this.logger = getLogger();
  }

  registerHandler(handler: JobHandler): void {
    this.handlers.push(handler);
  }

  createCronJob(job: Omit<CronJob, 'id' | 'createdAt'>): CronJob {
    const cronJob: CronJob = {
      ...job,
      id: uuidv4(),
      createdAt: new Date(),
    };

    this.jobs.set(cronJob.id, cronJob);
    this.scheduleCronJob(cronJob);
    this.logger.info(`Created cron job: ${cronJob.name} (${cronJob.schedule})`);
    return cronJob;
  }

  private scheduleCronJob(job: CronJob): void {
    if (!job.enabled) return;

    try {
      const task = cron.schedule(job.schedule, async () => {
        this.logger.info(`Executing cron job: ${job.name}`);
        await this.executeJob(job);
        job.lastRun = new Date();
      });
      this.logger.info(`Scheduled job "${job.name}" successfully`);
    } catch (error) {
      this.logger.error(`Failed to schedule job ${job.name}:`, error);
    }
  }

  private async executeJob(job: CronJob): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler({
          type: 'cron',
          jobId: job.id,
          jobName: job.name,
          prompt: job.prompt,
          channel: job.channel,
        });
      } catch (error) {
        this.logger.error(`Handler error in job ${job.name}:`, error);
      }
    }
  }

  deleteCronJob(jobId: string): boolean {
    const result = this.jobs.delete(jobId);
    if (result) {
      this.logger.info(`Deleted cron job: ${jobId}`);
    }
    return result;
  }

  toggleCronJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.enabled = !job.enabled;
    this.jobs.set(jobId, job);
    return true;
  }

  getCronJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  createWebhook(webhook: Omit<Webhook, 'id' | 'createdAt'>): Webhook {
    const wh: Webhook = {
      ...webhook,
      id: uuidv4(),
      createdAt: new Date(),
    };

    this.webhooks.set(wh.id, wh);
    this.logger.info(`Created webhook: ${wh.name} (${wh.path})`);
    return wh;
  }

  async triggerWebhook(path: string, data: any): Promise<void> {
    for (const webhook of this.webhooks.values()) {
      if (webhook.path === path && webhook.enabled) {
        this.logger.info(`Triggering webhook: ${webhook.name}`);
        webhook.lastTriggered = new Date();

        for (const handler of this.handlers) {
          try {
            await handler({
              type: 'webhook',
              webhookId: webhook.id,
              webhookName: webhook.name,
              prompt: webhook.prompt,
              data,
            });
          } catch (error) {
            this.logger.error(`Handler error in webhook ${webhook.name}:`, error);
          }
        }
      }
    }
  }

  deleteWebhook(webhookId: string): boolean {
    const result = this.webhooks.delete(webhookId);
    if (result) {
      this.logger.info(`Deleted webhook: ${webhookId}`);
    }
    return result;
  }

  getWebhooks(): Webhook[] {
    return Array.from(this.webhooks.values());
  }

  getWebhookByPath(path: string): Webhook | undefined {
    for (const webhook of this.webhooks.values()) {
      if (webhook.path === path) {
        return webhook;
      }
    }
    return undefined;
  }

  saveJobs(filePath: string): void {
    const jobsData = Array.from(this.jobs.values());
    fs.writeJsonSync(filePath, jobsData, { spaces: 2 });
  }

  loadJobs(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const jobsData = fs.readJsonSync(filePath) as CronJob[];
      for (const job of jobsData) {
        this.jobs.set(job.id, job);
        this.scheduleCronJob(job);
      }
    } catch (error) {
      this.logger.error('Failed to load cron jobs:', error);
    }
  }

  saveWebhooks(filePath: string): void {
    const webhooksData = Array.from(this.webhooks.values());
    fs.writeJsonSync(filePath, webhooksData, { spaces: 2 });
  }

  loadWebhooks(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const webhooksData = fs.readJsonSync(filePath) as Webhook[];
      for (const webhook of webhooksData) {
        this.webhooks.set(webhook.id, webhook);
      }
    } catch (error) {
      this.logger.error('Failed to load webhooks:', error);
    }
  }

  getStats(): any {
    return {
      totalJobs: this.jobs.size,
      enabledJobs: Array.from(this.jobs.values()).filter(j => j.enabled).length,
      totalWebhooks: this.webhooks.size,
      enabledWebhooks: Array.from(this.webhooks.values()).filter(w => w.enabled).length,
    };
  }
}
