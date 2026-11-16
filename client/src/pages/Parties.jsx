import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { useLoad, PageHead, Modal, Field, Empty, useToast, ActionMenu } from '../components/ui.jsx';

const EMPTY = { code: '', name: '', contact_person: '', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', payment_terms: '' };

export function PartyForm({ kind, initial, onSaved, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY, ...(initial || {}) });
  const [states, setStates] = useState([]);
  useEffect(() => { api.get('/company/states').then(setStates).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onGstin = (e) => {
    const g = e.target.value.toUpperCase();
    const st = /^\d{2}/.test(g) ? states.find((s) => s.code === g.slice(0, 2)) : null;
    setF({ ...f, gstin: g, state: f.state || st?.name || '' });
  };
  const save = async (e) => {
    e.preventDefault();
    try {
      const p = initial?.id ? await api.put(`/${kind}/${initial.id}`, f) : await api.post(`/${kind}`, f);
      toast('Saved'); onSaved(p);
    } catch (err) { toast(err.message, 'error'); }
  };
  const word = kind === 'vendors' ? 'Vendor' : 'Customer';
  return (
    <form onSubmit={save}>
      <div className="form-grid cols-3">
        <Field label={`${word} Code`}><input value={f.code || ''} onChange={set('code')} placeholder={kind === 'vendors' ? 'MCH-001' : 'C-001'} /></Field>
        <Field label="Name *" span={2}><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Contact Person"><input value={f.contact_person || ''} onChange={set('contact_person')} /></Field>
        <Field label="Mobile (WhatsApp)" hint="Used for WhatsApp sending"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email" hint="Used for email sending"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="GST No." hint="State fills in from the first 2 digits"><input value={f.gstin || ''} onChange={onGstin} maxLength={15} /></Field>
        <Field label="State"><select value={f.state || ''} onChange={set('state')}><option value="">Select…</option>{states.map((s) => <option key={s.code} value={s.name}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label="Payment Terms"><input value={f.payment_terms || ''} onChange={set('payment_terms')} placeholder="Against PI" /></Field>
        <Field label="Address" span={2}><input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="City"><input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="Pincode"><input value={f.pincode || ''} onChange={set('pincode')} /></Field>
      </div>
      <div className="modal-foot inline-foot"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

export default function Parties({ kind }) {
  const word = kind === 'vendors' ? 'Vendor' : 'Customer';
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get(`/${kind}?q=${encodeURIComponent(q)}`), [q, kind]);
  const del = async (p) => { if (!confirm(`Delete ${p.name}?`)) return; try { await api.del(`/${kind}/${p.id}`); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHead title={`${word}s`} sub={kind === 'vendors' ? 'Suppliers you raise purchase orders to' : 'Buyers you send quotations and invoices to'}>
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ New {word.toLowerCase()}</button>
      </PageHead>
      <div className="filters"><input className="search" placeholder="Search name, code, GST No., phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card no-pad">
        {!data ? <p className="pad muted">Loading…</p> : data.length === 0 ? <Empty title={`No ${word.toLowerCase()}s yet`}>Add one, or they will be created automatically from Excel uploads.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>GST No.</th><th>State</th><th>Contact</th>{kind === 'customers' ? <><th className="num">Invoices</th><th className="num">Outstanding</th></> : <th className="num">POs</th>}<th className="row-actions-head">Actions</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}>
                <td className="nowrap">{p.code || '–'}</td>
                <td><b>{p.name}</b>{p.contact_person && <div className="muted small">{p.contact_person}</div>}</td>
                <td className="small">{p.gstin || '–'}</td><td>{p.state || '–'}</td>
                <td className="small">{p.phone}{p.phone && p.email && <br />}{p.email}</td>
                {kind === 'customers' ? <><td className="num">{p.invoice_count}</td><td className="num">{money(p.outstanding)}</td></> : <td className="num">{p.po_count}</td>}
                <td className="row-actions"><ActionMenu items={kind === 'customers' ? [
                  { label: 'Edit', onClick: () => setEdit(p) },
                  { label: 'New quotation', onClick: () => (location.href = `/quotations/new?party_id=${p.id}`) },
                  { label: 'New invoice', onClick: () => (location.href = `/invoices/new?party_id=${p.id}`) },
                  { label: 'Delete', danger: true, onClick: () => del(p) },
                ] : [
                  { label: 'Edit', onClick: () => setEdit(p) },
                  { label: 'New purchase order', onClick: () => (location.href = `/purchase-orders/new?party_id=${p.id}`) },
                  { label: 'Delete', danger: true, onClick: () => del(p) },
                ]} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : `New ${word.toLowerCase()}`} onClose={() => setEdit(null)} wide>
        <PartyForm kind={kind} initial={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      </Modal>}
    </>
  );
}
