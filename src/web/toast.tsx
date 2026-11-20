import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './components/Icon';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

type Toast = { id: number; message: string; tone: ToastTone };

type ToastState = { push: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastState | null>(null);

const ICONS: Record<ToastTone, 'info' | 'check' | 'alert' | 'x'> = {
  info: 'info',
  success: 'check',
  warn: 'alert',
  error: 'x',
};

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    seq.current += 1;
    const id = seq.current;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4400);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role="status">
            <Icon name={ICONS[t.tone]} size={16} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
