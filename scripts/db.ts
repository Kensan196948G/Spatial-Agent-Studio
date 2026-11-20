import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { hashPassword } from '../src/api/password';
import { appendAudit, verifyAuditChain } from '../src/api/audit';
import { DEFAULT_MODEL } from '../src/shared/terrain';

function loadEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional; CI/Playwright passes env vars directly.
  }
}

function databaseUrl(): string {
  // Local development default: peer authentication over the Unix socket as the OS user.
  // Production / shared environments must pass DATABASE_URL explicitly.
  return (
    process.env.DATABASE_URL ?? 'postgresql:///spatial_agent_studio?host=/var/run/postgresql'
  );
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function migrate(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const dir = path.join(process.cwd(), 'db', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (exists.rowCount) {
        console.log(`[db] skip ${file}`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[db] applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log(`[db] migrations up to date (${files.length} files)`);
  });
}

type SeedUser = { email: string; password: string; name: string; role: 'manager' | 'staff' };

async function seed(): Promise<void> {
  const users: SeedUser[] = [
    {
      email: (process.env.SEED_MANAGER_EMAIL ?? 'manager@example.com').toLowerCase(),
      password: process.env.SEED_MANAGER_PASSWORD ?? 'SasManager!2026',
      name: '現場代理人・所長（デモ）',
      role: 'manager',
    },
    {
      email: (process.env.SEED_STAFF_EMAIL ?? 'staff@example.com').toLowerCase(),
      password: process.env.SEED_STAFF_PASSWORD ?? 'SasStaff!2026',
      name: '現場担当者（デモ）',
      role: 'staff',
    },
  ];

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const u of users) {
        const exists = await client.query('SELECT id FROM users WHERE email = $1', [u.email]);
        if (exists.rowCount) {
          console.log(`[db] user exists: ${u.email}`);
          continue;
        }
        await client.query(
          'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
          [u.email, hashPassword(u.password), u.name, u.role],
        );
        console.log(`[db] seeded user: ${u.email}`);
      }

      const sites = [
        {
          id: 'site-a',
          code: 'A-01',
          name: '○○川 築堤・護岸工事',
          description:
            '河川堤防の盛土と護岸ブロック張。AIが出来形・重機離隔の下書きを作成し、現場代理人が承認します。',
          status: 'active',
          cover: 'embankment',
          splatCount: 12840,
          model: { ...DEFAULT_MODEL, progress: 1, terrainScale: 1 },
        },
        {
          id: 'site-b',
          code: 'B-02',
          name: '△△橋 下部工',
          description: '橋脚基礎の掘削・鉄筋・型枠。週次の出来形確認をAIが下書きします（サンプル）。',
          status: 'attention',
          cover: 'bridge',
          splatCount: 9420,
          model: { ...DEFAULT_MODEL, progress: 0.55, terrainScale: 1.22 },
        },
        {
          id: 'site-c',
          code: 'C-03',
          name: '□□トンネル 坑口部',
          description: '坑口法面の変状点検と掘削進捗。点検調書の下書きをAIが作成します（サンプル）。',
          status: 'idle',
          cover: 'tunnel',
          splatCount: 7310,
          model: { ...DEFAULT_MODEL, progress: 0.3, terrainScale: 1.3 },
        },
        {
          id: 'site-d',
          code: 'D-04',
          name: '国道△△号 法面補修工事',
          description: '法面の補修と排水工。AIが出来形と安全離隔の下書きを作成します（サンプル）。',
          status: 'active',
          cover: 'embankment',
          splatCount: 10880,
          model: { ...DEFAULT_MODEL, progress: 0.78, terrainScale: 1.12 },
        },
        {
          id: 'site-e',
          code: 'E-05',
          name: '海岸堤防 嵩上げ工事',
          description: '堤防の嵩上げと護岸補強。潮位・重機離隔を含む下書きをAIが作成します（サンプル）。',
          status: 'attention',
          cover: 'embankment',
          splatCount: 8650,
          model: { ...DEFAULT_MODEL, progress: 0.42, terrainScale: 1.26 },
        },
      ];

      for (const s of sites) {
        await client.query(
          `INSERT INTO sites (id, code, name, description, status, cover, splat_count, model)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            s.id,
            s.code,
            s.name,
            s.description,
            s.status,
            s.cover,
            s.splatCount,
            JSON.stringify(s.model),
          ],
        );
        console.log(`[db] seeded site: ${s.id}`);
      }

      const versionsBySite: Record<string, Array<{ date: string; progress: number }>> = {
        'site-a': [
          { date: '2026-10-30', progress: 0.72 },
          { date: '2026-11-06', progress: 0.85 },
          { date: '2026-11-18', progress: 1.0 },
        ],
        'site-b': [
          { date: '2026-10-30', progress: 0.45 },
          { date: '2026-11-06', progress: 0.5 },
          { date: '2026-11-17', progress: 0.55 },
        ],
        'site-c': [
          { date: '2026-10-30', progress: 0.2 },
          { date: '2026-11-06', progress: 0.25 },
          { date: '2026-11-16', progress: 0.3 },
        ],
        'site-d': [
          { date: '2026-10-30', progress: 0.6 },
          { date: '2026-11-06', progress: 0.7 },
          { date: '2026-11-17', progress: 0.78 },
        ],
        'site-e': [
          { date: '2026-10-30', progress: 0.3 },
          { date: '2026-11-06', progress: 0.36 },
          { date: '2026-11-15', progress: 0.42 },
        ],
      };

      for (const [siteId, versions] of Object.entries(versionsBySite)) {
        for (let i = 0; i < versions.length; i += 1) {
          const v = versions[i]!;
          await client.query(
            `INSERT INTO site_versions (site_id, version_date, progress, is_latest)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (site_id, version_date) DO NOTHING`,
            [siteId, v.date, v.progress, i === versions.length - 1],
          );
        }
      }

      const auditCount = await client.query<{ c: string }>('SELECT count(*)::text AS c FROM audit_events');
      if (auditCount.rows[0]?.c === '0') {
        await appendAudit(client, 'SYSTEM', 'SEED', 'デモデータ初期化（現場3件・ユーザー2名・監査連鎖の起点）');
        console.log('[db] seeded initial audit event');
      }

      await client.query('COMMIT');
      console.log('[db] seed complete');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function reset(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== '1') {
    throw new Error(
      'Refusing to reset: set ALLOW_DB_RESET=1 and use a dedicated verification database (spatial_agent_studio_test / _preview / _dev).',
    );
  }
  await withClient(async (client) => {
    const db = await client.query<{ current_database: string }>('SELECT current_database()');
    const name = db.rows[0]?.current_database ?? '';
    if (!/^spatial_agent_studio(_test|_preview|_dev)?$/.test(name)) {
      throw new Error(`Refusing to reset unexpected database: ${name}`);
    }
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log(`[db] reset schema public on ${name}`);
  });
}

async function verify(): Promise<void> {
  await withClient(async (client) => {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const counts: Record<string, number> = {};
    for (const t of tables.rows.map((r) => r.table_name)) {
      if (t === 'schema_migrations') continue;
      const count = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${t}"`);
      counts[t] = Number(count.rows[0]?.c ?? 0);
    }
    const chain = await verifyAuditChain(client);
    console.log(JSON.stringify({ tables: tables.rows.map((r) => r.table_name), counts, audit: chain }, null, 2));
    if (!chain.ok) {
      process.exitCode = 1;
    }
  });
}

async function main(): Promise<void> {
  loadEnv();
  const cmd = process.argv[2];
  switch (cmd) {
    case 'migrate':
      await migrate();
      break;
    case 'seed':
      await seed();
      break;
    case 'reset':
      await reset();
      break;
    case 'verify':
      await verify();
      break;
    default:
      console.log('usage: tsx scripts/db.ts <migrate|seed|reset|verify>');
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[db] failed:', error);
  process.exitCode = 1;
});
