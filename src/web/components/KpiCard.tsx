import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function KpiCard({
  icon,
  label,
  value,
  unit,
  hint,
  tone = 'cy',
}: {
  icon: IconName;
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: 'cy' | 'vi' | 'am' | 'rd' | 'gr';
}): ReactNode {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="kpi-body">
        <p className="kpi-label">{label}</p>
        <p className="kpi-value">
          {value}
          {unit && <span className="kpi-unit">{unit}</span>}
        </p>
        {hint && <p className="kpi-hint">{hint}</p>}
      </div>
    </div>
  );
}
