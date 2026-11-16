const express = require('express');
const ExcelJS = require('exceljs');
const { db, logActivity } = require('../db');
const { createDoc, updateDoc, getDoc, listDocs } = require('../services/documents');
const { applyInvoiceStock } = require('../services/inventory');
const { shareInfo, sendEmail, sendWhatsApp, sendPdf, zipPdfs } = require('./docShared');
const { today, round2, HttpError } = require('../services/util');

const router = express.Router();
// mounted first so '/bulk/email' is not captured by '/:id/email'
const bulkRouter = express.Router();
router.use('/bulk', bulkRouter);

async function mustGet(req, id = req.params.id) {
  const inv = await getDoc('invoice', req.companyId, id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  inv.payments = await db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_on, id').all(inv.id);
  inv.balance = Math.max(0, round2(inv.total - inv.amount_paid));
  inv.is_overdue = ['unpaid', 'partially_paid'].includes(inv.status) && inv.due_date && inv.due_date < today();
  return inv;
}

async function list(req) {
  const { status } = req.query;
  const extra = status === 'overdue' ? " AND d.status IN ('unpaid','partially_paid') AND d.due_date < ?" : '';
  const rows = await listDocs('invoice', req.companyId, { ...req.query, status: status === 'overdue' ? '' : status }, extra, status === 'overdue' ? [today()] : []);
  const t = today();
  return rows.map((r) => ({ ...r, balance: round2(r.total - r.amount_paid), is_overdue: ['unpaid', 'partially_paid'].includes(r.status) && r.due_date && r.due_date < t }));
}

router.get('/', async (req, res) => res.json(await list(req)));

router.get('/export', async (req, res) => {
  const rows = await list(req);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoices');
  ws.columns = [
    { header: 'Invoice No', key: 'doc_no', width: 18 }, { header: 'Date', key: 'doc_date', width: 12 }, { header: 'Due Date', key: 'due_date', width: 12 },
    { header: 'Customer Code', key: 'party_code', width: 14 }, { header: 'Customer', key: 'party_name', width: 30 }, { header: 'Status', key: 'status', width: 14 },
    { header: 'Taxable', key: 'taxable_total', width: 14 }, { header: 'CGST', key: 'cgst', width: 12 }, { header: 'SGST', key: 'sgst', width: 12 },
    { header: 'IGST', key: 'igst', width: 12 }, { header: 'Total', key: 'total', width: 14 }, { header: 'Paid', key: 'amount_paid', width: 14 }, { header: 'Balance', key: 'balance', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="invoices-${today()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

router.get('/:id', async (req, res) => res.json(await mustGet(req)));

router.post('/', async (req, res) => {
  const inv = await db.transaction(async () => {
    const d = await createDoc('invoice', req.companyId, req.user, req.body || {});
    if (d.status !== 'draft') await applyInvoiceStock(d, -1, req.user.id);
    return d;
  });
  res.json(await mustGet(req, inv.id));
});

router.put('/:id', async (req, res) => {
  await db.transaction(async () => {
    const before = await db.prepare('SELECT * FROM invoices WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
    const updated = await updateDoc('invoice', req.companyId, req.user, req.params.id, req.body || {}, {
      beforeSave: async (doc) => { if (doc.stock_applied) await applyInvoiceStock(doc, +1, req.user.id); },
    });
    let status = updated.status;
    if (before.status === 'draft' && req.body.status !== 'draft') { status = 'unpaid'; await db.prepare("UPDATE invoices SET status = 'unpaid' WHERE id = ?").run(updated.id); }
    if (status !== 'draft') await applyInvoiceStock(updated, -1, req.user.id);
  });
  res.json(await mustGet(req));
});

router.delete('/:id', async (req, res) => {
  const inv = await mustGet(req);
  if (inv.status !== 'draft') throw new HttpError(400, 'Only draft invoices can be deleted. Cancel the invoice instead.');
  await db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  res.json({ ok: true });
});

// ---- Actions -------------------------------------------------------------
async function issue(req, inv) {
  if (inv.status !== 'draft') throw new HttpError(400, `${inv.doc_no} is already issued`);
  await db.transaction(async () => {
    await db.prepare("UPDATE invoices SET status = 'unpaid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(inv.id);
    await applyInvoiceStock(inv, -1, req.user.id);
    await logActivity(req.companyId, 'invoice', inv.id, 'issued', null, req.user.id);
  });
}

async function cancel(req, inv, reason) {
  if (inv.status === 'cancelled') return;
  if (inv.amount_paid > 0) throw new HttpError(400, `${inv.doc_no}: delete recorded payments before cancelling`);
  await db.transaction(async () => {
    if (inv.stock_applied) await applyInvoiceStock(inv, +1, req.user.id);
    await db.prepare("UPDATE invoices SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(inv.id);
    await logActivity(req.companyId, 'invoice', inv.id, 'cancelled', reason || null, req.user.id);
  });
}

async function refreshPaymentStatus(invoiceId) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  const paid = round2((await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM invoice_payments WHERE invoice_id = ?').get(invoiceId)).s);
  let status = inv.status;
  if (!['draft', 'cancelled'].includes(status)) status = paid <= 0 ? 'unpaid' : paid + 0.009 >= inv.total ? 'paid' : 'partially_paid';
  await db.prepare('UPDATE invoices SET amount_paid = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(paid, status, invoiceId);
}

async function addPayment(req, inv, { amount, paid_on, mode, reference }) {
  if (['draft', 'cancelled'].includes(inv.status)) throw new HttpError(400, `${inv.doc_no}: issue the invoice before recording payments`);
  const balance = round2(inv.total - inv.amount_paid);
  const amt = amount === undefined || amount === '' ? balance : round2(Number(amount));
  if (!(amt > 0)) throw new HttpError(400, `${inv.doc_no}: nothing left to pay`);
  if (amt > balance + 0.009) throw new HttpError(400, `Amount exceeds balance due (${balance})`);
  await db.transaction(async () => {
    await db.prepare('INSERT INTO invoice_payments (invoice_id, amount, paid_on, mode, reference) VALUES (?,?,?,?,?)')
      .run(inv.id, amt, paid_on || today(), mode || null, reference || null);
    await refreshPaymentStatus(inv.id);
    await logActivity(req.companyId, 'invoice', inv.id, 'payment', `${amt}${mode ? ' via ' + mode : ''}${reference ? ' (' + reference + ')' : ''}`, req.user.id);
  });
}

router.post('/:id/issue', async (req, res) => { await issue(req, await mustGet(req)); res.json(await mustGet(req)); });
router.post('/:id/cancel', async (req, res) => { await cancel(req, await mustGet(req), req.body?.reason); res.json(await mustGet(req)); });
router.post('/:id/payments', async (req, res) => { await addPayment(req, await mustGet(req), req.body || {}); res.json(await mustGet(req)); });
router.post('/:id/mark-paid', async (req, res) => { await addPayment(req, await mustGet(req), { mode: req.body?.mode || 'Other' }); res.json(await mustGet(req)); });
router.delete('/:id/payments/:pid', async (req, res) => {
  const inv = await mustGet(req);
  await db.transaction(async () => {
    await db.prepare('DELETE FROM invoice_payments WHERE id = ? AND invoice_id = ?').run(req.params.pid, inv.id);
    await refreshPaymentStatus(inv.id);
    await logActivity(req.companyId, 'invoice', inv.id, 'payment_deleted', null, req.user.id);
  });
  res.json(await mustGet(req));
});

const copyFields = (d) => ({
  party_id: d.party_id, place_of_supply: d.place_of_supply, contact_person: d.contact_person, contact_phone: d.contact_phone,
  contact_email: d.contact_email, payment_terms: d.payment_terms, transport: d.transport, reference: d.reference,
  remarks: d.remarks, shipping: d.shipping,
  items: d.items.map(({ product_id, item_code, description, hsn, unit, qty, rate, discount_pct, tax_rate }) => ({ product_id, item_code, description, hsn, unit, qty, rate, discount_pct, tax_rate })),
});

router.post('/:id/duplicate', async (req, res) => {
  const inv = await mustGet(req);
  const copy = await db.transaction(async () => createDoc('invoice', req.companyId, req.user, { ...copyFields(inv), status: 'draft', doc_date: today(), terms: inv.terms }));
  res.json(await mustGet(req, copy.id));
});

router.get('/:id/pdf', async (req, res) => sendPdf(req, res, 'invoice', await mustGet(req)));
router.get('/:id/share', async (req, res) => res.json(await shareInfo(req, 'invoice', await mustGet(req))));
router.post('/:id/email', async (req, res) => res.json(await sendEmail(req, 'invoice', await mustGet(req), req.body || {})));
router.post('/:id/whatsapp', async (req, res) => res.json(await sendWhatsApp(req, 'invoice', await mustGet(req), req.body || {})));

// ---- Bulk actions on selected invoices -------------------------------------
bulkRouter.post('/:action', async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Select at least one invoice');
  const { action } = req.params;
  if (action === 'download') {
    const docs = (await Promise.all(ids.map((id) => getDoc('invoice', req.companyId, id)))).filter(Boolean);
    return zipPdfs(req, res, 'invoice', docs, `invoices-${today()}.zip`);
  }
  const results = [];
  for (const id of ids) {
    const inv = await getDoc('invoice', req.companyId, id);
    if (!inv) continue;
    try {
      let extra = {};
      if (action === 'email') await sendEmail(req, 'invoice', inv);
      else if (action === 'whatsapp') extra = await sendWhatsApp(req, 'invoice', inv);
      else if (action === 'mark-paid') await addPayment(req, inv, { mode: req.body.mode || 'Other' });
      else if (action === 'issue') await issue(req, inv);
      else if (action === 'cancel') await cancel(req, inv);
      else if (action === 'delete') {
        if (inv.status !== 'draft') throw new HttpError(400, 'only drafts can be deleted');
        await db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
      } else throw new HttpError(400, `Unknown action ${action}`);
      results.push({ id, doc_no: inv.doc_no, party: inv.party?.name, ok: true, ...extra });
    } catch (e) {
      results.push({ id, doc_no: inv.doc_no, party: inv.party?.name, ok: false, error: e.message });
    }
  }
  res.json({ results, success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

module.exports = router;
module.exports.copyFields = copyFields;