import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// ---- Toasts -------------------------------------------------------------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- Modal --------------------------------------------------------------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Status badge -------------------------------------------------------
const LABELS = {
  draft: 'Draft', unpaid: 'Unpaid', partially_paid: 'Partly paid', paid: 'Paid', cancelled: 'Cancelled', overdue: 'Overdue',
  pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', sent: 'Sent to vendor',
  partially_received: 'Partly received', received: 'Received', closed: 'Closed',
};
export function Badge({ status, overdue }) {
  const s = overdue ? 'overdue' : status;
  return <span className={`badge badge-${s}`}>{LABELS[s] || s}</span>;
}

// ---- Dropdown action menu ----------------------------------------------
export function ActionMenu({ items, label = '⋯' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label="Actions">{label}</button>
      {open && (
        <div className="menu-list" onClick={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map((it, i) => it === '-' ? <hr key={i} /> : (
            <button key={i} className={`menu-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, children, hint, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><div className="empty-title">{title}</div>{children}</div>;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

/** Simple data loader hook */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError(e.message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
