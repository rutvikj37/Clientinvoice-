import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, money } from '../api.js';
import { useLoad, PageHead, Modal, Field, Empty, useToast, ActionMenu } from '../components/ui.jsx';

const EMPTY = { sku: '', name: '', hsn: '', unit: 'Nos', type: 'finished', category: '', sale_price: '', purchase_price: '', tax_rate: 18, reorder_level: 0, location: '', opening_stock: '' };

function ProductForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY, ...(initial || {}) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try { initial?.id ? await api.put(`/products/${initial.id}`, f) : await api.post('/products', f); toast('Saved'); onSaved(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <form onSubmit={save}>
      <div className="form-grid cols-3">
        <Field label="Item Code"><input value={f.sku || ''} onChange={set('sku')} placeholder="HC-50" /></Field>
        <Field label="Item Description *" span={2}><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="HSN"><input value={f.hsn || ''} onChange={set('hsn')} /></Field>
        <Field label="UOM"><input list="uoms" value={f.unit || ''} onChange={set('unit')} /></Field>
        <Field label="Type"><select value={f.type} onChange={set('type')}><option value="finished">Finished goods</option><option value="raw">Raw material</option><option value="semi">Semi-finished</option><option value="consumable">Consumable</option><option value="service">Service</option></select></Field>
        <Field label="Selling price"><input type="number" step="any" value={f.sale_price ?? ''} onChange={set('sale_price')} /></Field>
        <Field label="Purchase price"><input type="number" step="any" value={f.purchase_price ?? ''} onChange={set('purchase_price')} /></Field>
        <Field label="GST %"><select value={f.tax_rate} onChange={set('tax_rate')}>{[0, 0.25, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
        <Field label="Reorder level" hint="Low-stock alert below this"><input type="number" step="any" value={f.reorder_level ?? ''} onChange={set('reorder_level')} /></Field>
        <Field label="Category"><input value={f.category || ''} onChange={set('category')} /></Field>
        <Field label="Store location"><input value={f.location || ''} onChange={set('location')} placeholder="Rack A-2" /></Field>
        {!initial?.id && <Field label="Opening stock"><input type="number" step="any" value={f.opening_stock} onChange={set('opening_stock')} /></Field>}
      </div>
      <datalist id="uoms">{['Nos', 'Set', 'Kg', 'Mtr', 'Ltr', 'Box', 'Pcs', 'Pair'].map((u) => <option key={u} value={u} />)}</datalist>
      <div className="modal-foot inline-foot"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function AdjustModal({ product, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ mode: 'in', qty: '', note: '' });
  const save = async () => {
    try { await api.post(`/products/${product.id}/adjust`, f); toast('Stock updated'); onSaved(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Adjust stock · ${product.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <p className="muted">Current stock: <b>{product.stock_qty} {product.unit}</b></p>
      <div className="form-grid">
        <Field label="Type"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          <option value="in">Stock in (production / return)</option><option value="out">Stock out (consumption / scrap)</option><option value="set">Set to physical count</option></select></Field>
        <Field label={f.mode === 'set' ? 'Counted quantity' : 'Quantity'}><input type="number" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} autoFocus /></Field>
        <Field label="Note" span={2}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Production batch 14, damaged in transit" /></Field>
      </div>
    </Modal>
  );
}

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'items';
  const low = params.get('low') === '1';
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const toast = useToast();
  const summary = useLoad(() => api.get('/products/summary'), [edit, adjust]);
  const { data, reload } = useLoad(() => api.get(`/products?q=${encodeURIComponent(q)}&low=${low ? 1 : ''}&type=${type}`), [q, low, type]);
  const moves = useLoad(() => (tab === 'moves' || historyFor ? api.get(`/products/movements${historyFor ? `?product_id=${historyFor.id}` : ''}`) : Promise.resolve([])), [tab, historyFor]);
  const s = summary.data || {};

  return (
    <>
      <PageHead title="Inventory" sub="Stock goes down when invoices are issued and up when PO goods are received">
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ New item</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="stat-label">Active items</div><div className="stat-value">{s.items ?? '–'}</div></div>
        <div className="stat"><div className="stat-label">Stock value (at cost)</div><div className="stat-value">{money(s.stock_value)}</div></div>
        <button className="stat stat-warn clickable" onClick={() => setParams(low ? {} : { low: '1' })}><div className="stat-label">Low stock {low && '(filtered)'}</div><div className="stat-value">{s.low_stock ?? 0}</div></button>
        <div className="stat"><div className="stat-label">Out of stock</div><div className="stat-value">{s.out_of_stock ?? 0}</div></div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setParams({})}>Items</button>
        <button className={`tab ${tab === 'moves' ? 'active' : ''}`} onClick={() => setParams({ tab: 'moves' })}>Stock movements</button>
      </div>
      {tab === 'items' ? (
        <>
          <div className="filters">
            <input className="search" placeholder="Search item code, description, HSN…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="finished">Finished goods</option><option value="raw">Raw material</option><option value="semi">Semi-finished</option><option value="consumable">Consumable</option><option value="service">Service</option></select>
            {low && <button className="btn btn-sm" onClick={() => setParams({})}>Show all</button>}
          </div>
          <div className="card no-pad">
            {!data ? <p className="pad muted">Loading…</p> : data.length === 0 ? <Empty title="No items">Add items, or they are created automatically from Excel uploads.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Item Code</th><th>Description</th><th>HSN</th><th>Type</th><th className="num">Sell</th><th className="num">Cost</th><th className="num">GST</th><th className="num">In stock</th><th className="num">Reorder</th><th></th></tr></thead>
                <tbody>{data.map((p) => (
                  <tr key={p.id} className={!p.is_active ? 'muted' : ''}>
                    <td className="nowrap"><b>{p.sku || '–'}</b></td><td>{p.name}{p.location && <div className="muted small">{p.location}</div>}</td><td>{p.hsn}</td>
                    <td className="small">{p.type}</td><td className="num">{money(p.sale_price)}</td><td className="num">{money(p.purchase_price)}</td><td className="num">{p.tax_rate}%</td>
                    <td className={`num ${p.stock_qty <= p.reorder_level ? 'text-danger' : ''}`}><b>{+p.stock_qty}</b> {p.unit}</td><td className="num">{+p.reorder_level}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm" onClick={() => setAdjust(p)}>± Stock</button>
                      <ActionMenu items={[
                        { label: 'Edit', onClick: () => setEdit(p) },
                        { label: 'Stock history', onClick: () => setHistoryFor(p) },
                        { label: 'Delete', danger: true, onClick: async () => { if (!confirm(`Delete ${p.name}?`)) return; try { const r = await api.del(`/products/${p.id}`); toast(r.archived ? 'Item is used in documents, so it was archived' : 'Deleted'); reload(); } catch (e) { toast(e.message, 'error'); } } },
                      ]} />
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      ) : <Movements rows={moves.data} />}
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'New item'} onClose={() => setEdit(null)} wide><ProductForm initial={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /></Modal>}
      {adjust && <AdjustModal product={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); reload(); }} />}
      {historyFor && <Modal title={`Stock history · ${historyFor.name}`} onClose={() => setHistoryFor(null)} wide><Movements rows={moves.data} compact /></Modal>}
    </>
  );
}

function Movements({ rows, compact }) {
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <Empty title="No stock movements yet" />;
  return (
    <div className={compact ? '' : 'card no-pad'}><div className="table-wrap"><table className="table compact">
      <thead><tr><th>When</th>{!compact && <th>Item</th>}<th>Type</th><th className="num">Change</th><th className="num">Balance</th><th>Reference</th><th>By</th></tr></thead>
      <tbody>{rows.map((m) => (
        <tr key={m.id}><td className="small nowrap">{new Date(m.created_at + 'Z').toLocaleString('en-IN')}</td>{!compact && <td>{m.sku && <b>{m.sku} </b>}{m.product_name}</td>}
          <td><span className={`badge badge-${m.type === 'IN' ? 'paid' : m.type === 'OUT' ? 'unpaid' : 'draft'}`}>{m.type}</span></td>
          <td className={`num ${m.qty < 0 ? 'text-danger' : 'text-success'}`}>{m.qty > 0 ? '+' : ''}{+m.qty}</td><td className="num">{+m.balance}</td>
          <td className="small">{m.note}</td><td className="small">{m.user_name}</td></tr>
      ))}</tbody>
    </table></div></div>
  );
}
