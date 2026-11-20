import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function NotFoundScreen(): ReactNode {
  return (
    <div className="page">
      <div className="notfound">
        <span className="notfound-icon">
          <Icon name="cube" size={34} />
        </span>
        <p className="eyebrow">404 ／ NOT FOUND</p>
        <h1>ページが見つかりません</h1>
        <p className="page-lead">URLが変わったか、ページが削除された可能性があります。</p>
        <Link to="/" className="btn btn-primary">
          <Icon name="home" size={16} />
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
