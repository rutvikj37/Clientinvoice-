import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Field, PageHead, useToast, useLoad } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const TABS = [['profile', 'Company profile'], ['documents', 'Numbering & terms'], ['bank', 'Bank details'], ['email', 'Email (SMTP)'], ['whatsapp', 'WhatsApp'], ['team', 'Team'], ['account', 'My account']];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'profile';
  const toast = useToast();
  const { refresh, user } = useAuth();
  const [c, setC] = useState(null);
  const [states, setStates] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/company').then(setC); api.get('/company/states').then(setStates); }, []);
  if (!c) return <p className="muted">Loading…</p>;
  const isAdmin = user.role === 'admin';
  const set = (k) => (e) => setC({ ...c, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = async () => {
    setSaving(true);
    try { const r = await api.put('/company', c); setC(r); toast('Settings saved'); refresh(); } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const uploadLogo = async (file) => {
    const fd = new FormData(); fd.append('logo', file);
    try { const r = await api.upload('/company/logo', fd); setC({ ...c, logo_path: r.logo_path }); toast('Logo uploaded'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const SaveBtn = () => isAdmin && <div className="save-row"><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div>;

  return (
    <>
      <PageHead title="Company settings" sub={params.get('welcome') ? 'Welcome! Add your company details: they appear on every invoice, quotation and PO.' : 'Details printed on your documents'} />
      {!isAdmin && <div className="alert alert-info">Only admins can change company settings.</div>}
      <div className="settings">
        <nav className="settings-nav">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k })}>{l}</button>)}</nav>
        <div className="card settings-body">
          {tab === 'profile' && (<>
            <div className="logo-row">
              {c.logo_path ? <img src={`/api/uploads/${c.logo_path}`} alt="Company logo" className="logo-preview" /> : <div className="logo-preview empty">No logo</div>}
              <label className="btn">Upload logo<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files[0] && uploadLogo(e.target.files[0])} /></label>
              <span className="muted small">PNG or JPG, shown top-right on every document</span>
            </div>
            <div className="form-grid cols-3">
              <Field label="Short name *"><input value={c.name || ''} onChange={set('name')} /></Field>
              <Field label="Legal name (printed on documents)" span={2}><input value={c.legal_name || ''} onChange={set('legal_name')} placeholder="MOTIONCREST HYDRAULICS PRIVATE LIMITED" /></Field>
              <Field label="GST No."><input value={c.gstin || ''} onChange={set('gstin')} maxLength={15} /></Field>
              <Field label="PAN"><input value={c.pan || ''} onChange={set('pan')} maxLength={10} /></Field>
              <Field label="State" hint={c.gstin ? `State code from GST No.: ${c.gstin.slice(0, 2)}` : null}><select value={c.state || ''} onChange={set('state')}><option value="">Select…</option>{states.map((s) => <option key={s.code} value={s.name}>{s.code} · {s.name}</option>)}</select></Field>
              <Field label="Address" span={3}><input value={c.address || ''} onChange={set('address')} /></Field>
              <Field label="City"><input value={c.city || ''} onChange={set('city')} /></Field>
              <Field label="Pincode"><input value={c.pincode || ''} onChange={set('pincode')} /></Field>
              <Field label="Phone"><input value={c.phone || ''} onChange={set('phone')} /></Field>
              <Field label="Email"><input value={c.email || ''} onChange={set('email')} /></Field>
              <Field label="Website"><input value={c.website || ''} onChange={set('website')} /></Field>
              <Field label="Tagline (document footer)"><input value={c.tagline || ''} onChange={set('tagline')} /></Field>
            </div>
            <SaveBtn />
          </>)}
          {tab === 'documents' && (<>
            <p className="muted small">Document numbers are assigned automatically from these prefixes — use <code>{'{FY}'}</code> for the financial year (e.g. 2026-27). Numbering restarts at 001 every April when the FY changes.</p>
            <div className="form-grid cols-3">
              <Field label="Invoice prefix" hint={`Next: ${c.next_numbers?.invoice}`}><input value={c.invoice_prefix || ''} onChange={set('invoice_prefix')} /></Field>
              <Field label="Quotation prefix" hint={`Next: ${c.next_numbers?.quotation}`}><input value={c.quote_prefix || ''} onChange={set('quote_prefix')} /></Field>
              <Field label="PO prefix" hint={`Next: ${c.next_numbers?.po}`}><input value={c.po_prefix || ''} onChange={set('po_prefix')} /></Field>
              <Field label="Number digits"><input type="number" min="1" max="8" value={c.number_padding || 3} onChange={set('number_padding')} /></Field>
              <Field label="Invoice due in (days)"><input type="number" value={c.default_due_days ?? 15} onChange={set('default_due_days')} /></Field>
              <Field label="Quotation valid for (days)"><input type="number" value={c.quote_validity_days ?? 15} onChange={set('quote_validity_days')} /></Field>
              <Field label="Default payment terms"><input value={c.default_payment_terms || ''} onChange={set('default_payment_terms')} placeholder="Against PI" /></Field>
              <Field label="Default transport"><input value={c.default_transport || ''} onChange={set('default_transport')} placeholder="By Road" /></Field>
              <Field label="Place of supply"><input value={c.default_place_of_supply || ''} onChange={set('default_place_of_supply')} placeholder="Ex- Works Jaipur" /></Field>
              <Field label="Invoice general conditions" span={3} hint="One per line"><textarea rows={3} value={c.invoice_terms || ''} onChange={set('invoice_terms')} /></Field>
              <Field label="Quotation general conditions" span={3}><textarea rows={3} value={c.quote_terms || ''} onChange={set('quote_terms')} /></Field>
              <Field label="PO general conditions" span={3}><textarea rows={3} value={c.po_terms || ''} onChange={set('po_terms')} /></Field>
            </div>
            <label className="check-row"><input type="checkbox" checked={!!c.po_approval_required} onChange={set('po_approval_required')} /> Purchase orders need admin approval before they can be sent</label>

            {isAdmin && (
              <div className="seq-reset-box">
                <h4>Reset number sequence</h4>
                <p className="muted small">
                  Use this when going live so the next document starts from <code>…/001</code>.
                  Existing documents keep their numbers. If <code>001</code> already exists, the next free number is used — delete test documents first if you need a clean <code>001</code>.
                </p>
                <div className="seq-reset-actions">
                  {[
                    ['invoice', 'Invoices', c.next_numbers?.invoice],
                    ['quotation', 'Quotations', c.next_numbers?.quotation],
                    ['po', 'Purchase orders', c.next_numbers?.po],
                  ].map(([kind, label, next]) => (
                    <div key={kind} className="seq-reset-row">
                      <div>
                        <b>{label}</b>
                        <div className="muted small">Next would be {next || '—'}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={saving}
                        onClick={async () => {
                          if (!confirm(`Reset ${label.toLowerCase()} sequence to start from 001?\n\nNext new document will use the first free number from 001.`)) return;
                          setSaving(true);
                          try {
                            const r = await api.post('/company/reset-sequence', { kind });
                            setC(r.company);
                            toast(`${label} sequence reset. Next: ${r.next}`);
                            refresh();
                          } catch (e) { toast(e.message, 'error'); }
                          finally { setSaving(false); }
                        }}
                      >
                        Reset to 001
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <SaveBtn />
          </>)}
          {tab === 'bank' && (<>
            <p className="muted small">Printed on invoices so customers know where to pay.</p>
            <div className="form-grid">
              <Field label="Bank name"><input value={c.bank_name || ''} onChange={set('bank_name')} /></Field>
              <Field label="Branch"><input value={c.bank_branch || ''} onChange={set('bank_branch')} /></Field>
              <Field label="Account number"><input value={c.bank_account || ''} onChange={set('bank_account')} /></Field>
              <Field label="IFSC"><input value={c.bank_ifsc || ''} onChange={set('bank_ifsc')} /></Field>
              <Field label="UPI ID"><input value={c.upi_id || ''} onChange={set('upi_id')} /></Field>
            </div>
            <SaveBtn />
          </>)}
          {tab === 'email' && (<>
            <p className="muted small">Documents are emailed from your own mailbox with the PDF attached. For Gmail, use smtp.gmail.com, port 465 (secure) and an App Password.</p>
            <div className="form-grid">
              <Field label="SMTP host"><input value={c.smtp_host || ''} onChange={set('smtp_host')} placeholder="smtp.gmail.com" /></Field>
              <Field label="Port"><input type="number" value={c.smtp_port || ''} onChange={set('smtp_port')} placeholder="465" /></Field>
              <Field label="Username"><input value={c.smtp_user || ''} onChange={set('smtp_user')} autoComplete="off" /></Field>
              <Field label="Password / App password"><input type="password" value={c.smtp_pass || ''} onChange={set('smtp_pass')} autoComplete="new-password" /></Field>
              <Field label="From address"><input value={c.smtp_from || ''} onChange={set('smtp_from')} placeholder="accounts@yourcompany.com" /></Field>
              <label className="check-row"><input type="checkbox" checked={!!c.smtp_secure} onChange={set('smtp_secure')} /> Use SSL (port 465)</label>
              <Field label="Invoice email subject" span={2}><input value={c.email_subject_template || ''} onChange={set('email_subject_template')} placeholder={c.defaults.email_subject_template} /></Field>
              <Field label="Invoice email message" span={2} hint="Placeholders: {{party_name}} {{doc_no}} {{doc_date}} {{due_date}} {{amount}} {{balance}} {{link}} {{company_name}}"><textarea rows={7} value={c.email_body_template || ''} onChange={set('email_body_template')} placeholder={c.defaults.email_body_template} /></Field>
            </div>
            <SaveBtn />
          </>)}
          {tab === 'whatsapp' && (<>
            <div className={`alert ${c.whatsapp_api_enabled ? 'alert-success' : 'alert-info'}`}>
              {c.whatsapp_api_enabled
                ? 'WhatsApp Business API is connected: PDFs are delivered directly to the customer.'
                : <>Works now without setup: the WhatsApp button opens WhatsApp (web or phone) with a ready message and a secure PDF link, so you just press send.<br />To send PDFs automatically (and in bulk without clicking), connect the <b>WhatsApp Business Cloud API</b> from Meta below.</>}
            </div>
            <div className="form-grid">
              <Field label="Phone number ID" hint="Meta Business → WhatsApp → API setup"><input value={c.wa_phone_number_id || ''} onChange={set('wa_phone_number_id')} /></Field>
              <Field label="Permanent access token"><input type="password" value={c.wa_access_token || ''} onChange={set('wa_access_token')} autoComplete="new-password" /></Field>
              <Field label="Invoice WhatsApp message" span={2} hint="Placeholders: {{party_name}} {{doc_no}} {{amount}} {{due_date}} {{link}} {{company_name}}"><textarea rows={5} value={c.whatsapp_template || ''} onChange={set('whatsapp_template')} placeholder={c.defaults.whatsapp_template} /></Field>
            </div>
            <SaveBtn />
          </>)}
          {tab === 'team' && <Team isAdmin={isAdmin} />}
          {tab === 'account' && <Account />}
        </div>
      </div>
    </>
  );
}

function Team({ isAdmin }) {
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get('/auth/users'));
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff' });
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/auth/users', f); toast('User added'); setF({ name: '', email: '', password: '', role: 'staff' }); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  return (<>
    <p className="muted small">Admins can approve purchase orders and change settings. Staff can create and send documents.</p>
    <div className="table-wrap"><table className="table compact"><tbody>
      {data?.map((u) => <tr key={u.id}><td><b>{u.name}</b><div className="muted small">{u.email}</div></td><td>{u.role}</td>
        <td className="num">{isAdmin && <button className="btn btn-sm btn-danger-ghost" onClick={async () => { if (confirm(`Remove ${u.name}?`)) { try { await api.del(`/auth/users/${u.id}`); reload(); } catch (e) { toast(e.message, 'error'); } } }}>Remove</button>}</td></tr>)}
    </tbody></table></div>
    {isAdmin && <form onSubmit={add} className="form-grid cols-3" style={{ marginTop: 16 }}>
      <Field label="Name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Email"><input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Temporary password"><input required minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="staff">Staff</option><option value="admin">Admin</option></select></Field>
      <div className="field"><span className="field-label">&nbsp;</span><button className="btn btn-primary">Add user</button></div>
    </form>}
  </>);
}

function Account() {
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '' });
  const save = async (e) => {
    e.preventDefault();
    try { await api.post('/auth/change-password', f); toast('Password changed'); setF({ current_password: '', new_password: '' }); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <form onSubmit={save} className="form-grid" style={{ maxWidth: 520 }}>
      <Field label="Current password"><input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
      <Field label="New password"><input type="password" required minLength={6} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
      <div><button className="btn btn-primary">Change password</button></div>
    </form>
  );
}
