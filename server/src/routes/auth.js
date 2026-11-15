const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, company_id: u.company_id });

router.post('/register', (req, res) => {
  const { name, email, password, company_name } = req.body || {};
  if (!name || !email || !password || !company_name) return res.status(400).json({ error: 'Name, company, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const normalized = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.transaction(() => {
    const c = db.prepare(`INSERT INTO companies (name, email, invoice_terms) VALUES (?, ?, ?)`).run(
      company_name, normalized, '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged on overdue payments.\n3. Subject to local jurisdiction.');
    const u = db.prepare('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)')
      .run(c.lastInsertRowid, name, normalized, bcrypt.hashSync(password, 10), 'admin');
    return db.prepare('SELECT * FROM users WHERE id = ?').get(u.lastInsertRowid);
  })();
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const company = db.prepare('SELECT id, name, logo_path, currency, gstin FROM companies WHERE id = ?').get(req.companyId);
  res.json({ user: req.user, company });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current_password || ''), u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (String(new_password || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), u.id);
  res.json({ ok: true });
});

// Team members (same company)
router.get('/users', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users WHERE company_id = ? ORDER BY id').all(req.companyId));
});
router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const normalized = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) return res.status(409).json({ error: 'Email already in use' });
  const r = db.prepare('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)')
    .run(req.companyId, name, normalized, bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'staff');
  res.json({ id: r.lastInsertRowid });
});
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot remove yourself' });
  db.prepare('DELETE FROM users WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

module.exports = router;
