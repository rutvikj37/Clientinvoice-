import { createContext, useContext, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
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
  pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', sent: 'Sent',
  accepted: 'Accepted', converted: 'Converted',
  partially_received: 'Partly received', received: 'Received', closed: 'Closed',
};
export function Badge({ status, overdue }) {
  const s = overdue ? 'overdue' : status;
  return <span className={`badge badge-${s}`}>{LABELS[s] || s}</span>;
}

// ---- Dropdown action menu (portaled — not clipped by table overflow) ---
export function ActionMenu({ items, label = '⋯' }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, openUp: false });
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const idRef = useRef(`menu-${Math.random().toString(36).slice(2)}`);

  const place = useCallback(() => {
    const btn = btnRef.current;
    const list = listRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuW = Math.max(list?.offsetWidth || 0, 212);
    const menuH = list?.offsetHeight || 260;
    const pad = 8;
    let left = r.right - menuW;
    left = Math.min(Math.max(pad, left), window.innerWidth - menuW - pad);
    const spaceBelow = window.innerHeight - r.bottom - pad;
    const spaceAbove = r.top - pad;
    const openUp = spaceBelow < menuH && spaceAbove > spaceBelow;
    let top = openUp ? r.top - 4 : r.bottom + 4;
    if (!openUp && top + menuH > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - menuH - pad);
    }
    if (openUp && top - menuH < pad) {
      top = Math.min(window.innerHeight - pad, menuH + pad);
    }
    setCoords({ top, left, openUp });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Second pass after menu paints so flip uses real height
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClose = (e) => {
      if (btnRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onOtherMenu = (e) => { if (e.detail !== idRef.current) setOpen(false); };
    const onReposition = () => place();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('action-menu-open', onOtherMenu);
    document.addEventListener('mousedown', onClose);
    document.addEventListener('touchstart', onClose, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('action-menu-open', onOtherMenu);
      document.removeEventListener('mousedown', onClose);
      document.removeEventListener('touchstart', onClose);
    };
  }, [open, place]);

  const entries = items.filter(Boolean);
  const style = coords.openUp
    ? { top: 'auto', bottom: `${window.innerHeight - coords.top}px`, left: coords.left }
    : { top: coords.top, left: coords.left };

  return (
    <div className="menu">
      <button
        ref={btnRef}
        type="button"
        className={`btn btn-sm menu-trigger${open ? ' open' : ''}`}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => {
            const next = !o;
            if (next) window.dispatchEvent(new CustomEvent('action-menu-open', { detail: idRef.current }));
            return next;
          });
        }}
      >
        <span className="menu-trigger-dots" aria-hidden="true">{label}</span>
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          className={`menu-list menu-portal${coords.openUp ? ' open-up' : ''}`}
          role="menu"
          style={style}
          onClick={(e) => e.stopPropagation()}
        >
          {entries.map((it, i) => it === '-' ? <hr key={`sep-${i}`} /> : (
            <button
              key={`${it.label}-${i}`}
              type="button"
              role="menuitem"
              className={`menu-item${it.danger ? ' danger' : ''}`}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
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
