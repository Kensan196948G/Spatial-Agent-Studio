-- Spatial Agent Studio MVP — initial schema
-- 追加のみ（既存データを破壊しない）。適用履歴は schema_migrations で管理する。

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'attention', 'idle')),
  cover text NOT NULL CHECK (cover IN ('embankment', 'bridge', 'tunnel')),
  splat_count integer NOT NULL DEFAULT 12000,
  model jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_versions (
  id bigserial PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_date date NOT NULL,
  progress numeric(4, 3) NOT NULL CHECK (progress >= 0 AND progress <= 1),
  is_latest boolean NOT NULL DEFAULT false,
  UNIQUE (site_id, version_date)
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(id),
  task text NOT NULL CHECK (task IN ('asbuilt', 'safety')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  requested_by uuid NOT NULL REFERENCES users(id),
  result jsonb NOT NULL,
  steps jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_site ON runs(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES sites(id),
  title text NOT NULL,
  summary text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  task text NOT NULL CHECK (task IN ('asbuilt', 'safety')),
  verdict text NOT NULL,
  verdict_tone text NOT NULL CHECK (verdict_tone IN ('ok', 'warn', 'ng')),
  metrics jsonb NOT NULL,
  findings text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_site ON approvals(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
  title text NOT NULL,
  verdict text NOT NULL,
  verdict_tone text NOT NULL CHECK (verdict_tone IN ('ok', 'warn', 'ng')),
  metrics jsonb NOT NULL,
  findings text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_site ON reports(site_id, created_at DESC);

-- 追記専用の監査ログ（ハッシュ連鎖）
CREATE TABLE IF NOT EXISTS audit_events (
  seq bigserial PRIMARY KEY,
  actor text NOT NULL,
  type text NOT NULL,
  detail text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_events;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
