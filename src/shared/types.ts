import type {
  CrossSection,
  DeviationStats,
  EmbankmentBalance,
  SafetyScan,
} from './measurements';
import type { SiteModel } from './terrain';

export type UserRole = 'manager' | 'staff';
export type TaskKind = 'asbuilt' | 'safety';
export type SiteStatus = 'active' | 'attention' | 'idle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type RiskLevel = 'low' | 'medium' | 'high';
export type VerdictTone = 'ok' | 'warn' | 'ng';
export type LayerKey =
  | 'terrain'
  | 'embankment'
  | 'revetment'
  | 'river'
  | 'machine'
  | 'worker'
  | 'vegetation'
  | 'design'
  | 'ai';

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  canApprove: boolean;
};

export type SiteSummary = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: SiteStatus;
  progress: number;
  versionDate: string;
  splatCount: number;
  pendingApprovals: number;
  lastRunAt: string | null;
  cover: 'embankment' | 'bridge' | 'tunnel';
};

export type SiteVersionSummary = {
  date: string;
  label: string;
  progress: number;
  isLatest: boolean;
};

export type SiteDetail = SiteSummary & {
  model: SiteModel;
  versions: SiteVersionSummary[];
};

export type RunPhase = 'perceive' | 'reason' | 'act' | 'verify';

export type SceneGroup =
  | 'embankment'
  | 'excavator'
  | 'worker-1'
  | 'worker-2'
  | 'worker-3'
  | 'revetment'
  | 'terrain'
  | 'design';

export type Vec3 = { x: number; y: number; z: number };

export type OverlaySpec =
  | { kind: 'bbox'; label: string; color: string; groups: SceneGroup[] }
  | { kind: 'ring'; label: string; color: string; center: Vec3; radius: number }
  | { kind: 'link'; label: string; color: string; from: Vec3; to: Vec3 }
  | { kind: 'pin'; label: string; color: string; point: Vec3 };

export type RunAction =
  | { type: 'camera'; view: 'all' | 'emb' | 'cut' | 'exc' | 'rev' }
  | { type: 'layer'; layer: LayerKey; on: boolean }
  | { type: 'heatmap'; on: boolean }
  | { type: 'privacy'; on: boolean }
  | { type: 'simTime'; seconds: number }
  | { type: 'overlays'; overlays: OverlaySpec[] }
  | { type: 'highlight'; groups: string[] };

export type RunStep = {
  index: number;
  phase: RunPhase;
  message: string;
  action?: RunAction;
};

export type AsbuiltResult = {
  task: 'asbuilt';
  stats: DeviationStats;
  balance: EmbankmentBalance;
  section: CrossSection;
  findings: string;
  verdict: string;
  verdictTone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  overlays: OverlaySpec[];
  snapshotSimTime: number;
};

export type SafetyResult = {
  task: 'safety';
  scan: SafetyScan;
  findings: string;
  verdict: string;
  verdictTone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  overlays: OverlaySpec[];
  snapshotSimTime: number;
};

export type RunResult = AsbuiltResult | SafetyResult;

export type Run = {
  id: string;
  siteId: string;
  task: TaskKind;
  status: 'completed';
  createdBy: { name: string; role: UserRole };
  createdAt: string;
  result: RunResult;
  steps: RunStep[];
  approval: Approval | null;
};

export type Approval = {
  id: string;
  runId: string;
  siteId: string;
  siteName: string;
  title: string;
  summary: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  requestedBy: { name: string; role: UserRole };
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  createdAt: string;
  task: TaskKind;
  verdict: string;
  verdictTone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  findings: string;
};

export type Report = {
  id: string;
  siteId: string;
  siteName: string;
  runId: string;
  approvalId: string;
  title: string;
  verdict: string;
  verdictTone: VerdictTone;
  metrics: Array<{ label: string; value: string }>;
  findings: string;
  createdBy: { name: string };
  createdAt: string;
};

export type AuditEvent = {
  seq: number;
  actor: string;
  type: string;
  detail: string;
  prevHash: string;
  hash: string;
  createdAt: string;
};

export type AuditVerifyResult = {
  ok: boolean;
  checked: number;
  firstBadSeq: number | null;
  reason: string | null;
  headHash: string | null;
};

export type Dashboard = {
  sites: SiteSummary[];
  kpis: {
    activeSites: number;
    pendingApprovals: number;
    draftsThisWeek: number;
    alertsThisWeek: number;
    savedHours: number;
  };
  recent: AuditEvent[];
  pending: Approval[];
};

export type Bootstrap = {
  user: User;
  dashboard: Dashboard;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

export type LoginRequest = { email: string; password: string };
export type RunRequest = { task: TaskKind };
export type DecisionRequest = { decision: 'approve' | 'reject'; note?: string };
