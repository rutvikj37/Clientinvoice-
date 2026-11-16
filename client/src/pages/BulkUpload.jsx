import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, money, fmtDate } from '../api.js';
import { PageHead, useToast, useLoad } from '../components/ui.jsx';
import { DOCS } from '../docs.js';

const type = 'invoice';
const cfg = DOCS.invoice;

export default function BulkUpload() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const fileRef = useRef();
  const [step, setStep] = useState('upload'); // upload | map | preview | done
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [opts, setOpts] = useState({ status: 'unpaid', create_products: true });
  const batches = useLoad(() => api.get('/bulk/batches'), [result]);

  // Bulk upload is invoices-only; normalize any other ?type= to invoice
  useEffect(() => {
    const t = params.get('type');
    if (t && t !== 'invoice') setParams({ type: 'invoice' }, { replace: true });
  }, [params, setParams]);

  const reset = () => { setStep('upload'); setParsed(null); setPreview(null); setResult(null); setMapping({}); };

  const onFiles = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      const r = await api.upload(`/bulk/parse?type=${type}`, fd);
      r.fileErrors?.forEach((e) => toast(e, 'error'));
      setParsed(r);
      if (r.flat) { setMapping(r.flat.mapping); setStep('map'); }
      else await runPreview(r, {});
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const runPreview = async (p = parsed, m = mapping) => {
    setBusy(true);
    try {
      const r = await api.post('/bulk/import', { uploadId: p.uploadId, mapping: m, dry_run: true, options: opts });
      setPreview(r); setStep('preview');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const r = await api.post('/bulk/import', { uploadId: parsed.uploadId, mapping, options: opts });
      setResult(r); setStep('done');
      toast(`${r.created.length} ${cfg.plural.toLowerCase()} created`);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const groups = parsed?.fields ? ['doc', 'party', 'item'].map((g) => [g, parsed.fields.filter((f) => f.group === g)]) : [];
  const GROUP_LABEL = { doc: 'Document details', party: `${cfg.party} details`, item: 'Line items' };

  return (
    <>
      <PageHead title="Bulk upload from Excel" sub="Create many invoices in one go" />

      <ol className="wizard">
        {[['upload', 'Upload'], ['map', 'Match columns'], ['preview', 'Check'], ['done', 'Done']].map(([s, l], i) => (
          <li key={s} className={step === s ? 'current' : ['upload', 'map', 'preview', 'done'].indexOf(step) > i ? 'done' : ''}>{i + 1}. {l}</li>
        ))}
      </ol>

      {step === 'upload' && (
        <div className="grid-2">
          <div className={`card dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
            <div className="drop-icon">⇪</div>
            <h3>Drop Excel files here</h3>
            <p className="muted">.xlsx or .csv · you can select several files at once</p>
            <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Reading…' : 'Choose files'}</button>
            <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv" hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
          <div className="card">
            <h3 className="card-title">How to upload invoices</h3>
            <div className="howto">
              <div>
                <b>1. Bulk sheet (many invoices in one file)</b>
                <p className="muted small">Download the sheet → fill one row per item (Doc No., Date, {cfg.party} Code/Name, Item Description, Qty, Unit Price…) → upload. Rows with the same <i>Doc Ref</i> become one invoice.</p>
                <button className="btn btn-sm" onClick={() => download(`/bulk/template?type=${type}`, `bulk-${type}-template.xlsx`)}>Download bulk sheet template</button>
              </div>
              <div>
                <b>2. Form file (one invoice per Excel)</b>
                <p className="muted small">Download the blank form → fill <i>customer Name</i> and at least one item row (Description, Qty, Unit Price) → upload. Do not upload the empty template as-is; sample codes in a blank file are ignored.</p>
                <button className="btn btn-sm" onClick={() => download(`/bulk/form-template?type=${type}`, 'Invoice_Form_Template.xlsx')}>Download blank form template</button>
              </div>
            </div>
            <ul className="muted small bullets">
              <li>Always fill the file first, then upload — an empty template will not create invoices.</li>
              <li>New {cfg.party.toLowerCase()}s are created automatically (matched by Code, then GST No., then Name).</li>
              <li>New item codes are added to Inventory; known codes fill HSN, UOM, price and GST automatically.</li>
              <li>CGST+SGST or IGST is chosen automatically from the {cfg.party.toLowerCase()}'s state / GST No.</li>
            </ul>
          </div>
        </div>
      )}

      {step === 'map' && parsed?.flat && (
        <div className="card">
          <div className="card-head">
            <div><h3>Match your columns</h3><p className="muted small">{parsed.flat.files.join(', ')} · {parsed.flat.totalRows} rows. We matched what we could; check the ones marked *.</p></div>
            <div className="page-actions"><button className="btn" onClick={reset}>Back</button><button className="btn btn-primary" disabled={busy} onClick={() => runPreview()}>{busy ? 'Checking…' : 'Check data →'}</button></div>
          </div>
          {parsed.forms.length > 0 && <div className="alert alert-info small">{parsed.forms.length} form file(s) were also detected and will be included.</div>}
          {groups.map(([g, fields]) => (
            <div key={g} className="map-group">
              <h4>{GROUP_LABEL[g]}</h4>
              <div className="map-grid">
                {fields.map((f) => (
                  <label key={f.key} className={`map-row ${f.required && !mapping[f.key] ? 'missing' : ''}`}>
                    <span>{f.label}</span>
                    <select value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                      <option value="">— not in my file —</option>
                      {parsed.flat.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <h4>First rows of your file</h4>
          <div className="table-wrap"><table className="table compact sample">
            <thead><tr>{parsed.flat.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{parsed.flat.sample.map((r, i) => <tr key={i}>{parsed.flat.headers.map((h) => <td key={h}>{String(r[h] ?? '')}</td>)}</tr>)}</tbody>
          </table></div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Ready to create {preview.valid} {(preview.valid === 1 ? cfg.label : cfg.plural).toLowerCase()}</h3>
              <p className="muted small">{preview.documents} found · <span className="text-success">{preview.valid} OK</span>{preview.invalid > 0 && <> · <span className="text-danger">{preview.invalid} with errors (will be skipped)</span></>}</p>
            </div>
            <div className="page-actions">
              <button className="btn" onClick={() => (parsed.flat ? setStep('map') : reset())}>Back</button>
              <button className="btn btn-primary" disabled={busy || !preview.valid} onClick={runImport}>{busy ? 'Creating…' : `Create ${preview.valid} ${(preview.valid === 1 ? cfg.label : cfg.plural).toLowerCase()}`}</button>
            </div>
          </div>
          <div className="options">
            <label className="inline">Create invoices as
              <select value={opts.status} onChange={(e) => setOpts({ ...opts, status: e.target.value })}><option value="unpaid">Issued (stock deducted)</option><option value="draft">Draft (review first)</option></select>
            </label>
            <label className="inline"><input type="checkbox" checked={opts.create_products} onChange={(e) => setOpts({ ...opts, create_products: e.target.checked })} /> Add new item codes to inventory</label>
          </div>
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>Source</th><th>{cfg.noLabel}</th><th>{cfg.party}</th><th>Date</th><th className="num">Items</th><th className="num">Approx. total</th><th>Check</th></tr></thead>
            <tbody>{preview.docs.map((g) => (
              <tr key={g.key} className={g.errors.length ? 'row-error' : ''}>
                <td className="small">{g.source}</td><td>{g.doc_no}</td><td>{g.party}</td><td className="nowrap">{fmtDate(g.date)}</td><td className="num">{g.items}</td><td className="num">{money(g.total_estimate)}</td>
                <td className="small">
                  {g.errors.length ? g.errors.map((e, i) => <div key={i} className="text-danger">✗ {e}</div>) : <span className="text-success">✓ OK</span>}
                  {g.warnings.map((w, i) => <div key={i} className="text-warn">! {w}</div>)}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="card">
          <h3>✓ {result.created.length} {(result.created.length === 1 ? cfg.label : cfg.plural).toLowerCase()} created</h3>
          <p className="muted">{result.partiesCreated} new {cfg.party.toLowerCase()}(s) · {result.productsCreated} new inventory item(s){result.failed.length ? ` · ${result.failed.length} skipped` : ''}</p>
          <div className="page-actions" style={{ justifyContent: 'flex-start', margin: '12px 0' }}>
            <Link className="btn btn-primary" to={`${cfg.path}?batch_id=${result.batchId}`}>Open these {cfg.plural.toLowerCase()} (send WhatsApp / email in bulk)</Link>
            <button className="btn" onClick={reset}>Upload another file</button>
          </div>
          {result.failed.length > 0 && (
            <div className="alert alert-error small">{result.failed.map((f, i) => <div key={i}><b>{f.source}</b>: {f.errors.join('; ')}</div>)}</div>
          )}
          <div className="table-wrap"><table className="table compact"><tbody>
            {result.created.map((c) => <tr key={c.id}><td><Link to={`${cfg.path}/${c.id}`}>{c.doc_no}</Link></td><td className="small muted">{c.source}</td><td className="num">{money(c.total)}</td></tr>)}
          </tbody></table></div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Upload history</h3></div>
        {!batches.data?.length ? <p className="muted small">No uploads yet.</p> : (
          <div className="table-wrap"><table className="table compact"><thead><tr><th>#</th><th>Type</th><th>File(s)</th><th>When</th><th>By</th><th className="num">Created</th><th></th></tr></thead><tbody>
            {batches.data.map((b) => (
              <tr key={b.id}><td>{b.id}</td><td>{DOCS[b.doc_type]?.plural}</td><td className="small">{b.file_name}</td><td className="small nowrap">{new Date(b.created_at + 'Z').toLocaleString('en-IN')}</td><td>{b.user_name}</td>
                <td className="num">{b.docs_created}{b.errors.length ? <span className="text-danger small"> ({b.errors.length} skipped)</span> : ''}</td>
                <td><Link className="small" to={`${DOCS[b.doc_type]?.path}?batch_id=${b.id}`}>View</Link></td></tr>
            ))}
          </tbody></table></div>
        )}
      </div>
    </>
  );
}
