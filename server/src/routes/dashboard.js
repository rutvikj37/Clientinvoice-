const router = require('express').Router();
const { db } = require('../db');
const { today } = require('../services/util');

router.get('/', async (req, res) => {
  const cid = req.companyId;
  const t = today();
  const monthStart = t.slice(0, 8) + '01';
  const sales = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN doc_date >= ? AND status <> 'draft' THEN total END),0) AS month_sales,
      COALESCE(SUM(CASE WHEN status IN ('unpaid','partially_paid') THEN total - amount_paid END),0) AS outstanding,
      COALESCE(SUM(CASE WHEN status IN ('unpaid','partially_paid') AND due_date < ? THEN total - amount_paid END),0) AS overdue,
      SUM(CASE WHEN status IN ('unpaid','partially_paid') AND due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts
    FROM invoices WHERE company_id = ? AND status <> 'cancelled'`).get(monthStart, t, t, cid);
  const received = (await db.prepare(`SELECT COALESCE(SUM(p.amount),0) AS v FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.company_id = ? AND p.paid_on >= ?`).get(cid, monthStart)).v;
  const monthly = await db.prepare(`SELECT SUBSTRING(doc_date,1,7) AS month, ROUND(SUM(total),2) AS sales, ROUND(SUM(amount_paid),2) AS collected
    FROM invoices WHERE company_id = ? AND status NOT IN ('cancelled','draft') AND doc_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
    GROUP BY month ORDER BY month`).all(cid);
  const topCustomers = await db.prepare(`SELECT c.name, ROUND(SUM(i.total),2) AS total FROM invoices i JOIN customers c ON c.id = i.party_id
    WHERE i.company_id = ? AND i.status NOT IN ('cancelled','draft') GROUP BY c.id ORDER BY total DESC LIMIT 5`).all(cid);
  const recent = await db.prepare(`SELECT i.id, i.doc_no, i.doc_date, i.total, i.status, i.due_date, c.name AS party_name
    FROM invoices i JOIN customers c ON c.id = i.party_id WHERE i.company_id = ? ORDER BY i.id DESC LIMIT 6`).all(cid);
  const lowStock = await db.prepare(`SELECT id, name, sku, stock_qty, reorder_level, unit FROM products
    WHERE company_id = ? AND is_active = 1 AND stock_qty <= reorder_level ORDER BY stock_qty - reorder_level LIMIT 8`).all(cid);
  const po = await db.prepare(`SELECT
      SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_approval,
      SUM(CASE WHEN status IN ('approved','sent','partially_received') THEN 1 ELSE 0 END) AS open,
      COALESCE(SUM(CASE WHEN status IN ('approved','sent','partially_received') THEN total END),0) AS open_value
    FROM purchase_orders WHERE company_id = ?`).get(cid);
  const quotes = await db.prepare(`SELECT
      SUM(CASE WHEN status IN ('draft','sent') THEN 1 ELSE 0 END) AS open,
      COALESCE(SUM(CASE WHEN status IN ('draft','sent','accepted') THEN total END),0) AS open_value,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted
    FROM quotations WHERE company_id = ?`).get(cid);
  res.json({ sales: { ...sales, received_this_month: received }, monthly, topCustomers, recent, lowStock, po, quotes });
});

module.exports = router;