import path from 'node:path';

export type RoleKey = 'field' | 'agent' | 'hq' | 'it';

export const ROLE_KEYS: RoleKey[] = ['field', 'agent', 'hq', 'it'];

export type AppConfig = {
  port: number;
  databaseUrl: string;
  appOrigin: string;
  nodeEnv: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  staticDir: string;
  corsOrigins: string[];
  /** Cloudflare Access のメールアドレス → 許可ロール（先頭が既定ロール）。 */
  accessRoles: Record<string, RoleKey[]>;
  /** メールドメイン → 許可ロール（個別指定が無い場合のフォールバック）。 */
  accessRoleDomains: Record<string, RoleKey[]>;
};

/**
 * `SAS_ACCESS_ROLES` は `{"user@example.com":["agent","hq","it"]}` 形式のJSON。
 * メールアドレスは公開リポジトリへ入れないため、コードではなく環境変数で渡す。
 */
export function parseAccessRoles(raw: string | undefined): Record<string, RoleKey[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, RoleKey[]> = {};
    for (const [email, roles] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(roles)) continue;
      const clean = roles.filter((r): r is RoleKey => ROLE_KEYS.includes(r as RoleKey));
      const key = email.trim().toLowerCase();
      if (key && clean.length > 0) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** `SAS_ACCESS_ROLE_DOMAINS` は `{"example.co.jp":["field"]}` 形式のJSON。 */
export function parseAccessRoleDomains(raw: string | undefined): Record<string, RoleKey[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, RoleKey[]> = {};
    for (const [domain, roles] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(roles)) continue;
      const clean = roles.filter((r): r is RoleKey => ROLE_KEYS.includes(r as RoleKey));
      const key = domain.trim().toLowerCase().replace(/^@/, '');
      if (key && clean.length > 0) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

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
    accessRoles: overrides.accessRoles ?? parseAccessRoles(process.env.SAS_ACCESS_ROLES),
    accessRoleDomains:
      overrides.accessRoleDomains ?? parseAccessRoleDomains(process.env.SAS_ACCESS_ROLE_DOMAINS),
  };
}
