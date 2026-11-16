import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { api, money, today } from '../api.js';
import { Field, PageHead, useToast, Modal } from '../components/ui.jsx';
import { PartyForm } from './Parties.jsx';
import { DOCS } from '../docs.js';

const blankItem = () => ({ product_id: null, item_code: '', description: '', hsn: '', qty: 1, unit: 'Nos', rate: '', discount_pct: '', tax_rate: 18 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const stateCode = (p) => p?.state_code || (p?.gstin && /^\d{2}/.test(p.gstin) ? p.gstin.slice(0, 2) : null);

export default function DocForm({ kind }) {
  const cfg = DOCS[kind];
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [company, setCompany] = useState(null);
  const [parties, setParties] = useState([]);
  const [products, setProducts] = useState([]);
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addParty, setAddParty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, ps, prods] = await Promise.all([api.get('/company'), api.get(cfg.partyApi), api.get('/products?active=1')]);
        setCompany(c); setParties(ps); setProducts(prods);
        if (id) {
          const d = await api.get(`${cfg.api}/${id}`);
          setF({ ...d, items: d.items.map((it) => ({ ...it, discount_pct: it.discount_pct || '' })) });
        } else {
          setF({
            doc_no: '', party_id: params.get('party_id') || '', doc_date: today(), due_date: '', delivery_date: '', place_of_supply: '',
            contact_person: '', contact_phone: c.phone || '', contact_email: c.email || '', payment_terms: '', transport: c.default_transport || '',
            reference: '', remarks: '', terms: c[`${kind === 'quotation' ? 'quote' : kind}_terms`] || '', shipping: 0, delivery_address: '',
            items: [blankItem()],
          });
        }
      } catch (e) { toast(e.message, 'error'); }
    })();
  }, [id, kind]); // eslint-disable-line

  const party = parties.find((p) => String(p.id) === String(f?.party_id));
  const interstate = Boolean(company && party && stateCode(company) && stateCode(party) && stateCode(company) !== stateCode(party));

  const totals = useMemo(() => {
    if (!f) return null;
    let taxable = 0, tax = 0;
    const lines = f.items.map((it) => {
      const gross = r2((+it.qty || 0) * (+it.rate || 0));
      const t = r2(gross - r2(gross * (+it.discount_pct || 0) / 100));
      const tx = r2(t * (+it.tax_rate || 0) / 100);
      taxable += t; tax += tx;
      return { taxable: t, tax: tx, amount: r2(t + tx), pad: r2((+it.rate || 0) * (1 - (+it.discount_pct || 0) / 100)) };
    });
    const raw = r2(taxable + tax + (+f.shipping || 0));
    const total = kind === 'po' ? raw : Math.round(raw);
    return { lines, taxable: r2(taxable), tax: r2(tax), round: r2(total - raw), total };
  }, [f, kind]);

  if (!f || !company) return <p className="muted">Loading…</p>;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (i, patch) => setF({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const pickProduct = (i, p) => setItem(i, {
    product_id: p.id, item_code: p.sku || '', description: p.name, hsn: p.hsn || '', unit: p.unit || 'Nos',
    rate: p[cfg.priceField] || '', tax_rate: p.tax_rate ?? 18,
  });
  const onCode = (i, v) => {
    const p = products.find((x) => x.sku && x.sku.toLowerCase() === v.trim().toLowerCase());
    if (p) pickProduct(i, p); else setItem(i, { item_code: v, product_id: null });
  };
  const onDesc = (i, v) => {
    const p = products.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    if (p && !f.items[i].product_id) pickProduct(i, p); else setItem(i, { description: v });
  };
  const onPad = (i, v) => { // typing Price Af Disc back-calculates the discount %
    const rate = +f.items[i].rate || 0;
    if (rate > 0 && v !== '') setItem(i, { discount_pct: r2((1 - +v / rate) * 100) });
  };

  const save = async (mode) => {
    if (!f.party_id) return toast(`Select a ${cfg.party.toLowerCase()}`, 'error');
    const items = f.items.filter((it) => it.description || it.item_code);
    if (!items.length) return toast('Add at least one item', 'error');
    setSaving(true);
    try {
      const body = { ...f, items, status: mode === 'draft' ? 'draft' : undefined };
      const d = id ? await api.put(`${cfg.api}/${id}`, body) : await api.post(cfg.api, body);
      if (kind === 'po' && mode === 'submit') await api.post(`/purchase-orders/${d.id}/submit`);
      toast(`${cfg.label} ${d.doc_no} saved`);
      nav(`${cfg.path}/${d.id}`);
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };

  const nextNo = company.next_numbers?.[kind];
  return (
    <>
      <PageHead title={id ? `Edit ${cfg.label} ${f.doc_no}` : `New ${cfg.label}`}>
        <Link className="btn" to={id ? `${cfg.path}/${id}` : cfg.path}>Cancel</Link>
        {kind === 'invoice' && (!id || f.status === 'draft') && <button className="btn" disabled={saving} onClick={() => save('draft')}>Save as draft</button>}
        {kind === 'po' && <button className="btn" disabled={saving} onClick={() => save('save')}>Save draft</button>}
        <button className="btn btn-primary" disabled={saving} onClick={() => save(kind === 'po' ? 'submit' : 'save')}>
          {saving ? 'Saving…' : kind === 'invoice' ? (id && f.status !== 'draft' ? 'Save changes' : 'Save & issue') : kind === 'po' ? 'Save & submit for approval' : 'Save quotation'}
        </button>
      </PageHead>

      <div className="grid-2 form-top">
        <div className="card">
          <h3 className="card-title">Document details</h3>
          <div className="form-grid">
            <Field label={cfg.noLabel} hint={!id ? `Leave blank for ${nextNo || 'automatic numbering'}` : null}><input value={f.doc_no} onChange={set('doc_no')} placeholder={nextNo} /></Field>
            <Field label={cfg.dateLabel}><input type="date" value={f.doc_date} onChange={set('doc_date')} /></Field>
            {cfg.dueLabel && <Field label={cfg.dueLabel} hint={!id && !f.due_date ? `Default: +${kind === 'quotation' ? company.quote_validity_days : company.default_due_days} days` : null}><input type="date" value={f.due_date || ''} onChange={set('due_date')} /></Field>}
            <Field label="Delivery Date"><input type="date" value={f.delivery_date || ''} onChange={set('delivery_date')} /></Field>
            <Field label="Place of Supply" hint={!f.place_of_supply ? (company.default_place_of_supply ? `Default: ${company.default_place_of_supply}` : `Default: ${cfg.party.toLowerCase()}'s city & state`) : null}><input value={f.place_of_supply || ''} onChange={set('place_of_supply')} /></Field>
            <Field label={cfg.refLabel}><input value={f.reference || ''} onChange={set('reference')} /></Field>
            <Field label="Contact Person"><input value={f.contact_person || ''} onChange={set('contact_person')} placeholder="Mr. …" /></Field>
            <Field label="Phone No"><input value={f.contact_phone || ''} onChange={set('contact_phone')} /></Field>
            <Field label="Email" span={2}><input value={f.contact_email || ''} onChange={set('contact_email')} /></Field>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Details of {cfg.party}</h3>
          <div className="party-pick">
            <select value={f.party_id} onChange={(e) => {
              const p = parties.find((x) => String(x.id) === e.target.value);
              setF({ ...f, party_id: e.target.value, payment_terms: f.payment_terms || p?.payment_terms || company.default_payment_terms || '' });
            }}>
              <option value="">Select {cfg.party.toLowerCase()}…</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
            </select>
            <button className="btn" type="button" onClick={() => setAddParty(true)}>+ New</button>
          </div>
          {party ? (
            <dl className="kv">
              <dt>{cfg.party} Code</dt><dd>{party.code || '–'}</dd>
              <dt>Address</dt><dd>{[party.address, party.city, party.pincode].filter(Boolean).join(', ') || '–'}</dd>
              <dt>State / Code</dt><dd>{party.state || '–'} {stateCode(party) ? `(${stateCode(party)})` : ''}</dd>
              <dt>GST No.</dt><dd>{party.gstin || '–'}</dd>
              <dt>Contact</dt><dd>{[party.contact_person, party.phone, party.email].filter(Boolean).join(' · ') || '–'}</dd>
            </dl>
          ) : <p className="muted small">Choose a {cfg.party.toLowerCase()} to see their details.</p>}
          {party && <div className={`alert small ${interstate ? 'alert-warn' : 'alert-info'}`}>{interstate ? 'Different state: IGST will be applied.' : 'Same state: CGST + SGST will be applied.'}</div>}
          <div className="form-grid">
            <Field label="Payment Terms"><input list="payterms" value={f.payment_terms || ''} onChange={set('payment_terms')} placeholder={company.default_payment_terms || 'Against PI'} /></Field>
            <Field label="Transport"><input value={f.transport || ''} onChange={set('transport')} placeholder="By Road / Courier" /></Field>
            {kind === 'po' && <Field label="Deliver To" span={2}><textarea rows={2} value={f.delivery_address || ''} onChange={set('delivery_address')} placeholder="Defaults to your company address" /></Field>}
          </div>
          <datalist id="payterms">{['Against PI', '100% Advance', '50% Advance, 50% before dispatch', '15 Days', '30 Days', '45 Days', '60 Days'].map((x) => <option key={x} value={x} />)}</datalist>
        </div>
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="table items-table">
            <thead><tr>
              <th style={{ width: 34 }}>Sr</th><th style={{ width: 110 }}>Item Code</th><th>Item Description</th><th style={{ width: 80 }}>HSN</th>
              <th style={{ width: 70 }} className="num">Qty</th><th style={{ width: 64 }}>UOM</th><th style={{ width: 96 }} className="num">Unit Price</th>
              <th style={{ width: 64 }} className="num">Disc %</th><th style={{ width: 96 }} className="num">Price Af Disc</th>
              <th style={{ width: 64 }} className="num">{interstate ? 'IGST %' : 'GST %'}</th><th style={{ width: 110 }} className="num">Total Amount</th><th style={{ width: 32 }}></th>
            </tr></thead>
            <tbody>
              {f.items.map((it, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td><input list="skus" value={it.item_code || ''} onChange={(e) => onCode(i, e.target.value)} aria-label="Item code" /></td>
                  <td><input list="pnames" value={it.description} onChange={(e) => onDesc(i, e.target.value)} placeholder="Type or pick an item" aria-label="Description" />
                    {it.product_id && it.stock_qty !== undefined && kind === 'invoice' && <div className="muted small">In stock: {products.find((p) => p.id === it.product_id)?.stock_qty ?? it.stock_qty}</div>}</td>
                  <td><input value={it.hsn || ''} onChange={(e) => setItem(i, { hsn: e.target.value })} aria-label="HSN" /></td>
                  <td><input type="number" step="any" className="num" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} aria-label="Qty" /></td>
                  <td><input value={it.unit || ''} onChange={(e) => setItem(i, { unit: e.target.value })} aria-label="UOM" /></td>
                  <td><input type="number" step="any" className="num" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value })} aria-label="Unit price" /></td>
                  <td><input type="number" step="any" className="num" value={it.discount_pct} onChange={(e) => setItem(i, { discount_pct: e.target.value })} aria-label="Discount %" /></td>
                  <td><input type="number" step="any" className="num" key={`${i}-${totals.lines[i].pad}`} defaultValue={totals.lines[i].pad || ''} onBlur={(e) => onPad(i, e.target.value)} aria-label="Price after discount" /></td>
                  <td><input type="number" step="any" className="num" value={it.tax_rate} onChange={(e) => setItem(i, { tax_rate: e.target.value })} aria-label="GST %" /></td>
                  <td className="num">{money(totals.lines[i].amount)}</td>
                  <td><button className="icon-btn" title="Remove line" disabled={f.items.length === 1} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pad"><button className="btn btn-sm" onClick={() => setF({ ...f, items: [...f.items, blankItem()] })}>+ Add line</button></div>
        <datalist id="skus">{products.filter((p) => p.sku).map((p) => <option key={p.id} value={p.sku}>{p.name}</option>)}</datalist>
        <datalist id="pnames">{products.map((p) => <option key={p.id} value={p.name}>{p.sku}</option>)}</datalist>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="form-grid">
            <Field label="Remarks" span={2}><textarea rows={2} value={f.remarks || ''} onChange={set('remarks')} /></Field>
            <Field label="General Conditions" span={2} hint="One condition per line"><textarea rows={4} value={f.terms || ''} onChange={set('terms')} /></Field>
          </div>
        </div>
        <div className="card totals-card">
          <div className="trow"><span>Sub Total</span><span>{money(totals.taxable)}</span></div>
          {interstate
            ? <div className="trow"><span>Add : IGST</span><span>{money(totals.tax)}</span></div>
            : <><div className="trow"><span>Add : CGST</span><span>{money(totals.tax / 2)}</span></div><div className="trow"><span>Add : SGST</span><span>{money(totals.tax / 2)}</span></div></>}
          <div className="trow"><span>Total GST</span><span>{money(totals.tax)}</span></div>
          <div className="trow"><span>Freight / Transport</span><input type="number" step="any" className="num small-input" value={f.shipping || ''} onChange={set('shipping')} placeholder="0.00" aria-label="Freight" /></div>
          {totals.round !== 0 && <div className="trow muted"><span>Round Off</span><span>{totals.round.toFixed(2)}</span></div>}
          <div className="trow grand"><span>Total</span><span>{money(totals.total)}</span></div>
        </div>
      </div>

      {addParty && (
        <Modal title={`New ${cfg.party.toLowerCase()}`} onClose={() => setAddParty(false)} wide>
          <PartyForm kind={kind === 'po' ? 'vendors' : 'customers'} onCancel={() => setAddParty(false)} onSaved={(p) => {
            setParties([...parties, p].sort((a, b) => a.name.localeCompare(b.name)));
            setF({ ...f, party_id: String(p.id), payment_terms: f.payment_terms || p.payment_terms || '' });
            setAddParty(false);
          }} />
        </Modal>
      )}
    </>
  );
}
