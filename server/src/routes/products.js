const router = require('express').Router();
const { db } = require('../db');
const { moveStock } = require('../services/inventory');
const { HttpError } = require('../services/util');

const FIELDS = ['sku', 'name', 'description', 'category', 'hsn', 'unit', 'type', 'sale_price', 'purchase_price', 'tax_rate', 'reorder_level', 'location', 'is_active'];

router.get('/', async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  let where = 'company_id = ? AND (name LIKE ? OR IFNULL(sku,\'\') LIKE ? OR IFNULL(category,\'\') LIKE ? OR IFNULL(hsn,\'\') LIKE ?)';
  const params = [req.companyId, q, q, q, q];
  if (req.query.low === '1') where += ' AND stock_qty <= reorder_level';
  if (req.query.type) { where += ' AND type = ?'; params.push(req.query.type); }
  if (req.query.active === '1') where += ' AND is_active = 1';
  res.json(await db.prepare(`SELECT *, stock_qty * purchase_price AS stock_value FROM products WHERE ${where} ORDER BY name`).all(...params));
});

router.get('/summary', async (req, res) => {
  res.json(await db.prepare(`SELECT COUNT(*) AS items, COALESCE(SUM(stock_qty * purchase_price),0) AS stock_value,
    SUM(CASE WHEN stock_qty <= reorder_level THEN 1 ELSE 0 END) AS low_stock,
    SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) AS out_of_stock
    FROM products WHERE company_id = ? AND is_active = 1`).get(req.companyId));
});

router.get('/movements', async (req, res) => {
  const params = [req.companyId];
  let where = 'm.company_id = ?';
  if (req.query.product_id) { where += ' AND m.product_id = ?'; params.push(req.query.product_id); }
  res.json(await db.prepare(`SELECT m.*, p.name AS product_name, p.sku, p.unit, u.name AS user_name FROM stock_movements m
    JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
    WHERE ${where} ORDER BY m.id DESC LIMIT 500`).all(...params));
});

router.get('/:id', async (req, res) => {
  const p = await db.prepare('SELECT * FROM products WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

function clean(d) {
  const out = {};
  for (const f of FIELDS) out[f] = d[f] === '' || d[f] === undefined ? null : d[f];
  if (out.is_active === null) out.is_active = 1;
  if (!out.unit) out.unit = 'Nos';
  if (!out.type) out.type = 'finished';
  return out;
}

router.post('/', async (req, res) => {
  const d = clean(req.body || {});
  if (!d.name) throw new HttpError(400, 'Product name is required');
  try {
    const id = await db.transaction(async () => {
      const r = await db.prepare(`INSERT INTO products (company_id, ${FIELDS.join(',')}) VALUES (?, ${FIELDS.map(() => '?').join(',')})`)
        .run(req.companyId, ...FIELDS.map((f) => d[f]));
      const opening = Number(req.body.opening_stock || 0);
      if (opening) await moveStock({ companyId: req.companyId, productId: r.lastInsertRowid, qty: opening, type: 'IN', refType: 'opening', note: 'Opening stock', userId: req.user.id });
      return r.lastInsertRowid;
    });
    res.json(await db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (e) {
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('Duplicate')) throw new HttpError(409, `SKU "${d.sku}" already exists`);
    throw e;
  }
});

router.put('/:id', async (req, res) => {
  const d = clean(req.body || {});
  if (!d.name) throw new HttpError(400, 'Product name is required');
  try {
    const r = await db.prepare(`UPDATE products SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`)
      .run(...FIELDS.map((f) => d[f]), req.params.id, req.companyId);
    if (!r.changes) throw new HttpError(404, 'Product not found');
  } catch (e) {
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('Duplicate')) throw new HttpError(409, `SKU "${d.sku}" already exists`);
    throw e;
  }
  res.json(await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const used = await db.prepare('SELECT 1 FROM invoice_items WHERE product_id = ? UNION SELECT 1 FROM po_items WHERE product_id = ?').get(req.params.id, req.params.id);
  if (used) {
    await db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
    return res.json({ ok: true, archived: true });
  }
  await db.prepare('DELETE FROM products WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// Stock in / out / set-to (physical count)
router.post('/:id/adjust', async (req, res) => {
  const { mode, qty, note } = req.body || {};
  const p = await db.prepare('SELECT * FROM products WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!p) throw new HttpError(404, 'Product not found');
  const n = Number(qty);
  if (!Number.isFinite(n) || (mode !== 'set' && n <= 0)) throw new HttpError(400, 'Enter a valid quantity');
  let change, type;
  if (mode === 'in') { change = n; type = 'IN'; }
  else if (mode === 'out') { change = -n; type = 'OUT'; }
  else if (mode === 'set') { change = n - p.stock_qty; type = 'ADJUST'; }
  else throw new HttpError(400, 'mode must be in, out or set');
  const balance = await db.transaction(async () => moveStock({ companyId: req.companyId, productId: p.id, qty: change, type, refType: 'manual', note, userId: req.user.id }));
  res.json({ ok: true, stock_qty: balance });
});

module.exports = router;