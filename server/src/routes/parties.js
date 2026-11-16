// Customers and vendors share the same shape
const express = require('express');
const { db } = require('../db');
const { stateCodeFor } = require('../services/util');

const FIELDS = ['code', 'name', 'contact_person', 'email', 'phone', 'gstin', 'address', 'city', 'state', 'pincode', 'payment_terms'];

function partyRouter(table) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    const q = `%${req.query.q || ''}%`;
    const extra = table === 'customers'
      ? `, (SELECT COUNT(*) FROM invoices i WHERE i.party_id = t.id AND i.status <> 'cancelled') AS invoice_count,
           (SELECT COALESCE(SUM(total - amount_paid),0) FROM invoices i WHERE i.party_id = t.id AND i.status IN ('unpaid','partially_paid')) AS outstanding`
      : `, (SELECT COUNT(*) FROM purchase_orders p WHERE p.party_id = t.id) AS po_count`;
    res.json(await db.prepare(`SELECT t.* ${extra} FROM ${table} t WHERE t.company_id = ?
      AND (t.name LIKE ? OR IFNULL(t.email,'') LIKE ? OR IFNULL(t.phone,'') LIKE ? OR IFNULL(t.gstin,'') LIKE ? OR IFNULL(t.code,'') LIKE ?) ORDER BY t.name`)
      .all(req.companyId, q, q, q, q, q));
  });
  router.get('/:id', async (req, res) => {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(req.params.id, req.companyId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
  router.post('/', async (req, res) => {
    const d = req.body || {};
    if (!d.name) return res.status(400).json({ error: 'Name is required' });
    const r = await db.prepare(`INSERT INTO ${table} (company_id, ${FIELDS.join(',')}, state_code) VALUES (?, ${FIELDS.map(() => '?').join(',')}, ?)`)
      .run(req.companyId, ...FIELDS.map((f) => d[f] || null), stateCodeFor(d.state, d.gstin));
    res.json(await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.lastInsertRowid));
  });
  router.put('/:id', async (req, res) => {
    const d = req.body || {};
    if (!d.name) return res.status(400).json({ error: 'Name is required' });
    const r = await db.prepare(`UPDATE ${table} SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, state_code = ? WHERE id = ? AND company_id = ?`)
      .run(...FIELDS.map((f) => d[f] || null), stateCodeFor(d.state, d.gstin), req.params.id, req.companyId);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json(await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id));
  });
  router.delete('/:id', async (req, res) => {
    const used = table === 'customers'
      ? await db.prepare('SELECT 1 FROM invoices WHERE party_id = ? UNION SELECT 1 FROM quotations WHERE party_id = ?').get(req.params.id, req.params.id)
      : await db.prepare('SELECT 1 FROM purchase_orders WHERE party_id = ?').get(req.params.id);
    if (used) return res.status(400).json({ error: `Cannot delete: this ${table === 'customers' ? 'customer has invoices or quotations' : 'vendor has purchase orders'}` });
    await db.prepare(`DELETE FROM ${table} WHERE id = ? AND company_id = ?`).run(req.params.id, req.companyId);
    res.json({ ok: true });
  });
  return router;
}

module.exports = partyRouter;