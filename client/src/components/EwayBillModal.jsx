import { useState } from 'react';
import { api, fmtDate, today } from '../api.js';
import { Field, Modal, useToast } from './ui.jsx';

const EMPTY = {
  eway_bill_no: '',
  eway_bill_date: '',
  eway_valid_upto: '',
  vehicle_no: '',
  transporter_name: '',
  transporter_gstin: '',
  transporter_id: '',
  approx_distance_km: '',
  dispatch_from: '',
  ship_to: '',
};

function fromInvoice(inv) {
  if (!inv) return { ...EMPTY, eway_bill_date: today() };
  return {
    eway_bill_no: inv.eway_bill_no || '',
    eway_bill_date: inv.eway_bill_date || today(),
    eway_valid_upto: inv.eway_valid_upto || '',
    vehicle_no: inv.vehicle_no || '',
    transporter_name: inv.transporter_name || '',
    transporter_gstin: inv.transporter_gstin || '',
    transporter_id: inv.transporter_id || '',
    approx_distance_km: inv.approx_distance_km != null && inv.approx_distance_km !== '' ? String(inv.approx_distance_km) : '',
    dispatch_from: inv.dispatch_from || '',
    ship_to: inv.ship_to || '',
  };
}

export function hasEway(inv) {
  if (!inv) return false;
  return !!(inv.eway_bill_no || inv.vehicle_no || inv.transporter_name || inv.transporter_gstin);
}

export function EwaySummary({ invoice }) {
  if (!hasEway(invoice)) return <p className="muted small">Not recorded. Generate on the GST portal, then add the number here.</p>;
  return (
    <dl className="kv">
      <dt>E-way bill No.</dt><dd>{invoice.eway_bill_no || '–'}</dd>
      <dt>Date</dt><dd>{invoice.eway_bill_date ? fmtDate(invoice.eway_bill_date) : '–'}</dd>
      <dt>Valid upto</dt><dd>{invoice.eway_valid_upto ? fmtDate(invoice.eway_valid_upto) : '–'}</dd>
      <dt>Vehicle No.</dt><dd>{invoice.vehicle_no || '–'}</dd>
      <dt>Transporter</dt><dd>{invoice.transporter_name || '–'}</dd>
      <dt>Transporter GSTIN</dt><dd>{invoice.transporter_gstin || '–'}</dd>
      {invoice.transporter_id && <><dt>Transporter ID</dt><dd>{invoice.transporter_id}</dd></>}
      {invoice.approx_distance_km != null && invoice.approx_distance_km !== '' && (
        <><dt>Distance</dt><dd>{invoice.approx_distance_km} km</dd></>
      )}
      {invoice.dispatch_from && <><dt>Dispatch from</dt><dd>{invoice.dispatch_from}</dd></>}
      {invoice.ship_to && <><dt>Ship to</dt><dd>{invoice.ship_to}</dd></>}
    </dl>
  );
}

export function EwayBillModal({ invoice, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => fromInvoice(invoice));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cancelled = invoice?.status === 'cancelled';

  const save = async (e) => {
    e?.preventDefault?.();
    if (cancelled) return toast('Cannot update e-way bill on a cancelled invoice', 'error');
    setSaving(true);
    try {
      const body = {
        ...f,
        approx_distance_km: f.approx_distance_km === '' ? null : f.approx_distance_km,
      };
      const inv = await api.put(`/invoices/${invoice.id}/eway-bill`, body);
      toast('E-way bill saved');
      onSaved?.(inv);
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const clear = async () => {
    if (!hasEway(invoice)) return onClose();
    if (!confirm('Clear all e-way bill details from this invoice?')) return;
    setSaving(true);
    try {
      const inv = await api.put(`/invoices/${invoice.id}/eway-bill`, { clear: true });
      toast('E-way bill cleared');
      onSaved?.(inv);
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={`E-way bill · ${invoice.doc_no}`}
      onClose={onClose}
      wide
      footer={(
        <>
          {hasEway(invoice) && !cancelled && (
            <button type="button" className="btn btn-danger-ghost" disabled={saving} onClick={clear}>Clear</button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {!cancelled && (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save e-way bill'}
            </button>
          )}
        </>
      )}
    >
      <p className="muted small">
        Generate the e-way bill on the GST portal, then record the number and transport details here. They print on the invoice PDF.
      </p>
      <form onSubmit={save}>
        <div className="form-grid cols-3">
          <Field label="E-way bill No."><input value={f.eway_bill_no} onChange={set('eway_bill_no')} placeholder="e.g. 123456789012" disabled={cancelled} /></Field>
          <Field label="E-way bill date"><input type="date" value={f.eway_bill_date || ''} onChange={set('eway_bill_date')} disabled={cancelled} /></Field>
          <Field label="Valid upto"><input type="date" value={f.eway_valid_upto || ''} onChange={set('eway_valid_upto')} disabled={cancelled} /></Field>
          <Field label="Vehicle No."><input value={f.vehicle_no} onChange={set('vehicle_no')} placeholder="RJ14AB1234" disabled={cancelled} /></Field>
          <Field label="Transporter name"><input value={f.transporter_name} onChange={set('transporter_name')} disabled={cancelled} /></Field>
          <Field label="Transporter GSTIN"><input value={f.transporter_gstin} onChange={set('transporter_gstin')} maxLength={15} disabled={cancelled} /></Field>
          <Field label="Transporter ID / Doc No."><input value={f.transporter_id} onChange={set('transporter_id')} disabled={cancelled} /></Field>
          <Field label="Approx. distance (km)"><input type="number" min="0" step="any" value={f.approx_distance_km} onChange={set('approx_distance_km')} disabled={cancelled} /></Field>
          <Field label="Dispatch from" span={3}><input value={f.dispatch_from} onChange={set('dispatch_from')} placeholder="Warehouse / factory address" disabled={cancelled} /></Field>
          <Field label="Ship to" span={3}><input value={f.ship_to} onChange={set('ship_to')} placeholder="Delivery address if different from customer" disabled={cancelled} /></Field>
        </div>
      </form>
    </Modal>
  );
}
