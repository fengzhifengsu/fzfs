import winston from 'winston';
import fs from 'fs-extra';
import path from 'path';

let logger: winston.Logger | null = null;

export function initLogger(level: string = 'info', filePath: string = './logs/neural-agent.log'): winston.Logger {
  if (logger) return logger;

  const logDir = path.dirname(filePath);
  fs.ensureDirSync(logDir);

  logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({
        filename: filePath,
        maxsize: 5242880,
        maxFiles: 5,
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level}] ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`;
          })
        ),
      }),
    ],
  });

  return logger;
}

export function getLogger(): winston.Logger {
  if (!logger) {
    return initLogger();
  }
  return logger;
}
