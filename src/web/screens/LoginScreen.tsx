import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { ApiError } from '../api';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';

const DEMO_ACCOUNTS = [
  {
    role: '現場代理人・所長',
    email: 'manager@example.com',
    password: 'SasManager!2026',
    note: '承認・却下が可能',
    tone: 'ok' as const,
  },
  {
    role: '現場担当者',
    email: 'staff@example.com',
    password: 'SasStaff!2026',
    note: '承認権限なし',
    tone: 'info' as const,
  },
];

export function LoginScreen(): ReactNode {
  const { user, loading, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('manager@example.com');
  const [password, setPassword] = useState('SasManager!2026');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'ログイン ─ Spatial Agent Studio';
  }, []);

  if (loading) {
    return (
      <div className="login-loading">
        <span className="spinner" aria-hidden="true" />
        <span>起動中…</span>
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      toast.push('ログインしました。', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'ログインに失敗しました。通信環境を確認してください。';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function fill(account: (typeof DEMO_ACCOUNTS)[number]): void {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <svg width="46" height="46" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <linearGradient id="loginGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#38e1ff" />
                <stop offset="0.55" stopColor="#8b7bff" />
                <stop offset="1" stopColor="#ffb547" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="#0b132e" />
            <circle cx="32" cy="32" r="17" fill="none" stroke="url(#loginGrad)" strokeWidth="3" />
            <path d="M32 15l12 9v16l-12 9-12-9V24z" fill="none" stroke="url(#loginGrad)" strokeWidth="2.4" />
            <circle cx="32" cy="32" r="4" fill="#38e1ff" />
          </svg>
          <div>
            <p className="login-kicker">SPATIAL AGENT STUDIO</p>
            <h1>空間AIエージェント・スタジオ</h1>
            <p className="login-sub">土木業務オートパイロット ／ 個人利用MVP</p>
          </div>
        </div>

        <p className="login-lead">
          現場を<strong>3Dで見て</strong>、AIが<strong>計測・集計・帳票の下書き</strong>まで。
          確定は必ず人が行い、すべての判断を監査ログに残します。
        </p>

        <ul className="login-points">
          <li>
            <span className="login-point-icon tone-cy">
              <Icon name="cube" size={18} />
            </span>
            <div>
              <b>3D現場ビュー</b>
              <p>3DGSを模したサンプル地形で、盛土・護岸・重機・作業員を同じ座標で確認。</p>
            </div>
          </li>
          <li>
            <span className="login-point-icon tone-vi">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <b>AIは下書きまで</b>
              <p>数値は決定的な計算エンジンが算出。AIは手順と操作を担当し、数字を作りません。</p>
            </div>
          </li>
          <li>
            <span className="login-point-icon tone-gr">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <b>確定は人・記録は改ざん検知</b>
              <p>承認・却下は権限を持つ人が実行。監査ログはハッシュ連鎖で検証できます。</p>
            </div>
          </li>
        </ul>

        <div className="login-disclosure">
          <Badge tone="warn">DEMO</Badge>
          <p>
            AIエージェントはスクリプト化されたデモです。外部LLM/APIには接続せず、
            サンプルデータ（架空）のみを使用します。
          </p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">SIGN IN</p>
          <h2>現場アカウントでログイン</h2>
          <p className="login-card-sub">個人利用MVPのため、デモアカウントを用意しています。</p>

          <form onSubmit={(e) => void onSubmit(e)} className="login-form">
            <label className="field">
              <span>メールアドレス</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                disabled={busy}
                placeholder="manager@example.com"
              />
            </label>
            <label className="field">
              <span>パスワード</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
                placeholder="••••••••"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                <Icon name="alertCircle" size={15} />
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-lg login-submit" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner spinner-sm" aria-hidden="true" />
                  ログイン中…
                </>
              ) : (
                <>
                  ログイン
                  <Icon name="arrowRight" size={17} />
                </>
              )}
            </button>
          </form>

          <div className="demo-accounts">
            <p className="demo-accounts-title">デモアカウント（クリックで入力）</p>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                className="demo-account"
                onClick={() => fill(a)}
                disabled={busy}
              >
                <span className="demo-account-main">
                  <b>{a.role}</b>
                  <small>{a.email}</small>
                </span>
                <Badge tone={a.tone}>{a.note}</Badge>
              </button>
            ))}
          </div>

          <p className="login-note">
            パスワードはデモ用です。共有・公開環境では必ず変更してください（README参照）。
          </p>
        </div>
      </section>
    </div>
  );
}
