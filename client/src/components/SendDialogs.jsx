import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Field, useToast } from './ui.jsx';
import { DOCS, sendRequest } from '../docs.js';

/** Email or WhatsApp a single document, with editable recipient + message */
export function SendDocModal({ kind = 'invoice', id, channel, onClose, onSent }) {
  const cfg = DOCS[kind];
  const toast = useToast();
  const [share, setShare] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`${cfg.api}/${id}/share`).then((s) => {
      setShare(s);
      setF(channel === 'email' ? { to: s.email.to, cc: '', subject: s.email.subject, message: s.email.message } : { phone: s.whatsapp.phone, message: s.whatsapp.message });
    }).catch((e) => { toast(e.message, 'error'); onClose(); });
  }, [id, channel]); // eslint-disable-line
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const send = async () => {
    setBusy(true);
    try {
      const [url, body] = sendRequest(kind, id, channel, f);
      const r = await api.post(url, body);
      if (channel === 'whatsapp' && r.mode === 'link') {
        window.open(r.url, '_blank');
        toast(`WhatsApp opened with the ${cfg.label.toLowerCase()} link. Press send in WhatsApp.`);
      } else toast(channel === 'email' ? `${cfg.label} emailed` : `${cfg.label} sent on WhatsApp`);
      onSent?.(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal title={channel === 'email' ? `Email ${cfg.label.toLowerCase()}` : `Send ${cfg.label.toLowerCase()} on WhatsApp`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!share || busy} onClick={send}>{busy ? 'Sending…' : channel === 'email' ? 'Send email' : 'Send on WhatsApp'}</button></>}>
      {!share ? <p className="muted">Loading…</p> : channel === 'email' ? (
        <div className="form-grid">
          <Field label="To" span={2}><input value={f.to} onChange={set('to')} placeholder="customer@example.com" /></Field>
          <Field label="CC" span={2}><input value={f.cc} onChange={set('cc')} /></Field>
          <Field label="Subject" span={2}><input value={f.subject} onChange={set('subject')} /></Field>
          <Field label="Message" span={2} hint={`The ${cfg.label.toLowerCase()} PDF is attached automatically.`}><textarea rows={9} value={f.message} onChange={set('message')} /></Field>
        </div>
      ) : (
        <div className="form-grid">
          <Field label="WhatsApp number" span={2} hint="10-digit Indian numbers get +91 added automatically."><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Message" span={2}><textarea rows={6} value={f.message} onChange={set('message')} /></Field>
          <div className="span-2 alert alert-info small">
            {share.whatsapp.api
              ? 'WhatsApp Business API is connected: the PDF is sent directly as a document.'
              : 'WhatsApp opens with this message and a secure link to the PDF. To send the PDF automatically, connect the WhatsApp Business API in Company Settings.'}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Shows per-invoice outcome of a bulk action, with "Open WhatsApp" buttons for link-mode results */
export function BulkResultModal({ result, title, onClose }) {
  const links = result.results.filter((r) => r.ok && r.mode === 'link');
  const [opened, setOpened] = useState({});
  return (
    <Modal title={title} onClose={onClose} wide footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p><b>{result.success}</b> succeeded{result.failed ? <>, <b className="text-danger">{result.failed}</b> failed</> : ''}.</p>
      {links.length > 0 && <p className="muted small">Click each button to open WhatsApp with the document link, then press send.</p>}
      <div className="table-wrap"><table className="table compact"><tbody>
        {result.results.map((r) => (
          <tr key={r.id}>
            <td>{r.doc_no}</td><td>{r.party || ''}</td>
            <td>{r.ok ? <span className="text-success">✓ Done</span> : <span className="text-danger">{r.error}</span>}</td>
            <td className="num">{r.ok && r.mode === 'link' && (
              <a className={`btn btn-sm ${opened[r.id] ? '' : 'btn-wa'}`} href={r.url} target="_blank" rel="noreferrer" onClick={() => setOpened({ ...opened, [r.id]: true })}>
                {opened[r.id] ? 'Opened ✓' : 'Open WhatsApp'}</a>)}</td>
          </tr>
        ))}
      </tbody></table></div>
    </Modal>
  );
}

export function PaymentModal({ invoice, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: (invoice.total - invoice.amount_paid).toFixed(2), paid_on: new Date().toISOString().slice(0, 10), mode: 'NEFT', reference: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await api.post(`/invoices/${invoice.id}/payments`, f); toast('Payment recorded'); onSaved(); onClose(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Record payment · ${invoice.doc_no}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save payment</button></>}>
      <div className="form-grid">
        <Field label="Amount"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Date"><input type="date" value={f.paid_on} onChange={set('paid_on')} /></Field>
        <Field label="Mode"><select value={f.mode} onChange={set('mode')}>{['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference / UTR"><input value={f.reference} onChange={set('reference')} /></Field>
      </div>
    </Modal>
  );
}
