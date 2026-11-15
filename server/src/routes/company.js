const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const { db, DATA_DIR } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { stateCodeFor, STATES } = require('../services/util');
const { DEFAULT_SUBJECT, DEFAULT_BODY, DEFAULT_WA, waConfigured } = require('../services/messaging');
const { nextDocNo } = require('../services/documents');

const FIELDS = ['name', 'legal_name', 'gstin', 'pan', 'address', 'city', 'state', 'pincode', 'country', 'phone', 'email', 'website', 'tagline',
  'bank_name', 'bank_account', 'bank_ifsc', 'bank_branch', 'upi_id', 'currency',
  'invoice_prefix', 'quote_prefix', 'po_prefix', 'number_padding', 'default_due_days', 'quote_validity_days',
  'default_payment_terms', 'default_transport', 'default_place_of_supply', 'invoice_terms', 'quote_terms', 'po_terms', 'po_approval_required',
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'wa_phone_number_id', 'wa_access_token',
  'email_subject_template', 'email_body_template', 'whatsapp_template'];

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'uploads'),
    filename: (req, file, cb) => cb(null, `logo-${req.companyId}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image\/(png|jpe?g)/.test(file.mimetype)),
});

function present(c) {
  return {
    ...c,
    smtp_pass: c.smtp_pass ? '********' : '',
    wa_access_token: c.wa_access_token ? '********' : '',
    whatsapp_api_enabled: waConfigured(c),
    next_numbers: { invoice: nextDocNo(c.id, 'invoice'), quotation: nextDocNo(c.id, 'quotation'), po: nextDocNo(c.id, 'po') },
    defaults: { email_subject_template: DEFAULT_SUBJECT, email_body_template: DEFAULT_BODY, whatsapp_template: DEFAULT_WA },
  };
}

router.get('/', (req, res) => {
  res.json(present(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId)));
});

router.get('/states', (req, res) => res.json(Object.entries(STATES).map(([code, name]) => ({ code, name }))));

router.put('/', requireAdmin, (req, res) => {
  const data = req.body || {};
  const sets = [], vals = [];
  for (const f of FIELDS) {
    if (!(f in data)) continue;
    if ((f === 'smtp_pass' || f === 'wa_access_token') && data[f] === '********') continue; // unchanged secret
    sets.push(`${f} = ?`);
    vals.push(data[f] === '' ? null : data[f]);
  }
  if (!data.name && 'name' in data) return res.status(400).json({ error: 'Company name is required' });
  if (sets.length) db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.companyId);
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId);
  db.prepare('UPDATE companies SET state_code = ? WHERE id = ?').run(stateCodeFor(c.state, c.gstin), req.companyId);
  res.json(present(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId)));
});

router.post('/logo', requireAdmin, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PNG or JPG image under 2MB' });
  db.prepare('UPDATE companies SET logo_path = ? WHERE id = ?').run(req.file.filename, req.companyId);
  res.json({ logo_path: req.file.filename });
});

module.exports = router;
