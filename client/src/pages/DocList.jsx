import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, fmtDate, download, openPdf } from '../api.js';
import { useLoad, Badge, ActionMenu, PageHead, Empty, useToast } from '../components/ui.jsx';
import { SendDocModal, BulkResultModal, PaymentModal } from '../components/SendDialogs.jsx';
import { DOCS, canSend } from '../docs.js';

const BULK = {
  invoice: [['whatsapp', 'WhatsApp', 'btn-wa'], ['email', 'Email'], ['download', 'Download PDFs (ZIP)'], ['issue', 'Issue drafts'], ['mark-paid', 'Mark paid'], ['cancel', 'Cancel', 'btn-danger-ghost'], ['delete', 'Delete drafts', 'btn-danger-ghost']],
  quotation: [['whatsapp', 'WhatsApp', 'btn-wa'], ['email', 'Email'], ['download', 'Download PDFs (ZIP)'], ['convert', 'Convert to invoices'], ['delete', 'Delete drafts', 'btn-danger-ghost']],
  po: [['submit', 'Submit for approval'], ['approve', 'Approve'], ['whatsapp', 'Send WhatsApp', 'btn-wa'], ['email', 'Send email'], ['download', 'Download PDFs (ZIP)'], ['cancel', 'Cancel', 'btn-danger-ghost'], ['delete', 'Delete drafts', 'btn-danger-ghost']],
};

export default function DocList({ kind }) {
  const cfg = DOCS[kind];
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const batch = params.get('batch_id') || '';
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [send, setSend] = useState(null);
  const [pay, setPay] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const qs = new URLSearchParams({ status, q, from, to, batch_id: batch }).toString();
  const { data: rows, reload, loading } = useLoad(() => api.get(`${cfg.api}?${qs}`), [qs, kind]);

  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const allChecked = rows?.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); reload(); } catch (e) { toast(e.message, 'error'); } };
  const pdf = (r) => openPdf(`${cfg.api}/${r.id}/pdf`).catch((e) => toast(e.message, 'error'));

  const bulk = async (action, title) => {
    const ids = [...selected];
    if (['cancel', 'delete'].includes(action) && !confirm(`${title} for ${ids.length} document(s)?`)) return;
    setBusy(true);
    try {
      if (action === 'download') { await download(`${cfg.api}/bulk/download`, `${cfg.plural.toLowerCase().replace(/ /g, '-')}.zip`, { ids }); return; }
      const r = await api.post(`${cfg.api}/bulk/${action}`, { ids });
      setBulkResult({ result: r, title });
      setSelected(new Set());
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const rowActions = (r) => {
    const common = [
      { label: 'View', onClick: () => nav(`${cfg.path}/${r.id}`) },
      { label: 'Edit', disabled: !editable(kind, r), onClick: () => nav(`${cfg.path}/${r.id}/edit`) },
      { label: 'View PDF', onClick: () => pdf(r) },
      { label: 'Download PDF', onClick: () => download(`${cfg.api}/${r.id}/pdf?download=1`, `${cfg.label}-${r.doc_no.replace(/\//g, '_')}.pdf`) },
      '-',
      { label: 'Send on WhatsApp', disabled: !canSend(kind, r.status), onClick: () => setSend({ id: r.id, channel: 'whatsapp' }) },
      { label: 'Send by email', disabled: !canSend(kind, r.status), onClick: () => setSend({ id: r.id, channel: 'email' }) },
      '-',
      { label: 'Duplicate', onClick: () => act(async () => { const c = await api.post(`${cfg.api}/${r.id}/duplicate`); nav(`${cfg.path}/${c.id}/edit`); }) },
    ];
    if (kind === 'invoice') return [
      ...common.slice(0, 2),
      r.status === 'draft' && { label: 'Issue invoice', onClick: () => act(() => api.post(`/invoices/${r.id}/issue`), 'Invoice issued') },
      ...common.slice(2),
      { label: 'Record payment', disabled: !['unpaid', 'partially_paid'].includes(r.status), onClick: () => setPay(r) },
      { label: 'Mark as paid', disabled: !['unpaid', 'partially_paid'].includes(r.status), onClick: () => act(() => api.post(`/invoices/${r.id}/mark-paid`), 'Marked as paid') },
      '-',
      r.status === 'draft'
        ? { label: 'Delete', danger: true, onClick: () => confirm('Delete this draft?') && act(() => api.del(`/invoices/${r.id}`), 'Deleted') }
        : { label: 'Cancel invoice', danger: true, disabled: r.status === 'cancelled', onClick: () => confirm('Cancel this invoice? Stock will be returned.') && act(() => api.post(`/invoices/${r.id}/cancel`), 'Invoice cancelled') },
    ];
    if (kind === 'quotation') return [
      ...common,
      { label: 'Convert to invoice', disabled: !['draft', 'sent', 'accepted'].includes(r.status), onClick: () => act(async () => { const x = await api.post(`/quotations/${r.id}/convert`); toast(`Invoice ${x.invoice_no} created`); nav(`/invoices/${x.invoice_id}`); }) },
      { label: 'Mark accepted', disabled: !['draft', 'sent'].includes(r.status), onClick: () => act(() => api.post(`/quotations/${r.id}/accept`), 'Marked accepted') },
      { label: 'Mark rejected', disabled: !['draft', 'sent'].includes(r.status), onClick: () => act(() => api.post(`/quotations/${r.id}/reject`), 'Marked rejected') },
      '-',
      r.status === 'draft'
        ? { label: 'Delete', danger: true, onClick: () => confirm('Delete this draft?') && act(() => api.del(`/quotations/${r.id}`), 'Deleted') }
        : { label: 'Cancel', danger: true, disabled: ['cancelled', 'converted'].includes(r.status), onClick: () => act(() => api.post(`/quotations/${r.id}/cancel`), 'Cancelled') },
    ];
    return [
      ...common,
      r.status === 'draft' || r.status === 'rejected' ? { label: 'Submit for approval', onClick: () => act(() => api.post(`/purchase-orders/${r.id}/submit`), 'Submitted') } : null,
      r.status === 'pending_approval' ? { label: 'Approve', onClick: () => act(() => api.post(`/purchase-orders/${r.id}/approve`), 'Approved') } : null,
      ['approved', 'sent', 'partially_received'].includes(r.status) ? { label: 'Receive goods (GRN)', onClick: () => nav(`/purchase-orders/${r.id}?receive=1`) } : null,
      '-',
      r.status === 'draft'
        ? { label: 'Delete', danger: true, onClick: () => confirm('Delete this draft?') && act(() => api.del(`/purchase-orders/${r.id}`), 'Deleted') }
        : { label: 'Cancel PO', danger: true, disabled: !['pending_approval', 'approved', 'sent', 'rejected'].includes(r.status), onClick: () => act(() => api.post(`/purchase-orders/${r.id}/cancel`), 'Cancelled') },
    ];
  };

  return (
    <>
      <PageHead title={cfg.plural} sub={batch ? `Showing documents from Excel upload #${batch}` : null}>
        {kind === 'invoice' && <button className="btn" onClick={() => download(`/invoices/export?${qs}`, 'invoices.xlsx')}>Export Excel</button>}
        <Link className="btn" to={`/bulk-upload?type=${kind}`}>Bulk upload (Excel)</Link>
        <Link className="btn btn-primary" to={`${cfg.path}/new`}>+ New {cfg.label.toLowerCase()}</Link>
      </PageHead>

      <div className="tabs">
        {cfg.tabs.map(([k, l]) => <button key={k} className={`tab ${status === k ? 'active' : ''}`} onClick={() => { setParams(k ? { status: k } : {}); setSelected(new Set()); }}>{l}</button>)}
      </div>
      <div className="filters">
        <input className="search" placeholder={`Search ${cfg.noLabel.replace('.', '')}, ${cfg.party.toLowerCase()}, code…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {batch && <button className="btn btn-sm" onClick={() => setParams({})}>Clear upload filter</button>}
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} selected</b>
          {BULK[kind].map(([a, l, cls]) => <button key={a} className={`btn btn-sm ${cls || ''}`} disabled={busy} onClick={() => bulk(a, l)}>{l}</button>)}
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="card no-pad">
        {!rows ? <p className="muted pad">Loading…</p> : rows.length === 0 ? (
          <Empty title={`No ${cfg.plural.toLowerCase()} found`}>Create one, or upload an Excel sheet to create many at once.</Empty>
        ) : (
          <div className="table-wrap">
            <table className={`table ${loading ? 'loading' : ''}`}>
              <thead><tr>
                <th className="check"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>
                <th>{cfg.noLabel}</th><th>{cfg.party}</th><th>Date</th>
                {kind === 'invoice' && <th>Due</th>}{kind === 'quotation' && <th>Valid till</th>}{kind === 'po' && <th>Delivery</th>}
                <th className="num">Amount</th>
                {kind === 'invoice' && <th className="num">Balance</th>}
                {kind === 'po' && <th className="num">Received</th>}
                <th>Status</th><th>Sent</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''}>
                    <td className="check"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.doc_no}`} /></td>
                    <td className="nowrap"><Link to={`${cfg.path}/${r.id}`}><b>{r.doc_no}</b></Link>{r.source === 'bulk' && <span className="tag">Excel</span>}</td>
                    <td>{r.party_name}{r.party_code && <div className="muted small">{r.party_code}</div>}</td>
                    <td className="nowrap">{fmtDate(r.doc_date)}</td>
                    {kind === 'po'
                      ? <td className="nowrap">{fmtDate(r.delivery_date)}</td>
                      : <td className={`nowrap ${r.is_overdue || r.is_expired ? 'text-danger' : ''}`}>{fmtDate(r.due_date)}</td>}
                    <td className="num">{money(r.total)}</td>
                    {kind === 'invoice' && <td className="num">{r.status === 'cancelled' ? '–' : money(r.balance)}</td>}
                    {kind === 'po' && <td className="num">{+r.qty_received} / {+r.qty_ordered}</td>}
                    <td><Badge status={r.status} overdue={r.is_overdue} />{r.is_expired && <span className="tag tag-warn">Expired</span>}</td>
                    <td className="small muted nowrap">{r.last_whatsapp_at && <span title={`WhatsApp ${r.last_whatsapp_at}`}>WA ✓ </span>}{r.last_emailed_at && <span title={`Email ${r.last_emailed_at}`}>Mail ✓</span>}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm btn-ghost" title="Send on WhatsApp" disabled={!canSend(kind, r.status)} onClick={() => setSend({ id: r.id, channel: 'whatsapp' })}>💬</button>
                      <button className="btn btn-sm btn-ghost" title="Send by email" disabled={!canSend(kind, r.status)} onClick={() => setSend({ id: r.id, channel: 'email' })}>✉</button>
                      <button className="btn btn-sm btn-ghost" title="View PDF" onClick={() => pdf(r)}>⎙</button>
                      <ActionMenu items={rowActions(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {send && <SendDocModal kind={kind} id={send.id} channel={send.channel} onClose={() => setSend(null)} onSent={reload} />}
      {pay && <PaymentModal invoice={pay} onClose={() => setPay(null)} onSaved={reload} />}
      {bulkResult && <BulkResultModal {...bulkResult} onClose={() => setBulkResult(null)} />}
    </>
  );
}

export function editable(kind, d) {
  if (kind === 'invoice') return ['draft', 'unpaid'].includes(d.status) && !(d.amount_paid > 0);
  if (kind === 'quotation') return ['draft', 'sent', 'rejected'].includes(d.status);
  return ['draft', 'rejected'].includes(d.status);
}
