import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AppConfig } from './config';
import { appendAudit, verifyAuditChain } from './audit';
import { TASK_LABEL, buildRun } from './agent';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  findSessionUser,
  isAllowedOrigin,
  mapUser,
  requestToken,
  setSessionCookie,
} from './auth';
import { verifyPassword } from './password';
import {
  mapApproval,
  mapAudit,
  mapReport,
  mapSiteSummary,
  type ApprovalRow,
  type AuditRow,
  type ReportRow,
  type SiteRow,
} from './mappers';
import type {
  Approval,
  ApprovalStatus,
  AuditEvent,
  AuditVerifyResult,
  Bootstrap,
  Dashboard,
  Report,
  Run,
  RunResult,
  RunStep,
  SiteDetail,
  SiteSummary,
  TaskKind,
  User,
} from '../shared/types';

type Deps = { pool: Pool; config: AppConfig };

const APPROVAL_SELECT = `
  SELECT a.*, s.name AS site_name,
         u.name AS requested_by_name, u.role AS requested_by_role,
         d.name AS decided_by_name
    FROM approvals a
    JOIN sites s ON s.id = a.site_id
    JOIN users u ON u.id = a.requested_by
    LEFT JOIN users d ON d.id = a.decided_by
`;

const REPORT_SELECT = `
  SELECT r.*, s.name AS site_name, u.name AS created_by_name
    FROM reports r
    JOIN sites s ON s.id = r.site_id
    JOIN users u ON u.id = r.created_by
`;

const SITE_SELECT = `
  SELECT s.*,
         (SELECT count(*) FROM approvals a WHERE a.site_id = s.id AND a.status = 'pending') AS pending_approvals,
         (SELECT max(r.created_at) FROM runs r WHERE r.site_id = s.id) AS last_run_at,
         (SELECT v.progress FROM site_versions v WHERE v.site_id = s.id ORDER BY v.version_date DESC LIMIT 1) AS progress,
         (SELECT v.version_date FROM site_versions v WHERE v.site_id = s.id ORDER BY v.version_date DESC LIMIT 1) AS version_date
    FROM sites s
`;

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

async function audit(pool: Pool, actor: string, type: string, detail: string): Promise<AuditEvent | null> {
  const client = await pool.connect();
  try {
    return await appendAudit(client, actor, type, detail);
  } catch (error) {
    console.error('[audit] append failed:', (error as Error).message);
    return null;
  } finally {
    client.release();
  }
}

async function authGuard(pool: Pool, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = requestToken(req);
  if (!token) {
    sendError(reply, 401, 'UNAUTHENTICATED', 'ログインが必要です。');
    return;
  }
  const user = await findSessionUser(pool, token);
  if (!user) {
    clearSessionCookie(reply);
    sendError(reply, 401, 'SESSION_EXPIRED', 'セッションが切れました。再ログインしてください。');
    return;
  }
  req.user = user;
}

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});
const accessSchema = z.object({ email: z.string().trim().email().max(200) });
const runSchema = z.object({ task: z.enum(['asbuilt', 'safety']) });
const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});

const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function attemptKey(req: FastifyRequest, email: string): string {
  return `${req.ip}|${email.toLowerCase()}`;
}

function tooManyAttempts(key: string): boolean {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return rec.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const rec = loginAttempts.get(key);
  if (!rec || Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  rec.count += 1;
}

async function buildDashboard(pool: Pool): Promise<Dashboard> {
  const siteResult = await pool.query<SiteRow>(`${SITE_SELECT} ORDER BY s.id ASC`);
  const sites: SiteSummary[] = siteResult.rows.map(mapSiteSummary);

  const pendingResult = await pool.query<ApprovalRow>(
    `${APPROVAL_SELECT} WHERE a.status = 'pending' ORDER BY a.created_at DESC LIMIT 5`,
  );
  const pending = pendingResult.rows.map(mapApproval);

  const kpiResult = await pool.query<{ drafts: string; alerts: string }>(
    `SELECT
       (SELECT count(*) FROM approvals WHERE created_at > now() - interval '7 days') AS drafts,
       (SELECT count(*) FROM runs
         WHERE task = 'safety'
           AND result->'scan'->>'verdict' = 'intruded'
           AND created_at > now() - interval '7 days') AS alerts`,
  );
  const drafts = Number(kpiResult.rows[0]?.drafts ?? 0);
  const alerts = Number(kpiResult.rows[0]?.alerts ?? 0);
  const pendingCount = sites.reduce((sum, s) => sum + s.pendingApprovals, 0);

  const recentResult = await pool.query<AuditRow>(
    'SELECT seq, actor, type, detail, prev_hash, hash, created_at FROM audit_events ORDER BY seq DESC LIMIT 12',
  );

  return {
    sites,
    kpis: {
      activeSites: sites.filter((s) => s.status === 'active').length,
      pendingApprovals: pendingCount,
      draftsThisWeek: drafts,
      alertsThisWeek: alerts,
      savedHours: Math.round((drafts * 1.4 + pendingCount * 0.5) * 10) / 10,
    },
    recent: recentResult.rows.map(mapAudit),
    pending,
  };
}

async function loadApprovalById(pool: Pool, id: string): Promise<Approval | null> {
  const result = await pool.query<ApprovalRow>(`${APPROVAL_SELECT} WHERE a.id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapApproval(row) : null;
}

async function loadReports(pool: Pool, siteId?: string): Promise<Report[]> {
  const result = siteId
    ? await pool.query<ReportRow>(
        `${REPORT_SELECT} WHERE r.site_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [siteId],
      )
    : await pool.query<ReportRow>(`${REPORT_SELECT} ORDER BY r.created_at DESC LIMIT 50`);
  return result.rows.map(mapReport);
}

function mapRunRow(
  row: {
    id: string;
    site_id: string;
    task: TaskKind;
    status: 'completed';
    result: RunResult;
    steps: RunStep[];
    created_at: Date | string;
    requested_by_name: string;
    requested_by_role: 'manager' | 'staff';
  },
  approval: Approval | null,
): Run {
  return {
    id: row.id,
    siteId: row.site_id,
    task: row.task,
    status: row.status,
    createdBy: { name: row.requested_by_name, role: row.requested_by_role },
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    result: row.result,
    steps: row.steps,
    approval,
  };
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { pool, config } = deps;
  const guard = (req: FastifyRequest, reply: FastifyReply): Promise<void> =>
    authGuard(pool, req, reply);

  // ---------- health ----------
  app.get('/api/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return {
        ok: true,
        db: 'up',
        version: '0.1.0',
        time: new Date().toISOString(),
        aiMode: 'demo-deterministic',
      };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down', version: '0.1.0' });
    }
  });

  // ---------- auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    if (!isAllowedOrigin(req, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN', '許可されていないOriginです。');
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_BODY', 'メールアドレスとパスワードを入力してください。');
    }
    const { email, password } = parsed.data;
    const key = attemptKey(req, email);
    if (tooManyAttempts(key)) {
      await audit(pool, 'SYSTEM', 'LOGIN_THROTTLED', `試行回数超過: ${email}`);
      return sendError(reply, 429, 'TOO_MANY_ATTEMPTS', '試行回数が上限に達しました。10分後に再試行してください。');
    }

    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      role: 'manager' | 'staff';
      password_hash: string;
    }>('SELECT id, email, name, role, password_hash FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      recordFailure(key);
      await audit(pool, 'SYSTEM', 'LOGIN_FAILED', `認証失敗: ${email.toLowerCase()}`);
      return sendError(reply, 401, 'INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが正しくありません。');
    }
    loginAttempts.delete(key);
    const { token, expiresAt } = await createSession(pool, row.id, config.sessionTtlHours);
    const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    setSessionCookie(reply, token, config, maxAge);
    await audit(pool, `HUMAN:${row.name}`, 'LOGIN', 'ログイン');
    return { user: mapUser(row), token };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (!isAllowedOrigin(req, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN', '許可されていないOriginです。');
    }
    const token = requestToken(req);
    if (token) {
      const user = await findSessionUser(pool, token);
      await destroySession(pool, token);
      if (user) await audit(pool, `HUMAN:${user.name}`, 'LOGOUT', 'ログアウト');
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: guard }, async (req) => ({ user: req.user as User }));

  /**
   * Cloudflare Access 通過後のサインイン。
   *
   * Access が本人確認を行い、SPA は同Originの /cdn-cgi/access/get-identity から
   * メールアドレスを取得してこのエンドポイントへ渡す。どのロールを許すかは
   * 環境変数 `SAS_ACCESS_ROLES`（個別）／`SAS_ACCESS_ROLE_DOMAINS`（ドメイン）で決まり、
   * 未登録のメールは拒否する。実在のメールアドレスはリポジトリに置かない。
   */
  app.post('/api/auth/access', async (req, reply) => {
    if (!isAllowedOrigin(req, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN', '許可されていないOriginです。');
    }
    const parsed = accessSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_BODY', 'メールアドレスを指定してください。');
    }
    const email = parsed.data.email.toLowerCase();
    const domain = email.split('@')[1] || '';
    const roles = config.accessRoles[email] ?? config.accessRoleDomains[domain];
    if (!roles || roles.length === 0) {
      await audit(pool, 'SYSTEM', 'ACCESS_ROLE_UNMAPPED', 'Accessメールにロールが未設定');
      return sendError(
        reply,
        403,
        'ROLE_NOT_MAPPED',
        'このアカウントにはロールが割り当てられていません。管理者に連絡してください。',
      );
    }
    // 現場担当者のみ staff（承認不可）。それ以外は manager 相当のデモアカウントを使う。
    const accountEmail = roles.every((r) => r === 'field') ? 'staff@example.com' : 'manager@example.com';
    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      role: 'manager' | 'staff';
    }>('SELECT id, email, name, role FROM users WHERE email = $1', [accountEmail]);
    const row = result.rows[0];
    if (!row) {
      return sendError(reply, 500, 'DEMO_USER_MISSING', 'デモアカウントが初期化されていません。');
    }
    const { token, expiresAt } = await createSession(pool, row.id, config.sessionTtlHours);
    const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    setSessionCookie(reply, token, config, maxAge);
    await audit(pool, `HUMAN:${row.name}`, 'ACCESS_LOGIN', `Access認証: ${roles.join('/')}`);
    return { user: mapUser(row), token, roles, defaultRole: roles[0] };
  });

  app.get('/api/bootstrap', { preHandler: guard }, async (req) => {
    const dashboard = await buildDashboard(pool);
    const bootstrap: Bootstrap = { user: req.user as User, dashboard };
    return bootstrap;
  });

  // ---------- dashboard / sites ----------
  app.get('/api/dashboard', { preHandler: guard }, async () => buildDashboard(pool));

  app.get('/api/sites', { preHandler: guard }, async () => {
    const result = await pool.query<SiteRow>(`${SITE_SELECT} ORDER BY s.id ASC`);
    return { sites: result.rows.map(mapSiteSummary) };
  });

  app.get('/api/sites/:id', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const siteResult = await pool.query<SiteRow>(`${SITE_SELECT} WHERE s.id = $1`, [id]);
    const row = siteResult.rows[0];
    if (!row) return sendError(reply, 404, 'SITE_NOT_FOUND', '現場が見つかりません。');
    const versionResult = await pool.query<{
      version_date: Date | string;
      progress: string;
      is_latest: boolean;
    }>(
      `SELECT version_date, progress, is_latest FROM site_versions
        WHERE site_id = $1 ORDER BY version_date ASC`,
      [id],
    );
    const detail: SiteDetail = {
      ...mapSiteSummary(row),
      model: row.model,
      versions: versionResult.rows.map((v) => ({
        date:
          v.version_date instanceof Date
            ? v.version_date.toISOString().slice(0, 10)
            : String(v.version_date).slice(0, 10),
        label: '',
        progress: Number(v.progress),
        isLatest: v.is_latest,
      })),
    };
    detail.versions = detail.versions.map((v) => ({
      ...v,
      label: `${Number(v.date.slice(5, 7))}/${v.date.slice(8, 10)}`,
    }));
    return detail;
  });

  app.get('/api/sites/:id/reports', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await pool.query('SELECT 1 FROM sites WHERE id = $1', [id]);
    if (!site.rowCount) return sendError(reply, 404, 'SITE_NOT_FOUND', '現場が見つかりません。');
    return { reports: await loadReports(pool, id) };
  });

  // ---------- AI run (demo orchestrator + deterministic engine) ----------
  app.post('/api/sites/:id/runs', { preHandler: guard }, async (req, reply) => {
    if (!isAllowedOrigin(req, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN', '許可されていないOriginです。');
    }
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_BODY', 'task は asbuilt または safety を指定してください。');
    }
    const user = req.user as User;
    const { id } = req.params as { id: string };
    const task = parsed.data.task;
    const siteResult = await pool.query<SiteRow>('SELECT * FROM sites WHERE id = $1', [id]);
    const site = siteResult.rows[0];
    if (!site) return sendError(reply, 404, 'SITE_NOT_FOUND', '現場が見つかりません。');

    const built = buildRun(task, { id: site.id, name: site.name, model: site.model });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const runResult = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO runs (site_id, task, status, requested_by, result, steps)
         VALUES ($1, $2, 'completed', $3, $4, $5)
         RETURNING id, created_at`,
        [
          site.id,
          task,
          user.id,
          JSON.stringify(built.result),
          JSON.stringify(built.steps),
        ],
      );
      const runRow = runResult.rows[0]!;
      const approvalResult = await client.query<{
        id: string;
        created_at: Date;
      }>(
        `INSERT INTO approvals
           (run_id, site_id, title, summary, risk, task, verdict, verdict_tone, metrics, findings, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, created_at`,
        [
          runRow.id,
          site.id,
          built.approval.title,
          built.approval.summary,
          built.approval.risk,
          task,
          built.approval.verdict,
          built.approval.verdictTone,
          JSON.stringify(built.approval.metrics),
          built.approval.findings,
          user.id,
        ],
      );
      const approvalRow = approvalResult.rows[0]!;

      const events: AuditEvent[] = [];
      events.push(
        await appendAudit(
          client,
          `HUMAN:${user.name}`,
          'RUN_REQUESTED',
          `${site.name} / ${TASK_LABEL[task]}`,
        ),
      );
      events.push(
        await appendAudit(
          client,
          'AI:計算エンジン（デモ）',
          'RUN_COMPLETED',
          `${TASK_LABEL[task]} / 判定 ${built.approval.verdict}`,
        ),
      );
      events.push(
        await appendAudit(
          client,
          'SYSTEM',
          'APPROVAL_REQUESTED',
          `${built.approval.title}（影響度: ${built.approval.risk}）`,
        ),
      );
      await client.query('COMMIT');

      const approval: Approval = {
        id: approvalRow.id,
        runId: runRow.id,
        siteId: site.id,
        siteName: site.name,
        title: built.approval.title,
        summary: built.approval.summary,
        risk: built.approval.risk,
        status: 'pending',
        requestedBy: { name: user.name, role: user.role },
        decidedBy: null,
        decidedAt: null,
        createdAt: approvalRow.created_at.toISOString(),
        task,
        verdict: built.approval.verdict,
        verdictTone: built.approval.verdictTone,
        metrics: built.approval.metrics,
        findings: built.approval.findings,
      };
      const run: Run = {
        id: runRow.id,
        siteId: site.id,
        task,
        status: 'completed',
        createdBy: { name: user.name, role: user.role },
        createdAt: runRow.created_at.toISOString(),
        result: built.result,
        steps: built.steps,
        approval,
      };
      return reply.code(201).send({ run, auditEvents: events });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/runs/:id', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await pool.query<{
      id: string;
      site_id: string;
      task: TaskKind;
      status: 'completed';
      result: RunResult;
      steps: RunStep[];
      created_at: Date;
      requested_by_name: string;
      requested_by_role: 'manager' | 'staff';
    }>(
      `SELECT r.id, r.site_id, r.task, r.status, r.result, r.steps, r.created_at,
              u.name AS requested_by_name, u.role AS requested_by_role
         FROM runs r JOIN users u ON u.id = r.requested_by
        WHERE r.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return sendError(reply, 404, 'RUN_NOT_FOUND', '実行結果が見つかりません。');
    const approvalResult = await pool.query<ApprovalRow>(
      `${APPROVAL_SELECT} WHERE a.run_id = $1 ORDER BY a.created_at DESC LIMIT 1`,
      [id],
    );
    const approval = approvalResult.rows[0] ? mapApproval(approvalResult.rows[0]) : null;
    return { run: mapRunRow(row, approval) };
  });

  // ---------- approvals ----------
  app.get('/api/approvals', { preHandler: guard }, async (req, reply) => {
    const query = req.query as { status?: string };
    const status = query.status ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return sendError(reply, 400, 'INVALID_QUERY', 'status は pending/approved/rejected/all です。');
    }
    const result =
      status === 'all'
        ? await pool.query<ApprovalRow>(`${APPROVAL_SELECT} ORDER BY a.created_at DESC LIMIT 100`)
        : await pool.query<ApprovalRow>(
            `${APPROVAL_SELECT} WHERE a.status = $1 ORDER BY a.created_at DESC LIMIT 100`,
            [status as ApprovalStatus],
          );
    return { approvals: result.rows.map(mapApproval) };
  });

  app.get('/api/approvals/:id', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const approval = await loadApprovalById(pool, id);
    if (!approval) return sendError(reply, 404, 'APPROVAL_NOT_FOUND', '承認依頼が見つかりません。');
    return { approval };
  });

  app.post('/api/approvals/:id/decision', { preHandler: guard }, async (req, reply) => {
    if (!isAllowedOrigin(req, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN', '許可されていないOriginです。');
    }
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_BODY', 'decision は approve または reject を指定してください。');
    }
    const user = req.user as User;
    const { id } = req.params as { id: string };
    const { decision, note } = parsed.data;

    if (!user.canApprove) {
      await audit(pool, `HUMAN:${user.name}`, 'DENY', `承認権限なし: approval ${id}`);
      return sendError(reply, 403, 'FORBIDDEN', '承認・却下は現場代理人（承認権限あり）のみ実行できます。');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<ApprovalRow>(
        `${APPROVAL_SELECT} WHERE a.id = $1 FOR UPDATE OF a`,
        [id],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'APPROVAL_NOT_FOUND', '承認依頼が見つかりません。');
      }
      if (row.status !== 'pending') {
        await client.query('ROLLBACK');
        return sendError(reply, 409, 'ALREADY_DECIDED', 'この承認依頼はすでに判断済みです。');
      }

      const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'rejected';
      await client.query(
        'UPDATE approvals SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3',
        [status, user.id, id],
      );

      let report: Report | null = null;
      if (decision === 'approve') {
        const reportResult = await client.query<{ id: string }>(
          `INSERT INTO reports (site_id, run_id, approval_id, title, verdict, verdict_tone, metrics, findings, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            row.site_id,
            row.run_id,
            row.id,
            row.title.replace('（ドラフト）を確定', '').replace('を確認', ''),
            row.verdict,
            row.verdict_tone,
            JSON.stringify(row.metrics),
            row.findings,
            user.id,
          ],
        );
        const reportId = reportResult.rows[0]!.id;
        await appendAudit(
          client,
          `HUMAN:${user.name}`,
          'APPROVED',
          `${row.title} / ${row.site_name}${note ? ` / メモ: ${note}` : ''}`,
        );
        await appendAudit(client, 'SYSTEM', 'REPORT_CREATED', `${row.title} / report ${reportId}`);
        const reportRow = await client.query<ReportRow>(
          `${REPORT_SELECT} WHERE r.id = $1`,
          [reportId],
        );
        report = reportRow.rows[0] ? mapReport(reportRow.rows[0]) : null;
      } else {
        await appendAudit(
          client,
          `HUMAN:${user.name}`,
          'REJECTED',
          `${row.title} / ${row.site_name}${note ? ` / 理由: ${note}` : ''}`,
        );
      }

      await client.query('COMMIT');
      const approval = await loadApprovalById(pool, id);
      return { approval, report };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // ---------- reports ----------
  app.get('/api/reports', { preHandler: guard }, async () => ({ reports: await loadReports(pool) }));

  // ---------- audit ----------
  app.get('/api/audit', { preHandler: guard }, async (req) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 200) || 200));
    const events = await pool.query<AuditRow>(
      'SELECT seq, actor, type, detail, prev_hash, hash, created_at FROM audit_events ORDER BY seq DESC LIMIT $1',
      [limit],
    );
    const client = await pool.connect();
    let verify: AuditVerifyResult;
    try {
      verify = await verifyAuditChain(client);
    } finally {
      client.release();
    }
    return { events: events.rows.map(mapAudit), verify };
  });

  app.get('/api/audit/verify', { preHandler: guard }, async () => {
    const client = await pool.connect();
    try {
      return { verify: await verifyAuditChain(client) };
    } finally {
      client.release();
    }
  });
}
