import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login({ register }) {
  const { login, register: doRegister } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', company_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (register) { await doRegister(f); nav('/settings?welcome=1'); }
      else { await login(f.email, f.password); nav('/'); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="auth-brand">FactoryBill</div>
        <h2>Invoicing, purchase orders and stock for manufacturers.</h2>
        <ul>
          <li>GST invoices with CGST / SGST / IGST</li>
          <li>Send invoices on WhatsApp and email</li>
          <li>Upload Excel and generate invoices in bulk</li>
          <li>Purchase order approval and goods receipt flow</li>
          <li>Live inventory with low-stock alerts</li>
        </ul>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h1>{register ? 'Create your account' : 'Sign in'}</h1>
        <p className="muted">{register ? 'Set up your company in a minute.' : 'Welcome back. Enter your email and password.'}</p>
        {error && <div className="alert alert-error">{error}</div>}
        {register && (
          <>
            <label className="field"><span className="field-label">Your name</span><input required value={f.name} onChange={set('name')} /></label>
            <label className="field"><span className="field-label">Company name</span><input required value={f.company_name} onChange={set('company_name')} /></label>
          </>
        )}
        <label className="field"><span className="field-label">Email</span><input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="field"><span className="field-label">Password</span><input type="password" required minLength={6} autoComplete={register ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} /></label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
        <p className="muted center">
          {register ? <>Already have an account? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/register">Create an account</Link></>}
        </p>
      </form>
    </div>
  );
}
