import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import { useToast } from '../toast';
import { Icon } from './Icon';
import { SiteSwitcher } from './SiteSwitcher';

function BrandMark(): ReactNode {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38e1ff" />
          <stop offset="0.55" stopColor="#8b7bff" />
          <stop offset="1" stopColor="#ffb547" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0b132e" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="url(#brandGrad)" strokeWidth="3" />
      <path d="M32 15l12 9v16l-12 9-12-9V24z" fill="none" stroke="url(#brandGrad)" strokeWidth="2.4" />
      <circle cx="32" cy="32" r="4" fill="#38e1ff" />
    </svg>
  );
}

export function Layout(): ReactNode {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  async function onLogout(): Promise<void> {
    await logout();
    toast.push('ログアウトしました。', 'info');
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <BrandMark />
          <div className="header-titles">
            <b>Spatial Agent Studio</b>
            <small>空間AIエージェント・スタジオ ／ 土木業務オートパイロット MVP</small>
          </div>
        </div>
        <div className="header-badges" aria-label="実行環境">
          <span className="env-badge env-demo">
            <i />
            AI: DEMO
          </span>
          <span className="env-badge">
            <Icon name="database" size={13} />
            PostgreSQL
          </span>
          <span className="env-badge">
            <Icon name="cube" size={13} />
            Canvas2D
          </span>
        </div>
        <div className="header-spacer" />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
          title={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        {user && (
          <div className="user-chip">
            <span className={`user-avatar role-${user.role}`} aria-hidden="true">
              <Icon name="user" size={16} />
            </span>
            <span className="user-meta">
              <b>{user.name}</b>
              <small>{user.role === 'manager' ? '承認権限あり' : '閲覧・依頼のみ'}</small>
            </span>
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onLogout()}>
          <Icon name="logout" size={16} />
          ログアウト
        </button>
      </header>

      <div className="app-body">
        <nav className="side-nav" aria-label="メインナビゲーション">
          <div className="nav-site-switch">
            <SiteSwitcher />
          </div>
          <p className="nav-heading">メニュー</p>
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name="home" size={18} />
            ホーム
          </NavLink>
          <NavLink
            to="/sites/site-a"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon name="cube" size={18} />
            3D現場
          </NavLink>
          <NavLink
            to="/approvals"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon name="shield" size={18} />
            承認
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name="audit" size={18} />
            監査ログ
          </NavLink>

          <p className="nav-heading nav-heading-gap">主要フロー</p>
          <div className="nav-note">
            <span className="nav-step">1</span>
            <span>AIが計測・下書き</span>
          </div>
          <div className="nav-note">
            <span className="nav-step">2</span>
            <span>人が確認・承認</span>
          </div>
          <div className="nav-note">
            <span className="nav-step">3</span>
            <span>DB保存・監査記録</span>
          </div>

          <div className="nav-footer">
            <p>個人利用MVP</p>
            <p>サンプルデータ／AIはデモ</p>
          </div>
        </nav>

        <main className="main-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
