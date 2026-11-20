import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { buildApp } from '../../src/api/app';
import { loadConfig } from '../../src/api/config';

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql:///spatial_agent_studio_test?host=/var/run/postgresql';

const config = loadConfig({
  databaseUrl: TEST_DB,
  nodeEnv: 'test',
  appOrigin: 'http://127.0.0.1:7440',
  cookieSecure: false,
  sessionTtlHours: 8,
  staticDir: '/nonexistent-for-api-tests',
  corsOrigins: ['https://spatial-agent-studio-preview.pages.dev'],
  accessRoles: {
    'manager@example.com': ['agent', 'hq', 'it'],
    'staff@example.com': ['field'],
  },
  accessRoleDomains: { 'example.org': ['field'] },
});

let app: FastifyInstance;

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  expect(value).toBeTruthy();
  return String(value).split(';')[0]!;
}

function auth(cookie: string): { cookie: string } {
  return { cookie };
}

beforeAll(async () => {
  app = await buildApp(config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Spatial Agent Studio API', () => {
  it('serves a health check with the database up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(body.aiMode).toBe('demo-deterministic');
  });

  it('accepts bearer-token auth and CORS preflight for Cloudflare Pages', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'manager@example.com', password: 'SasManager!2026' },
      headers: { origin: 'https://spatial-agent-studio-preview.pages.dev' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().token as string;
    expect(token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('manager@example.com');

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/bootstrap',
      headers: {
        origin: 'https://spatial-agent-studio-preview.pages.dev',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://spatial-agent-studio-preview.pages.dev',
    );
    expect(String(preflight.headers['access-control-allow-headers'])).toContain('authorization');

    const hashPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/bootstrap',
      headers: {
        origin: 'https://45b9e8ff.spatial-agent-studio-preview.pages.dev',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(hashPreflight.statusCode).toBe(204);
    expect(hashPreflight.headers['access-control-allow-origin']).toBe(
      'https://45b9e8ff.spatial-agent-studio-preview.pages.dev',
    );

    const blocked = await app.inject({
      method: 'OPTIONS',
      url: '/api/bootstrap',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects unauthenticated access to protected resources', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid login credentials without leaking which part failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'manager@example.com', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(res.json().error.message).not.toContain('存在');
  });

  it('logs in, runs an as-built draft, approves it, and persists the report + audit chain', async () => {
    const cookie = await login('manager@example.com', 'SasManager!2026');

    const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: auth(cookie) });
    expect(boot.statusCode).toBe(200);
    const bootstrap = boot.json();
    expect(bootstrap.user.role).toBe('manager');
    expect(bootstrap.dashboard.sites).toHaveLength(5);

    const site = await app.inject({
      method: 'GET',
      url: '/api/sites/site-a',
      headers: auth(cookie),
    });
    expect(site.statusCode).toBe(200);
    expect(site.json().id).toBe('site-a');
    expect(site.json().versions.length).toBe(3);

    const runRes = await app.inject({
      method: 'POST',
      url: '/api/sites/site-a/runs',
      headers: auth(cookie),
      payload: { task: 'asbuilt' },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json().run;
    expect(run.task).toBe('asbuilt');
    expect(run.steps).toHaveLength(6);
    expect(run.result.stats.n).toBe(2688);
    expect(run.result.stats.passRate).toBeCloseTo(93.415, 3);
    expect(run.approval.status).toBe('pending');
    expect(run.approval.risk).toBe('medium');
    expect(run.approval.title).toContain('出来形管理帳票');

    const pending = await app.inject({
      method: 'GET',
      url: '/api/approvals?status=pending',
      headers: auth(cookie),
    });
    expect(pending.statusCode).toBe(200);
    const pendingIds = pending.json().approvals.map((a: { id: string }) => a.id);
    expect(pendingIds).toContain(run.approval.id);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/approvals/${run.approval.id}/decision`,
      headers: auth(cookie),
      payload: { decision: 'approve', note: 'API integration test' },
    });
    expect(decide.statusCode).toBe(200);
    const decision = decide.json();
    expect(decision.approval.status).toBe('approved');
    expect(decision.approval.decidedBy.name).toContain('現場代理人');
    expect(decision.report).not.toBeNull();
    expect(decision.report.title).toBe('出来形管理帳票');

    const reports = await app.inject({
      method: 'GET',
      url: '/api/sites/site-a/reports',
      headers: auth(cookie),
    });
    expect(reports.statusCode).toBe(200);
    expect(reports.json().reports.length).toBe(1);

    const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: auth(cookie) });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().verify.ok).toBe(true);
    const types = audit.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain('RUN_REQUESTED');
    expect(types).toContain('RUN_COMPLETED');
    expect(types).toContain('APPROVAL_REQUESTED');
    expect(types).toContain('APPROVED');
    expect(types).toContain('REPORT_CREATED');

    const again = await app.inject({
      method: 'POST',
      url: `/api/approvals/${run.approval.id}/decision`,
      headers: auth(cookie),
      payload: { decision: 'approve' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('runs a safety check and blocks approval by a non-approver', async () => {
    const manager = await login('manager@example.com', 'SasManager!2026');
    const staff = await login('staff@example.com', 'SasStaff!2026');

    const runRes = await app.inject({
      method: 'POST',
      url: '/api/sites/site-a/runs',
      headers: auth(staff),
      payload: { task: 'safety' },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json().run;
    expect(run.result.scan.intruded).toBe(true);
    expect(run.result.scan.radiusM).toBe(7.5);
    expect(run.approval.risk).toBe('high');

    const denied = await app.inject({
      method: 'POST',
      url: `/api/approvals/${run.approval.id}/decision`,
      headers: auth(staff),
      payload: { decision: 'approve' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');

    const ok = await app.inject({
      method: 'POST',
      url: `/api/approvals/${run.approval.id}/decision`,
      headers: auth(manager),
      payload: { decision: 'reject', note: '作業員退避を確認してから再開' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().approval.status).toBe('rejected');
    expect(ok.json().report).toBeNull();

    const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: auth(manager) });
    const types = audit.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain('DENY');
    expect(types).toContain('REJECTED');
  });

  it('rejects malformed ids with 4xx and never exposes database errors', async () => {
    const cookie = await login('manager@example.com', 'SasManager!2026');
    const decision = await app.inject({
      method: 'POST',
      url: '/api/approvals/AP-999999/decision',
      headers: auth(cookie),
      payload: { decision: 'approve' },
    });
    expect(decision.statusCode).toBe(404);
    expect(decision.json().error.code).toBe('APPROVAL_NOT_FOUND');
    expect(decision.body).not.toContain('22P02');
    expect(decision.body).not.toContain('invalid input syntax');

    const approval = await app.inject({
      method: 'GET',
      url: '/api/approvals/not-a-uuid',
      headers: auth(cookie),
    });
    expect(approval.statusCode).toBe(404);
    expect(approval.body).not.toContain('22P02');

    const site = await app.inject({
      method: 'GET',
      url: '/api/sites/not-a-uuid',
      headers: auth(cookie),
    });
    expect(site.statusCode).toBe(404);
    expect(site.body).not.toContain('22P02');

    const run = await app.inject({
      method: 'GET',
      url: '/api/runs/not-a-uuid',
      headers: auth(cookie),
    });
    expect(run.statusCode).toBe(404);
    expect(run.body).not.toContain('22P02');
  });

  it('rejects invalid run payloads', async () => {
    const cookie = await login('manager@example.com', 'SasManager!2026');
    const res = await app.inject({
      method: 'POST',
      url: '/api/sites/site-a/runs',
      headers: auth(cookie),
      payload: { task: 'unknown' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_BODY');
  });

  it('maps Cloudflare Access emails to roles (staff / manager) and rejects unknown emails', async () => {
    const staff = await app.inject({
      method: 'POST',
      url: '/api/auth/access',
      payload: { email: 'staff@example.com' },
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().roles).toEqual(['field']);
    expect(staff.json().defaultRole).toBe('field');
    expect(staff.json().user.role).toBe('staff');

    const manager = await app.inject({
      method: 'POST',
      url: '/api/auth/access',
      payload: { email: 'Manager@Example.com' },
    });
    expect(manager.statusCode).toBe(200);
    expect(manager.json().roles).toEqual(['agent', 'hq', 'it']);
    expect(manager.json().defaultRole).toBe('agent');
    expect(manager.json().user.role).toBe('manager');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/access',
      payload: { email: 'nobody@example.com' },
    });
    expect(unknown.statusCode).toBe(403);
    expect(unknown.json().error.code).toBe('ROLE_NOT_MAPPED');

    const byDomain = await app.inject({
      method: 'POST',
      url: '/api/auth/access',
      payload: { email: 'someone@example.org' },
    });
    expect(byDomain.statusCode).toBe(200);
    expect(byDomain.json().roles).toEqual(['field']);
  });

  it('exposes system info for the settings screen without leaking addresses', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/api/system/info' });
    expect(unauth.statusCode).toBe(401);

    const cookie = await login('manager@example.com', 'SasManager!2026');
    const res = await app.inject({ method: 'GET', url: '/api/system/info', headers: auth(cookie) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe('0.1.0');
    expect(body.counts.sites).toBeGreaterThan(0);
    expect(body.counts.auditEvents).toBeGreaterThan(0);
    expect(body.audit.ok).toBe(true);
    expect(body.session.ttlHours).toBe(8);
    expect(JSON.stringify(body)).not.toContain('@');
  });

  describe('production auth hardening', () => {
    let strict: FastifyInstance;
    beforeAll(async () => {
      const strictConfig = loadConfig({
        databaseUrl: TEST_DB,
        nodeEnv: 'test',
        appOrigin: 'http://127.0.0.1:7440',
        cookieSecure: false,
        sessionTtlHours: 8,
        staticDir: '/nonexistent-for-api-tests',
        corsOrigins: ['https://spatial-agent-studio-preview.pages.dev'],
        accessRoles: { 'manager@example.com': ['agent'] },
        accessRoleDomains: {},
        demoLogin: false,
        requireOriginAuth: true,
        accessEmailLogin: false,
      });
      strict = await buildApp(strictConfig);
      await strict.ready();
    });
    afterAll(async () => {
      await strict.close();
    });

    it('rejects auth calls without an Origin header', async () => {
      const res = await strict.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'manager@example.com', password: 'x' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ORIGIN_REQUIRED');
    });

    it('rejects demo-account password login', async () => {
      const res = await strict.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'https://spatial-agent-studio-preview.pages.dev' },
        payload: { email: 'manager@example.com', password: 'SasManager!2026' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('DEMO_LOGIN_DISABLED');
    });

    it('accepts a verified Access JWT and rejects a missing one', async () => {
      const { generateKeyPairSync, sign } = await import('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
      const jwtConfig = loadConfig({
        databaseUrl: TEST_DB,
        nodeEnv: 'test',
        appOrigin: 'http://127.0.0.1:7440',
        cookieSecure: false,
        sessionTtlHours: 8,
        staticDir: '/nonexistent-for-api-tests',
        corsOrigins: ['https://spatial-agent-studio-preview.pages.dev'],
        accessRoles: { 'jwt-user@example.org': ['agent'] },
        accessRoleDomains: {},
        requireOriginAuth: true,
        accessEmailLogin: false,
        requireAccessJwt: true,
        accessJwt: { teamDomain: 'https://team.example.com', aud: 'aud-1', keys: [jwk as never] },
      });
      const jwtApp = await buildApp(jwtConfig);
      await jwtApp.ready();
      const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const header = b64({ alg: 'RS256', kid: 'k1' });
      const payload = b64({
        iss: 'https://team.example.com',
        aud: ['aud-1'],
        email: 'jwt-user@example.org',
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString(
        'base64url',
      );
      const origin = { origin: 'https://spatial-agent-studio-preview.pages.dev' };

      const ok = await jwtApp.inject({
        method: 'POST',
        url: '/api/auth/access',
        headers: { ...origin, 'cf-access-jwt-assertion': `${header}.${payload}.${signature}` },
        payload: {},
      });
      expect(ok.statusCode).toBe(200);

      const missing = await jwtApp.inject({
        method: 'POST',
        url: '/api/auth/access',
        headers: origin,
        payload: {},
      });
      expect(missing.statusCode).toBe(401);
      expect(missing.json().error.code).toBe('ACCESS_JWT_REQUIRED');
      await jwtApp.close();
    });

    it('refuses to mint a session from an unverified Access email', async () => {
      const res = await strict.inject({
        method: 'POST',
        url: '/api/auth/access',
        headers: { origin: 'https://spatial-agent-studio-preview.pages.dev' },
        payload: { email: 'manager@example.com' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ACCESS_EMAIL_LOGIN_DISABLED');
    });
  });

  it('narrates through the AI gateway (demo) and audits the call', async () => {
    const cookie = await login('manager@example.com', 'SasManager!2026');
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/narrate',
      headers: auth(cookie),
      payload: { siteId: 'site-a', task: 'asbuilt' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.narration.headline.length).toBeGreaterThan(0);
    expect(body.narration.notes.length).toBeGreaterThan(0);
    expect(body.meta.live).toBe(false);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=50',
      headers: auth(cookie),
    });
    const types = audit.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain('AI_CALL');
  });

  it('rejects an invalid narrate payload and an unknown site', async () => {
    const cookie = await login('manager@example.com', 'SasManager!2026');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/ai/narrate',
      headers: auth(cookie),
      payload: { siteId: 'site-a', task: 'unknown' },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/ai/narrate',
      headers: auth(cookie),
      payload: { siteId: 'no-such-site', task: 'asbuilt' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('keeps the audit log append-only at the database level', async () => {
    const client = new Client({ connectionString: TEST_DB });
    await client.connect();
    try {
      await expect(
        client.query("UPDATE audit_events SET detail = 'tampered' WHERE seq = 1"),
      ).rejects.toThrow(/append-only/);
      await expect(client.query('DELETE FROM audit_events WHERE seq = 1')).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await client.end();
    }
  });
});
