import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, fmtDate, download, getToken } from '../api.js';
import { Badge, PageHead, useToast, Modal, Field, useLoad } from '../components/ui.jsx';
import { SendDocModal, PaymentModal } from '../components/SendDialogs.jsx';
import { DOCS, canSend } from '../docs.js';
import { editable } from './DocList.jsx';
import { useAuth } from '../auth.jsx';

const PO_STEPS = [['draft', 'Draft'], ['pending_approval', 'Approval'], ['approved', 'Approved'], ['sent', 'Sent to vendor'], ['partially_received', 'Receiving'], ['received', 'Received'], ['closed', 'Closed']];
const Q_STEPS = [['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['converted', 'Invoiced']];
const INV_STEPS = [['draft', 'Draft'], ['unpaid', 'Issued'], ['partially_paid', 'Part paid'], ['paid', 'Paid']];

function Stepper({ steps, status }) {
  const idx = steps.findIndex(([s]) => s === status);
  if (idx < 0) return <div className="stepper-off"><Badge status={status} /></div>;
  return (
    <ol className="stepper">
      {steps.map(([s, l], i) => <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}><span className="dot">{i < idx ? '✓' : i + 1}</span>{l}</li>)}
    </ol>
  );
}

function PdfPreview({ url, version }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let href;
    fetch(`/api${url}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.blob()).then((b) => { href = URL.createObjectURL(b); setSrc(href); });
    return () => href && URL.revokeObjectURL(href);
  }, [url, version]);
  return src ? <iframe className="pdf-frame" src={src} title="PDF preview" /> : <div className="pdf-frame muted center">Loading preview…</div>;
}

export default function DocView({ kind }) {
  const cfg = DOCS[kind];
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data: d, reload, error } = useLoad(() => api.get(`${cfg.api}/${id}`), [id, kind]);
  const [send, setSend] = useState(null);
  const [pay, setPay] = useState(false);
  const [receive, setReceive] = useState(false);
  const [reason, setReason] = useState(null);
  const [ver, setVer] = useState(0);

  useEffect(() => { if (params.get('receive') && d) { setReceive(true); setParams({}); } }, [d]); // eslint-disable-line

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <p className="muted">Loading…</p>;

  const refresh = () => { reload(); setVer((v) => v + 1); };
  const act = async (path, body, msg) => {
    try { const r = await api.post(`${cfg.api}/${d.id}/${path}`, body); if (msg) toast(msg); refresh(); return r; } catch (e) { toast(e.message, 'error'); }
  };
  const fileName = `${cfg.label}-${d.doc_no.replace(/\//g, '_')}.pdf`;

  const buttons = [];
  if (editable(kind, d)) buttons.push(<Link key="edit" className="btn" to={`${cfg.path}/${d.id}/edit`}>Edit</Link>);
  if (kind === 'invoice') {
    if (d.status === 'draft') buttons.push(<button key="issue" className="btn btn-primary" onClick={() => act('issue', {}, 'Invoice issued')}>Issue invoice</button>);
    if (['unpaid', 'partially_paid'].includes(d.status)) {
      buttons.push(<button key="pay" className="btn btn-primary" onClick={() => setPay(true)}>Record payment</button>);
      buttons.push(<button key="paid" className="btn" onClick={() => act('mark-paid', {}, 'Marked as paid')}>Mark paid</button>);
    }
  }
  if (kind === 'quotation') {
    if (['draft', 'sent', 'accepted'].includes(d.status)) buttons.push(<button key="conv" className="btn btn-primary" onClick={async () => { const r = await act('convert', {}); if (r) { toast(`Invoice ${r.invoice_no} created`); nav(`/invoices/${r.invoice_id}`); } }}>Convert to invoice</button>);
    if (['draft', 'sent'].includes(d.status)) {
      buttons.push(<button key="acc" className="btn" onClick={() => act('accept', {}, 'Marked accepted')}>Accepted</button>);
      buttons.push(<button key="rej" className="btn" onClick={() => setReason({ action: 'reject', title: 'Reason for rejection' })}>Rejected</button>);
    }
    if (['rejected', 'cancelled'].includes(d.status)) buttons.push(<button key="reopen" className="btn" onClick={() => act('reopen', {}, 'Reopened')}>Reopen</button>);
    if (d.converted_invoice) buttons.push(<Link key="inv" className="btn" to={`/invoices/${d.converted_invoice.id}`}>Open invoice {d.converted_invoice.doc_no}</Link>);
  }
  if (kind === 'po') {
    const a = d.allowed_actions || [];
    if (a.includes('submit')) buttons.push(<button key="sub" className="btn btn-primary" onClick={() => act('submit', {}, 'Submitted')}>{d.status === 'rejected' ? 'Resubmit for approval' : 'Submit for approval'}</button>);
    if (a.includes('approve')) buttons.push(<button key="app" className="btn btn-primary" disabled={user.role !== 'admin'} title={user.role !== 'admin' ? 'Admins only' : ''} onClick={() => act('approve', {}, 'PO approved')}>Approve</button>);
    if (a.includes('reject')) buttons.push(<button key="rej" className="btn" disabled={user.role !== 'admin'} onClick={() => setReason({ action: 'reject', title: 'Reason for rejection' })}>Reject</button>);
    if (d.status === 'approved') buttons.push(<button key="sent" className="btn" onClick={() => act('send', { channel: 'manual' }, 'Marked as sent')}>Mark as sent</button>);
    if (a.includes('receive')) buttons.push(<button key="rcv" className="btn btn-primary" onClick={() => setReceive(true)}>Receive goods (GRN)</button>);
    if (a.includes('close')) buttons.push(<button key="close" className="btn" onClick={() => act('close', {}, 'PO closed')}>Close PO</button>);
  }

  const cancelAllowed = kind === 'invoice' ? !['cancelled', 'draft'].includes(d.status) && !(d.amount_paid > 0)
    : kind === 'quotation' ? ['draft', 'sent', 'accepted', 'rejected'].includes(d.status) : (d.allowed_actions || []).includes('cancel');

  return (
    <>
      <PageHead title={<>{cfg.label} {d.doc_no} <Badge status={d.status} overdue={d.is_overdue} />{d.is_expired && <span className="tag tag-warn">Expired</span>}</>}
        sub={<>{d.party?.name} · {fmtDate(d.doc_date)} · <b>{money(d.total)}</b>{kind === 'invoice' && d.status !== 'cancelled' && d.status !== 'draft' && <> · Balance {money(d.balance)}</>}</>}>
        <Link className="btn btn-ghost" to={cfg.path}>← All {cfg.plural.toLowerCase()}</Link>
      </PageHead>

      <Stepper steps={kind === 'po' ? PO_STEPS : kind === 'quotation' ? Q_STEPS : INV_STEPS} status={d.status} />
      {kind === 'po' && d.status === 'rejected' && d.rejection_reason && <div className="alert alert-error">Rejected: {d.rejection_reason}</div>}
      {kind === 'po' && d.approver && <p className="muted small">Approved by {d.approver} on {fmtDate(d.approved_at)}</p>}

      <div className="actionbar">
        {buttons}
        <span className="spacer" />
        <button className="btn btn-wa" disabled={!canSend(kind, d.status)} title={!canSend(kind, d.status) ? (kind === 'po' ? 'Approve the PO first' : 'Issue first') : ''} onClick={() => setSend('whatsapp')}>💬 WhatsApp</button>
        <button className="btn" disabled={!canSend(kind, d.status)} onClick={() => setSend('email')}>✉ Email</button>
        <button className="btn" onClick={() => download(`${cfg.api}/${d.id}/pdf?download=1`, fileName)}>⬇ PDF</button>
        <button className="btn" onClick={async () => { const c = await api.post(`${cfg.api}/${d.id}/duplicate`); nav(`${cfg.path}/${c.id}/edit`); }}>Duplicate</button>
        {cancelAllowed && <button className="btn btn-danger-ghost" onClick={() => setReason({ action: 'cancel', title: `Cancel this ${cfg.label.toLowerCase()}?` })}>Cancel</button>}
        {d.status === 'draft' && <button className="btn btn-danger-ghost" onClick={async () => { if (!confirm('Delete this draft?')) return; try { await api.del(`${cfg.api}/${d.id}`); nav(cfg.path); } catch (e) { toast(e.message, 'error'); } }}>Delete</button>}
      </div>

      <div className="view-grid">
        <PdfPreview url={`${cfg.api}/${d.id}/pdf`} version={`${ver}-${d.updated_at}`} />
        <div className="side">
          {kind === 'invoice' && (
            <div className="card">
              <div className="card-head"><h3>Payments</h3></div>
              {d.payments.length === 0 ? <p className="muted small">No payments recorded.</p> : (
                <table className="table compact"><tbody>
                  {d.payments.map((p) => (
                    <tr key={p.id}><td>{fmtDate(p.paid_on)}<div className="muted small">{p.mode} {p.reference}</div></td><td className="num">{money(p.amount)}</td>
                      <td><button className="icon-btn" title="Delete payment" onClick={async () => { if (confirm('Delete this payment?')) { await api.del(`/invoices/${d.id}/payments/${p.id}`); refresh(); } }}>×</button></td></tr>
                  ))}
                </tbody></table>
              )}
              <div className="trow"><span>Paid</span><b>{money(d.amount_paid)}</b></div>
              <div className="trow"><span>Balance</span><b>{money(d.balance)}</b></div>
            </div>
          )}
          {kind === 'po' && (
            <div className="card">
              <div className="card-head"><h3>Receiving</h3></div>
              <table className="table compact"><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th></tr></thead><tbody>
                {d.items.map((it) => <tr key={it.id}><td>{it.item_code && <b>{it.item_code} </b>}{it.description}</td><td className="num">{+it.qty} {it.unit}</td><td className={`num ${it.received_qty >= it.qty ? 'text-success' : ''}`}>{+it.received_qty}</td></tr>)}
              </tbody></table>
              {d.receipts.map((r) => (
                <div key={r.id} className="receipt"><b>{r.grn_no}</b> · {fmtDate(r.received_on)} · {r.user_name}<div className="muted small">{r.items.map((x) => `${x.description}: ${+x.qty} ${x.unit || ''}`).join(', ')}{r.note ? ` · ${r.note}` : ''}</div></div>
              ))}
            </div>
          )}
          <div className="card">
            <div className="card-head"><h3>{cfg.party}</h3></div>
            <dl className="kv">
              <dt>Name</dt><dd>{d.party?.name}</dd>
              {d.party?.code && <><dt>Code</dt><dd>{d.party.code}</dd></>}
              <dt>GST No.</dt><dd>{d.party?.gstin || '–'}</dd>
              <dt>Phone</dt><dd>{d.party?.phone || <span className="text-danger small">Missing: needed for WhatsApp</span>}</dd>
              <dt>Email</dt><dd>{d.party?.email || <span className="text-danger small">Missing: needed for email</span>}</dd>
              <dt>Payment Terms</dt><dd>{d.payment_terms || '–'}</dd>
              <dt>Transport</dt><dd>{d.transport || '–'}</dd>
            </dl>
          </div>
          <div className="card">
            <div className="card-head"><h3>Activity</h3></div>
            <ul className="activity">
              {d.activity.map((a) => <li key={a.id}><b>{a.action.replace(/_/g, ' ')}</b>{a.detail ? ` · ${a.detail}` : ''}<div className="muted small">{a.user_name || 'System'} · {new Date(a.created_at + 'Z').toLocaleString('en-IN')}</div></li>)}
            </ul>
          </div>
        </div>
      </div>

      {send && <SendDocModal kind={kind} id={d.id} channel={send} onClose={() => setSend(null)} onSent={refresh} />}
      {pay && <PaymentModal invoice={d} onClose={() => setPay(false)} onSaved={refresh} />}
      {receive && <ReceiveModal po={d} onClose={() => setReceive(false)} onSaved={() => { setReceive(false); refresh(); }} />}
      {reason && <ReasonModal title={reason.title} onClose={() => setReason(null)} onSubmit={async (text) => { await act(reason.action, { reason: text }, reason.action === 'cancel' ? 'Cancelled' : 'Updated'); setReason(null); }} />}
    </>
  );
}

function ReasonModal({ title, onClose, onSubmit }) {
  const [text, setText] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn btn-primary" onClick={() => onSubmit(text)}>Confirm</button></>}>
      <Field label="Reason (optional)"><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  );
}

function ReceiveModal({ po, onClose, onSaved }) {
  const toast = useToast();
  const [qty, setQty] = useState(Object.fromEntries(po.items.map((it) => [it.id, Math.max(0, it.qty - it.received_qty)])));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const save = async () => {
    try {
      await api.post(`/purchase-orders/${po.id}/receive`, { received_on: date, note, items: Object.entries(qty).map(([po_item_id, q]) => ({ po_item_id, qty: q })) });
      toast('Goods received: stock updated'); onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Receive goods · ${po.doc_no}`} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save GRN</button></>}>
      <p className="muted small">Received quantities are added to inventory for items linked to an item code.</p>
      <table className="table compact">
        <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Already received</th><th className="num" style={{ width: 120 }}>Receiving now</th></tr></thead>
        <tbody>{po.items.map((it) => (
          <tr key={it.id}><td>{it.item_code && <b>{it.item_code} </b>}{it.description}{!it.product_id && <div className="muted small">Not linked to inventory</div>}</td>
            <td className="num">{+it.qty} {it.unit}</td><td className="num">{+it.received_qty}</td>
            <td><input type="number" step="any" className="num" min="0" max={it.qty - it.received_qty} value={qty[it.id]} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} aria-label={`Receiving ${it.description}`} /></td></tr>
        ))}</tbody>
      </table>
      <div className="form-grid">
        <Field label="Received on"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (vendor invoice / challan no.)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
