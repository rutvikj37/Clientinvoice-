import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

export default function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '', name: '', company_name: '' });
  // While no account exists yet, this page creates the first admin instead of signing in.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => { api.get('/auth/registration').then((r) => setFirstRun(!!r.open)).catch(() => {}); }, []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (firstRun) await register(f); else await login(f.email, f.password);
      nav('/');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="auth-brand">
          <img src="/logo.jpg" alt="MotionCrest Hydraulics" />
        </div>
        <p className="auth-tagline">Rising to power. Moving the world.</p>
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
        <div className="auth-card-brand">
          <img src="/logo.jpg" alt="MotionCrest Hydraulics" />
        </div>
        <h1>{firstRun ? 'Create admin account' : 'Sign in'}</h1>
        <p className="muted">{firstRun ? 'No account exists yet. The first account becomes the admin; add your team later from Settings → Team.' : 'Welcome back. Enter your email and password.'}</p>
        {error && <div className="alert alert-error">{error}</div>}
        {firstRun && <label className="field"><span className="field-label">Your name</span><input required autoComplete="name" value={f.name} onChange={set('name')} /></label>}
        {firstRun && <label className="field"><span className="field-label">Company name</span><input required autoComplete="organization" value={f.company_name} onChange={set('company_name')} /></label>}
        <label className="field"><span className="field-label">Email</span><input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="field"><span className="field-label">Password</span><input type="password" required minLength={6} autoComplete={firstRun ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} /></label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : firstRun ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}
