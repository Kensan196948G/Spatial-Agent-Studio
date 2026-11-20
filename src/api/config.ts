import path from 'node:path';

export type AppConfig = {
  port: number;
  databaseUrl: string;
  appOrigin: string;
  nodeEnv: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  staticDir: string;
  corsOrigins: string[];
};

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // optional
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv();
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const localSocketUrl = 'postgresql:///spatial_agent_studio?host=/var/run/postgresql';
  const databaseUrl =
    overrides.databaseUrl ??
    process.env.DATABASE_URL ??
    (nodeEnv === 'production' ? undefined : localSocketUrl);
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required in production (see .env.example)');
  }
  return {
    port: overrides.port ?? Number(process.env.PORT ?? 7440),
    databaseUrl,
    appOrigin: overrides.appOrigin ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:5174',
    nodeEnv,
    cookieSecure:
      overrides.cookieSecure ??
      (process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'),
    sessionTtlHours: overrides.sessionTtlHours ?? Number(process.env.SESSION_TTL_HOURS ?? 8),
    staticDir: overrides.staticDir ?? path.resolve('dist/web'),
    corsOrigins:
      overrides.corsOrigins ??
      (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  };
}
