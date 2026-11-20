/**
 * 本番DBへデモ内容（run / 承認待ち / 承認済み＋レポート）を1セット投入する。
 * 既に runs がある場合は何もしない（冪等）。
 * 数値・判定は src/api/agent.ts の決定的エンジン（buildRun）で生成する。
 *
 * 使い方: DATABASE_URL=postgresql:///spatial_agent_studio_prod?host=/var/run/postgresql npx tsx scripts/seed-demo-content.ts
 */
import { Pool } from 'pg';
import { loadConfig } from '../src/api/config';
import { buildRun } from '../src/api/agent';

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });

type SiteRow = { id: string; name: string; model: unknown };

async function main(): Promise<void> {
  const existing = await pool.query<{ c: string }>('SELECT count(*)::text AS c FROM runs');
  if (Number(existing.rows[0]?.c ?? '0') > 0) {
    console.log('[seed-demo] runs already exist; skip');
    return;
  }
  const user = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'manager@example.com' LIMIT 1",
  );
  const managerId = user.rows[0]?.id;
  if (!managerId) throw new Error('demo manager user not found');

  const sites = await pool.query<SiteRow>('SELECT id, name, model FROM sites ORDER BY id LIMIT 2');
  if (sites.rows.length < 2) throw new Error('need at least two sites');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) 承認待ち（盛土 出来形）
    const siteA = sites.rows[0]!;
    const builtA = buildRun('asbuilt', { id: siteA.id, name: siteA.name, model: siteA.model as never });
    const runA = await client.query<{ id: string }>(
      `INSERT INTO runs (site_id, task, status, requested_by, result, steps)
       VALUES ($1,'asbuilt','completed',$2,$3,$4) RETURNING id`,
      [siteA.id, managerId, JSON.stringify(builtA.result), JSON.stringify(builtA.steps)],
    );
    await client.query(
      `INSERT INTO approvals (run_id, site_id, title, summary, risk, task, verdict, verdict_tone, metrics, findings, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,'asbuilt',$6,$7,$8,$9,'pending',$10)`,
      [
        runA.rows[0]!.id,
        siteA.id,
        builtA.approval.title,
        builtA.approval.summary,
        builtA.approval.risk,
        builtA.approval.verdict,
        builtA.approval.verdictTone,
        JSON.stringify(builtA.approval.metrics),
        builtA.approval.findings,
        managerId,
      ],
    );

    // 2) 承認済み＋レポート（重機 安全離隔）
    const siteB = sites.rows[1]!;
    const builtB = buildRun('safety', { id: siteB.id, name: siteB.name, model: siteB.model as never });
    const runB = await client.query<{ id: string }>(
      `INSERT INTO runs (site_id, task, status, requested_by, result, steps)
       VALUES ($1,'safety','completed',$2,$3,$4) RETURNING id`,
      [siteB.id, managerId, JSON.stringify(builtB.result), JSON.stringify(builtB.steps)],
    );
    const approvalB = await client.query<{ id: string }>(
      `INSERT INTO approvals (run_id, site_id, title, summary, risk, task, verdict, verdict_tone, metrics, findings, status, requested_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,'safety',$6,$7,$8,$9,'approved',$10,$10, now() - interval '1 day') RETURNING id`,
      [
        runB.rows[0]!.id,
        siteB.id,
        builtB.approval.title,
        builtB.approval.summary,
        builtB.approval.risk,
        builtB.approval.verdict,
        builtB.approval.verdictTone,
        JSON.stringify(builtB.approval.metrics),
        builtB.approval.findings,
        managerId,
      ],
    );
    await client.query(
      `INSERT INTO reports (site_id, run_id, approval_id, title, verdict, verdict_tone, metrics, findings, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        siteB.id,
        runB.rows[0]!.id,
        approvalB.rows[0]!.id,
        `${builtB.approval.title} 完了報告`,
        builtB.approval.verdict,
        builtB.approval.verdictTone,
        JSON.stringify(builtB.approval.metrics),
        builtB.approval.findings,
        managerId,
      ],
    );

    await client.query('COMMIT');
    console.log('[seed-demo] inserted 2 runs / 2 approvals / 1 report');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
