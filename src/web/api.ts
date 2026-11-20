import type {
  Approval,
  AuditEvent,
  AuditVerifyResult,
  Bootstrap,
  Report,
  Run,
  SiteDetail,
  SiteSummary,
  TaskKind,
  User,
} from '@shared/types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Cloudflare Pages からトンネルAPIを呼ぶ場合は VITE_API_BASE_URL を設定する。
 * 同一オリジン配信（APIサーバがSPAも配信）では空文字のまま。
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'sas_session_token';

function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage can be unavailable in hardened browsers.
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = readToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api${path}`, {
    credentials: API_BASE ? 'omit' : 'same-origin',
    ...options,
    headers,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  if (!res.ok) {
    const message = data?.error?.message ?? `通信エラー（HTTP ${res.status}）`;
    const code = data?.error?.code ?? 'HTTP_ERROR';
    if (res.status === 401) {
      writeToken(null);
      window.dispatchEvent(new CustomEvent('sas:unauthorized'));
    }
    throw new ApiError(message, res.status, code);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('/auth/me'),
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  sites: () => request<{ sites: SiteSummary[] }>('/sites'),
  login: async (email: string, password: string) => {
    const res = await request<{ user: User; token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.token) writeToken(res.token);
    return res;
  },
  logout: async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } finally {
      writeToken(null);
    }
  },
  site: (id: string) => request<SiteDetail>(`/sites/${encodeURIComponent(id)}`),
  siteReports: (id: string) =>
    request<{ reports: Report[] }>(`/sites/${encodeURIComponent(id)}/reports`),
  run: (siteId: string, task: TaskKind) =>
    request<{ run: Run }>(`/sites/${encodeURIComponent(siteId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ task }),
    }),
  approvals: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    request<{ approvals: Approval[] }>(`/approvals?status=${status}`),
  decide: (id: string, decision: 'approve' | 'reject', note?: string) =>
    request<{ approval: Approval; report: Report | null }>(
      `/approvals/${encodeURIComponent(id)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, note }) },
    ),
  audit: (limit = 200) =>
    request<{ events: AuditEvent[]; verify: AuditVerifyResult }>(`/audit?limit=${limit}`),
  auditVerify: () => request<{ verify: AuditVerifyResult }>('/audit/verify'),
  reports: () => request<{ reports: Report[] }>('/reports'),
};

export const apiBaseUrl = API_BASE;
