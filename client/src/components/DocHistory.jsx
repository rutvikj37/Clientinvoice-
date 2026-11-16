import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, useToast } from './ui.jsx';

const ACTION_LABELS = {
  created: 'Created',
  updated: 'Edited',
  issued: 'Issued',
  cancelled: 'Cancelled',
  reset: 'Reset to draft',
  payment: 'Payment recorded',
  payment_deleted: 'Payment removed',
  emailed: 'Emailed',
  whatsapp: 'WhatsApp',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  converted: 'Converted to invoice',
  submitted: 'Submitted',
  approved: 'Approved',
  received: 'Goods received',
  closed: 'Closed',
  duplicated: 'Duplicated',
  eway_updated: 'E-way bill updated',
  eway_cleared: 'E-way bill cleared',
};

export function actionLabel(action) {
  return ACTION_LABELS[action] || String(action || '').replace(/_/g, ' ');
}

export function formatActivityTime(createdAt) {
  if (!createdAt) return '';
  const raw = String(createdAt);
  const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

export function HistoryList({ activity }) {
  if (!activity?.length) return <p className="muted small">No history yet for this document.</p>;
  return (
    <ul className="activity history-list">
      {activity.map((a) => (
        <li key={a.id}>
          <div className="history-row">
            <span className={`history-dot history-dot-${a.action}`} />
            <div>
              <b>{actionLabel(a.action)}</b>
              {a.detail ? <div className="history-detail">{a.detail}</div> : null}
              <div className="muted small">{a.user_name || 'System'} · {formatActivityTime(a.created_at)}</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Full history modal — loads activity for an invoice / quotation / PO. */
export function DocHistoryModal({ kind, id, docNo, activity: initial, onClose }) {
  const toast = useToast();
  const [activity, setActivity] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return undefined;
    let cancelled = false;
    setLoading(true);
    const apiBase = { invoice: '/invoices', quotation: '/quotations', po: '/purchase-orders' }[kind];
    api.get(`${apiBase}/${id}/history`)
      .then((r) => { if (!cancelled) setActivity(r.activity || []); })
      .catch((e) => { if (!cancelled) toast(e.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id, initial]); // eslint-disable-line

  return (
    <Modal
      title={`History · ${docNo || `#${id}`}`}
      onClose={onClose}
      wide
      footer={<button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      <p className="muted small">Past changes for this {kind === 'po' ? 'purchase order' : kind} — who did what and when.</p>
      {loading ? <p className="muted">Loading history…</p> : <HistoryList activity={activity} />}
    </Modal>
  );
}
