import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SiteSummary } from '@shared/types';
import { api } from '../api';
import { Icon } from './Icon';

export function SiteSwitcher(): ReactNode {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname.match(/^\/sites\/([^/]+)/)?.[1] ?? '';

  useEffect(() => {
    let alive = true;
    api
      .sites()
      .then((res) => {
        if (alive) setSites(res.sites);
      })
      .catch(() => {
        // Auth/network errors are surfaced by the screen; the selector stays empty.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <label className="site-switcher">
      <Icon name="pin" size={15} />
      <span className="sr-only">現場を選択</span>
      <select
        value={current}
        onChange={(e) => {
          if (e.target.value) navigate(`/sites/${e.target.value}`);
        }}
        disabled={loading}
        aria-label="現場を選択"
      >
        <option value="">{loading ? '読み込み中…' : '現場を選択'}</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.code} {site.name}
          </option>
        ))}
      </select>
    </label>
  );
}
