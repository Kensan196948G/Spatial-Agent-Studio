import type { SiteModel } from '../shared/terrain';
import type {
  Approval,
  AuditEvent,
  Report,
  RiskLevel,
  SiteStatus,
  SiteSummary,
  UserRole,
  VerdictTone,
} from '../shared/types';

export type SiteRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: SiteStatus;
  cover: 'embankment' | 'bridge' | 'tunnel';
  splat_count: number;
  model: SiteModel;
  pending_approvals?: number | string;
  last_run_at?: Date | string | null;
  progress?: number | string;
  version_date?: Date | string | null;
};

export type ApprovalRow = {
  id: string;
  run_id: string;
  site_id: string;
  site_name: string;
  title: string;
  summary: string;
  risk: RiskLevel;
  task: 'asbuilt' | 'safety';
  verdict: string;
  verdict_tone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  findings: string;
  status: Approval['status'];
  requested_by_name: string;
  requested_by_role: UserRole;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  created_at: Date | string;
};

export type ReportRow = {
  id: string;
  site_id: string;
  site_name: string;
  run_id: string;
  approval_id: string;
  title: string;
  verdict: string;
  verdict_tone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  findings: string;
  created_by_name: string;
  created_at: Date | string;
};

export type AuditRow = {
  seq: string | number;
  actor: string;
  type: string;
  detail: string;
  prev_hash: string;
  hash: string;
  created_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function mapSiteSummary(row: SiteRow): SiteSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    cover: row.cover,
    progress: row.progress !== undefined ? Number(row.progress) : Number(row.model.progress),
    versionDate: dateOnly(row.version_date),
    splatCount: Number(row.splat_count),
    pendingApprovals: Number(row.pending_approvals ?? 0),
    lastRunAt: row.last_run_at ? iso(row.last_run_at) : null,
  };
}

export function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    runId: row.run_id,
    siteId: row.site_id,
    siteName: row.site_name,
    title: row.title,
    summary: row.summary,
    risk: row.risk,
    status: row.status,
    requestedBy: { name: row.requested_by_name, role: row.requested_by_role },
    decidedBy: row.decided_by_name ? { name: row.decided_by_name } : null,
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    createdAt: iso(row.created_at),
    task: row.task,
    verdict: row.verdict,
    verdictTone: row.verdict_tone,
    metrics: row.metrics,
    findings: row.findings,
  };
}

export function mapReport(row: ReportRow): Report {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    runId: row.run_id,
    approvalId: row.approval_id,
    title: row.title,
    verdict: row.verdict,
    verdictTone: row.verdict_tone,
    metrics: row.metrics,
    findings: row.findings,
    createdBy: { name: row.created_by_name },
    createdAt: iso(row.created_at),
  };
}

export function mapAudit(row: AuditRow): AuditEvent {
  return {
    seq: Number(row.seq),
    actor: row.actor,
    type: row.type,
    detail: row.detail,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: iso(row.created_at),
  };
}
