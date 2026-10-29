import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ToastAction = {label: string; onClick: () => void};
type Toast = {id: number; message: string; action?: ToastAction};
const ToastContext = createContext<(message: string, action?: ToastAction) => void>(() => {});
/** Short confirmations ("Added to queue") with an optional Undo; errors keep using the notice bar. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({children}: {children: ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0), timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setToasts(all => all.filter(t => t.id !== id)); }, []);
  const show = useCallback((message: string, action?: ToastAction) => {
    const id = ++next.current;
    setToasts(all => [...all.slice(-2), {id, message, action}]);
    timers.current.set(id, setTimeout(() => dismiss(id), action ? 6000 : 3500));
  }, [dismiss]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return <ToastContext.Provider value={show}>
    {children}
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className="toast">
        <span>{t.message}</span>
        {t.action && <button className="toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
        <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={15}/></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
