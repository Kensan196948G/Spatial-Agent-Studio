import fs from 'node:fs';
import path from 'node:path';

export type RoleKey = 'field' | 'agent' | 'hq' | 'it';

export const ROLE_KEYS: RoleKey[] = ['field', 'agent', 'hq', 'it'];

export type RoleMap = Record<string, RoleKey[]>;

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
  /** 割当ファイル（1行1件）。指定時はこのファイルが env より優先される。 */
  accessRolesFile?: string;
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

/**
 * ロール割当ファイルの形式（1行1件）。
 *   email,role1,role2,...
 *   @domain,role1,role2,...   ← ドメイン単位のフォールバック
 * `#` 始まりの行と空行は無視する。メールは小文字に正規化して扱う。
 */
export function parseRoleLines(raw: string): RoleMap {
  const out: RoleMap = {};
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const [emailPart, ...roleParts] = text.split(',');
    const key = (emailPart || '').trim().toLowerCase();
    if (!key.includes('@')) continue;
    const roles = roleParts
      .map((r) => r.trim().toLowerCase())
      .filter((r): r is RoleKey => ROLE_KEYS.includes(r as RoleKey));
    if (roles.length > 0) out[key] = roles;
  }
  return out;
}

const fileCache = new Map<string, { mtimeMs: number; size: number; map: RoleMap }>();

/** 割当ファイルを読む。更新時刻が変わったときだけ再読込する（編集後は再起動不要）。 */
export function readRoleFile(file: string): RoleMap | null {
  try {
    const st = fs.statSync(file);
    const cached = fileCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.map;
    const map = parseRoleLines(fs.readFileSync(file, 'utf8'));
    fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, map });
    return map;
  } catch {
    return null;
  }
}

/** email に許可されたロール。ファイルがあれば個別指定 → ドメイン → env の順で解決する。 */
export function resolveAccessRoles(config: AppConfig, email: string): RoleKey[] | undefined {
  const key = email.trim().toLowerCase();
  const domain = key.split('@')[1] || '';
  if (config.accessRolesFile) {
    const fromFile = readRoleFile(config.accessRolesFile);
    if (fromFile) {
      const hit = fromFile[key] ?? fromFile[`@${domain}`];
      if (hit) return hit;
    }
  }
  return config.accessRoles[key] ?? config.accessRoleDomains[domain];
}

export function accessRoleSummary(config: AppConfig): {
  mode: 'file' | 'env';
  mappedAddresses: number;
  mappedDomains: number;
} {
  if (config.accessRolesFile) {
    const fromFile = readRoleFile(config.accessRolesFile);
    if (fromFile) {
      const keys = Object.keys(fromFile);
      return {
        mode: 'file',
        mappedAddresses: keys.filter((k) => !k.startsWith('@')).length,
        mappedDomains: keys.filter((k) => k.startsWith('@')).length,
      };
    }
  }
  return {
    mode: 'env',
    mappedAddresses: Object.keys(config.accessRoles).length,
    mappedDomains: Object.keys(config.accessRoleDomains).length,
  };
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
    accessRolesFile: overrides.accessRolesFile ?? (process.env.SAS_ACCESS_ROLES_FILE || undefined),
  };
}
