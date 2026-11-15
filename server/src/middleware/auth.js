const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

function signToken(user) {
  return jwt.sign({ uid: user.id, cid: user.company_id }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, company_id, name, email, role FROM users WHERE id = ?').get(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.companyId = user.company_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do this' });
  next();
}

// Short-lived signed links so customers can open an invoice PDF from WhatsApp/email without logging in
function signPublicLink(kind, id, companyId) {
  return jwt.sign({ k: kind, id, cid: companyId }, JWT_SECRET, { expiresIn: '90d' });
}
function verifyPublicLink(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, requireAuth, requireAdmin, signPublicLink, verifyPublicLink, JWT_SECRET };
