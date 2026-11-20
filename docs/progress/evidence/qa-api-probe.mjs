#!/usr/bin/env node
/**
 * Read-only QA probe for the Spatial Agent Studio preview API.
 *
 * Collects authorization / validation / audit-chain facts for the release review.
 * - No approval or run is created: invalid payloads and nonexistent ids only.
 * - The demo manager login is used once to obtain a token (never printed).
 *   That login appends one LOGIN audit event on the preview DB (normal operation).
 * - Results are written to qa-api-probes-20261120.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.PREVIEW_API_URL ?? 'https://sas-api.mirai-dx-platform.com';
const UI = 'https://spatial-agent-studio-preview.pages.dev';
const OUT = join(process.cwd(), 'docs', 'progress', 'evidence');
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
const startedAt = new Date().toISOString();

const result = {
  target: { api: API, uiOrigin: UI },
  startedAt,
  checks: [],
  defects: [],
  api: {},
  mutations: [],
  notes: [],
};

function record(name, ok, detail) {
  result.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, { origin = UI, token, body, extraHeaders } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, extraHeaders ?? {});
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
}

// 1. health x3
const health = [];
for (let i = 0; i < 3; i += 1) {
  const r = await call('GET', '/api/health');
  health.push({ status: r.status, body: r.json });
}
result.api.health = health;
record(
  'health 200 x3 / db up',
  health.every((h) => h.status === 200 && h.body && h.body.ok === true && h.body.db === 'up'),
  JSON.stringify(health[0]?.body),
);

// 2. CORS preflight (a real browser preflight carries these headers)
const preflight = await call('OPTIONS', '/api/bootstrap', {
  extraHeaders: {
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization',
  },
});
result.api.preflight = {
  status: preflight.status,
  allowOrigin: preflight.headers['access-control-allow-origin'],
  allowHeaders: preflight.headers['access-control-allow-headers'],
};
record(
  'CORS preflight 204 + allowed origin',
  preflight.status === 204 && preflight.headers['access-control-allow-origin'] === UI,
  JSON.stringify(result.api.preflight),
);

// 3. unauthenticated / invalid token
const boot = await call('GET', '/api/bootstrap');
const me = await call('GET', '/api/auth/me', { token: 'invalid-token' });
result.api.unauthenticated = {
  bootstrap: { status: boot.status, code: boot.json?.error?.code },
  badTokenMe: { status: me.status, code: me.json?.error?.code },
};
record(
  '401 unauthenticated bootstrap',
  boot.status === 401 && boot.json?.error?.code === 'UNAUTHENTICATED',
  `${boot.status}/${boot.json?.error?.code}`,
);
record(
  '401 invalid token on /auth/me',
  me.status === 401 && me.json?.error?.code === 'SESSION_EXPIRED',
  `${me.status}/${me.json?.error?.code}`,
);

// 4. disallowed origin is rejected before authentication (no write)
const badOrigin = await call('POST', '/api/auth/login', {
  origin: 'https://example.invalid',
  body: { email: 'manager@example.com', password: 'SasManager!2026' },
});
result.api.badOriginLogin = {
  status: badOrigin.status,
  code: badOrigin.json?.error?.code,
  hasToken: Boolean(badOrigin.json?.token),
};
record(
  '403 disallowed origin',
  badOrigin.status === 403 && badOrigin.json?.error?.code === 'ORIGIN_FORBIDDEN' && !badOrigin.json?.token,
  `${badOrigin.status}/${badOrigin.json?.error?.code}`,
);

// 5. demo manager login (demo credentials already published in the repo)
const login = await call('POST', '/api/auth/login', {
  body: { email: 'manager@example.com', password: 'SasManager!2026' },
});
const token = login.json?.token ?? null;
result.api.login = { status: login.status, gotToken: Boolean(token), userRole: login.json?.user?.role };
result.mutations.push('POST /api/auth/login (demo) -> LOGIN audit event');
record('demo manager login', login.status === 200 && Boolean(token), `status=${login.status}`);

if (!token) {
  result.finishedAt = new Date().toISOString();
  result.ok = false;
  writeFileSync(join(OUT, 'qa-api-probes-20261120.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log('NO TOKEN — stopping');
  process.exit(1);
}

// 6. invalid task payloads (no run created)
const taskCases = [
  { label: 'ASBUILT', body: { task: 'ASBUILT' } },
  { label: 'empty', body: { task: '' } },
  { label: 'unknown', body: { task: 'unknown' } },
  { label: 'missing', body: {} },
];
result.api.invalidTasks = [];
for (const c of taskCases) {
  const r = await call('POST', '/api/sites/site-a/runs', { token, body: c.body });
  result.api.invalidTasks.push({ label: c.label, status: r.status, code: r.json?.error?.code });
  record(
    `400 invalid task (${c.label})`,
    r.status === 400 && r.json?.error?.code === 'INVALID_BODY',
    `${r.status}/${r.json?.error?.code}`,
  );
}

// 7. invalid access emails (validation only; unmapped valid email would write an audit event)
const emailCases = [
  { label: 'empty', email: '' },
  { label: 'format', email: 'not-an-email' },
  { label: 'too-long', email: `${'a'.repeat(190)}@example.com` },
];
result.api.invalidEmails = [];
for (const c of emailCases) {
  const r = await call('POST', '/api/auth/access', { body: { email: c.email } });
  result.api.invalidEmails.push({ label: c.label, length: c.email.length, status: r.status, code: r.json?.error?.code });
  record(
    `400 invalid access email (${c.label}, len=${c.email.length})`,
    r.status === 400 && r.json?.error?.code === 'INVALID_BODY',
    `${r.status}/${r.json?.error?.code}`,
  );
}

// 8. audit snapshot before
const auditBefore = await call('GET', '/api/audit?limit=1', { token });
const beforeSeq = Number(auditBefore.json?.events?.[0]?.seq ?? 0);
const beforeChecked = auditBefore.json?.verify?.checked ?? null;
result.api.auditBefore = {
  checked: beforeChecked,
  headHashPrefix: auditBefore.json?.verify?.headHash?.slice(0, 16) ?? null,
  latestEvent: auditBefore.json?.events?.[0]
    ? {
        seq: auditBefore.json.events[0].seq,
        type: auditBefore.json.events[0].type,
        actor: String(auditBefore.json.events[0].actor ?? '').replace(
          /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g,
          '<masked-email>',
        ),
      }
    : null,
};

// 9. decision boundaries against a valid-but-nonexistent UUID (no writes)
const note500 = await call('POST', `/api/approvals/${MISSING_UUID}/decision`, {
  token,
  body: { decision: 'approve', note: 'a'.repeat(500) },
});
const note501 = await call('POST', `/api/approvals/${MISSING_UUID}/decision`, {
  token,
  body: { decision: 'approve', note: 'a'.repeat(501) },
});
const notFound = await call('POST', `/api/approvals/${MISSING_UUID}/decision`, {
  token,
  body: { decision: 'approve' },
});
const invalidDecision = await call('POST', `/api/approvals/${MISSING_UUID}/decision`, {
  token,
  body: { decision: 'invalid' },
});
result.api.decisionBoundary = {
  note500: { status: note500.status, code: note500.json?.error?.code },
  note501: { status: note501.status, code: note501.json?.error?.code },
  notFound: { status: notFound.status, code: notFound.json?.error?.code },
  invalidDecision: { status: invalidDecision.status, code: invalidDecision.json?.error?.code },
};
record(
  'note=500 passes validation (404 for nonexistent uuid)',
  note500.status === 404 && note500.json?.error?.code === 'APPROVAL_NOT_FOUND',
  `${note500.status}/${note500.json?.error?.code}`,
);
record(
  'note=501 rejected 400',
  note501.status === 400 && note501.json?.error?.code === 'INVALID_BODY',
  `${note501.status}/${note501.json?.error?.code}`,
);
record(
  '404 nonexistent approval (valid uuid)',
  notFound.status === 404 && notFound.json?.error?.code === 'APPROVAL_NOT_FOUND',
  `${notFound.status}/${notFound.json?.error?.code}`,
);
record(
  '400 invalid decision value',
  invalidDecision.status === 400 && invalidDecision.json?.error?.code === 'INVALID_BODY',
  `${invalidDecision.status}/${invalidDecision.json?.error?.code}`,
);

// 9b. malformed approval id (non-uuid) — defect probe
const malformed = await call('POST', '/api/approvals/AP-999999/decision', {
  token,
  body: { decision: 'approve' },
});
result.api.malformedApprovalId = {
  status: malformed.status,
  bodyCode: malformed.json?.code ?? null,
  errorCode: malformed.json?.error?.code ?? malformed.json?.error ?? null,
  message: malformed.json?.message ?? null,
  exposesDbError: /invalid input syntax for type uuid|22P02/.test(malformed.text ?? ''),
};
const malformedOk = malformed.status >= 400 && malformed.status < 500 && !result.api.malformedApprovalId.exposesDbError;
record(
  'malformed approval id returns 4xx without DB error disclosure',
  malformedOk,
  `status=${malformed.status} code=${result.api.malformedApprovalId.bodyCode ?? result.api.malformedApprovalId.errorCode}`,
);
if (!malformedOk) {
  result.defects.push({
    id: 'QA-DEF-01',
    title: '承認IDに非UUID文字列を渡すとHTTP 500（内部DBエラーの露出）',
    endpoint: 'POST /api/approvals/:id/decision',
    observed: {
      status: malformed.status,
      code: result.api.malformedApprovalId.bodyCode,
      message: result.api.malformedApprovalId.message,
    },
    expected: 'HTTP 400 INVALID_ID または 404 APPROVAL_NOT_FOUND（DBエラーを露出しない）',
    severity: 'minor',
  });
}

// 10. audit chain verify + limit clamping (read-only)
const verify = await call('GET', '/api/audit/verify', { token });
const headHash = verify.json?.verify?.headHash ?? '';
result.api.auditVerify = {
  status: verify.status,
  ok: verify.json?.verify?.ok,
  checked: verify.json?.verify?.checked,
  firstBadSeq: verify.json?.verify?.firstBadSeq ?? null,
  headHashPrefix: headHash.slice(0, 16),
  headHashLength: headHash.length,
};
record(
  'audit chain VERIFIED',
  verify.status === 200 && verify.json?.verify?.ok === true && headHash.length === 64,
  `ok=${verify.json?.verify?.ok} checked=${verify.json?.verify?.checked}`,
);

// limit clamp: 0/abc fall back to the default 200, 9999 caps at 500, -5 clamps to 1
const limits = {};
for (const q of ['0', '9999', 'abc', '-5']) {
  const r = await call('GET', `/api/audit?limit=${encodeURIComponent(q)}`, { token });
  limits[q] = { status: r.status, events: Array.isArray(r.json?.events) ? r.json.events.length : null };
}
result.api.auditLimits = limits;
// 0 and non-numeric values fall back to the default 200; the 500 cap cannot be
// observed while the audit table holds fewer than 200 events.
record(
  'audit limit=-5 clamps to 1',
  limits['-5']?.events === 1,
  JSON.stringify(limits['-5']),
);
record(
  'audit limit=0/abc fall back to default (not clamped to 1)',
  limits['0']?.events === limits['abc']?.events && limits['0']?.events !== 1,
  JSON.stringify({ zero: limits['0'], abc: limits['abc'] }),
);
result.notes.push('監査イベント総数が200件未満のため、limit上限500のクランプは観測不能（未検証）');

// 11. system info leakage
const info = await call('GET', '/api/system/info', { token });
const infoText = info.text ?? '';
const emailMatches = infoText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
result.api.systemInfo = {
  status: info.status,
  version: info.json?.version,
  aiMode: info.json?.aiMode,
  roles: info.json?.access?.roles,
  roleMatrixRows: Array.isArray(info.json?.access?.roleMatrix) ? info.json.access.roleMatrix.length : null,
  counts: info.json?.counts,
  emailMatches: emailMatches.length,
  hasPostgresUrl: /postgres(ql)?:\/\//i.test(infoText),
};
record(
  'system info without emails/connection strings',
  info.status === 200 && emailMatches.length === 0 && !/postgres(ql)?:\/\//i.test(infoText),
  `emails=${emailMatches.length}`,
);
record(
  'system info roles = field/agent/hq/it',
  JSON.stringify(info.json?.access?.roles) === JSON.stringify(['field', 'agent', 'hq', 'it']),
  JSON.stringify(info.json?.access?.roles),
);

// 12. audit snapshot after — only LOGIN events should have been appended
const auditAfter = await call('GET', '/api/audit?limit=50', { token });
const newEvents = (auditAfter.json?.events ?? [])
  .filter((e) => Number(e.seq) > beforeSeq)
  .map((e) => e.type);
result.api.auditAfter = {
  checked: auditAfter.json?.verify?.checked ?? null,
  headHashPrefix: auditAfter.json?.verify?.headHash?.slice(0, 16) ?? null,
  newEventTypes: newEvents,
};
record(
  'no approval/report writes from probes (only LOGIN)',
  newEvents.every((t) => t === 'LOGIN'),
  `new=${JSON.stringify(newEvents)}`,
);

result.finishedAt = new Date().toISOString();
result.ok = result.checks.every((c) => c.ok);
writeFileSync(join(OUT, 'qa-api-probes-20261120.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `\nQA API PROBE: ${result.ok ? 'PASS' : 'FAIL'} (${result.checks.filter((c) => c.ok).length}/${result.checks.length}) defects=${result.defects.length}`,
);
