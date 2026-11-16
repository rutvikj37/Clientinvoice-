import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(f.email, f.password); nav('/');
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
        <h1>Sign in</h1>
        <p className="muted">Welcome back. Enter your email and password.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <label className="field"><span className="field-label">Email</span><input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="field"><span className="field-label">Password</span><input type="password" required minLength={6} autoComplete="current-password" value={f.password} onChange={set('password')} /></label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
