const { db } = require('../db');
const { round2 } = require('./util');

/** Apply a signed stock change and record the movement. Call inside a transaction for multi-step ops. */
function moveStock({ companyId, productId, qty, type, refType, refId, note, userId }) {
  const p = db.prepare('SELECT id, stock_qty FROM products WHERE id = ? AND company_id = ?').get(productId, companyId);
  if (!p) return null;
  const balance = round2((p.stock_qty || 0) + qty);
  db.prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(balance, productId);
  db.prepare(`INSERT INTO stock_movements (company_id, product_id, type, qty, balance, ref_type, ref_id, note, user_id)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(companyId, productId, type, qty, balance, refType || null, refId || null, note || null, userId || null);
  return balance;
}

/** Deduct (direction=-1) or restore (direction=+1) stock for all product-linked invoice lines. */
function applyInvoiceStock(invoice, direction, userId) {
  const items = db.prepare('SELECT * FROM invoice_items WHERE doc_id = ? AND product_id IS NOT NULL').all(invoice.id);
  for (const it of items) {
    moveStock({
      companyId: invoice.company_id, productId: it.product_id, qty: direction * it.qty,
      type: direction < 0 ? 'OUT' : 'IN', refType: 'invoice', refId: invoice.id,
      note: `${direction < 0 ? 'Sold on' : 'Reversed from'} ${invoice.doc_no}`, userId,
    });
  }
  db.prepare('UPDATE invoices SET stock_applied = ? WHERE id = ?').run(direction < 0 ? 1 : 0, invoice.id);
}

module.exports = { moveStock, applyInvoiceStock };
