import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { AppConfig } from './config';
import { createPool } from './db';
import { registerRoutes } from './routes';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
                'req.body.password',
              ],
              censor: '[REDACTED]',
            },
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.decorateRequest('user', null);
  await app.register(cookie);

  const allowedOrigins = new Set([
    config.appOrigin,
    ...config.corsOrigins,
    'http://127.0.0.1:5174',
    'http://localhost:5174',
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
  ]);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  });

  const pool = createPool(config.databaseUrl);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.nodeEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      );
    }
    return payload;
  });

  registerRoutes(app, { pool, config });

  if (existsSync(config.staticDir)) {
    await app.register(fastifyStatic, { root: config.staticDir, prefix: '/' });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'APIエンドポイントが見つかりません。' } });
    }
    if (existsSync(config.staticDir)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({
      error: {
        code: 'NOT_BUILT',
        message: 'WebUIが未ビルドです。`pnpm build` を実行してください。',
      },
    });
  });

  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, 'unhandled error');
    if (reply.sent) return;
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'サーバ内部エラーが発生しました。' },
    });
  });

  return app;
}
