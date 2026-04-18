import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { GatewayConfig } from '../config/types';
import { SessionManager, Session } from './session';
import { MessageHandler } from './message';
import { getLogger } from '../utils/logger';

export class Gateway {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private sessionManager: SessionManager;
  public messageHandler: MessageHandler;
  private config: GatewayConfig;
  private connections: Map<string, WebSocket> = new Map();
  private logger: any;
  private status: 'stopped' | 'starting' | 'running' | 'stopping' = 'stopped';

  constructor(config: GatewayConfig, sessionDbPath: string = './data/sessions.db') {
    this.config = config;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.sessionManager = new SessionManager(sessionDbPath);
    this.messageHandler = new MessageHandler(this.sessionManager);
    this.logger = getLogger();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    if (this.config.corsOrigins.length > 0) {
      this.app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && this.config.corsOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
        } else {
          next();
        }
      });
    }
  }

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      res.json({
        status: this.status,
        uptime: process.uptime(),
        sessions: this.sessionManager.getActiveSessions(),
        connections: this.connections.size,
      });
    });

    this.app.get('/status', (req, res) => {
      res.json({
        status: this.status,
        port: this.config.port,
        host: this.config.host,
        sessions: this.sessionManager.getAllSessions(),
        activeConnections: this.connections.size,
      });
    });

    this.app.post('/message', this.authenticate.bind(this), async (req, res) => {
      try {
        const { sessionId, content, channel } = req.body;
        const session = this.sessionManager.getOrCreateSession(sessionId || uuidv4(), channel);
        const response = await this.messageHandler.handleMessage(session, content);
        res.json({ success: true, response });
      } catch (error) {
        this.logger.error('Error handling message:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });

    this.app.get('/sessions', this.authenticate.bind(this), (req, res) => {
      res.json(this.sessionManager.getAllSessions());
    });

    this.app.delete('/sessions/:id', this.authenticate.bind(this), (req, res) => {
      this.sessionManager.deleteSession(req.params.id);
      res.json({ success: true });
    });


  }

  private authenticate(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!this.config.authToken) {
      return next();
    }
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== this.config.authToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = uuidv4();
      this.connections.set(clientId, ws);
      this.logger.info(`New WebSocket connection: ${clientId}`);

      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
      }));

      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleWebSocketMessage(ws, clientId, message);
        } catch (error) {
          this.logger.error('WebSocket message error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          }));
        }
      });

      ws.on('close', () => {
        this.connections.delete(clientId);
        this.logger.info(`WebSocket disconnected: ${clientId}`);
      });

      ws.on('error', (error) => {
        this.logger.error(`WebSocket error for ${clientId}:`, error);
        this.connections.delete(clientId);
      });
    });
  }

  private async handleWebSocketMessage(ws: WebSocket, clientId: string, message: any): Promise<void> {
    const { type, sessionId, content, channel } = message;

    switch (type) {
      case 'message': {
        const session = this.sessionManager.getOrCreateSession(sessionId || clientId, channel);
        const response = await this.messageHandler.handleMessage(session, content);
        ws.send(JSON.stringify({
          type: 'response',
          sessionId: session.id,
          content: response,
          timestamp: new Date().toISOString(),
        }));
        break;
      }
      case 'stream': {
        const session = this.sessionManager.getOrCreateSession(sessionId || clientId, channel);
        await this.messageHandler.handleStreamMessage(session, content, (chunk) => {
          ws.send(JSON.stringify({
            type: 'stream_chunk',
            sessionId: session.id,
            content: chunk,
          }));
        });
        ws.send(JSON.stringify({
          type: 'stream_end',
          sessionId: session.id,
        }));
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      }
      case 'subscribe': {
        this.logger.info(`Client ${clientId} subscribed to: ${message.channel}`);
        break;
      }
      default: {
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${type}`,
        }));
      }
    }
  }

  async start(): Promise<void> {
    if (this.status === 'running') {
      this.logger.info('Gateway is already running');
      return;
    }

    this.status = 'starting';
    this.logger.info(`Starting Gateway on ${this.config.host}:${this.config.port}...`);

    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.status = 'running';
        this.logger.info(`Gateway running at ws://${this.config.host}:${this.config.port}/ws`);
        this.logger.info(`Gateway REST API at http://${this.config.host}:${this.config.port}`);
        resolve();
      }).on('error', (error) => {
        this.status = 'stopped';
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.status !== 'running') return;
    
    this.status = 'stopping';
    this.logger.info('Stopping Gateway...');

    this.connections.forEach((ws) => ws.close());
    this.connections.clear();
    this.sessionManager.clearAllSessions();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          this.status = 'stopped';
          this.logger.info('Gateway stopped');
          resolve();
        });
      });
    });
  }

  getStatus(): string {
    return this.status;
  }

  getServer(): http.Server {
    return this.server;
  }

  getApp(): express.Application {
    return this.app;
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  broadcast(message: any, excludeId?: string): void {
    const data = JSON.stringify(message);
    this.connections.forEach((ws, id) => {
      if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}
