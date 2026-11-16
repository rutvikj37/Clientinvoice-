const express = require('express');
const { db, logActivity } = require('../db');
const { createDoc, updateDoc, getDoc, listDocs } = require('../services/documents');
const { applyInvoiceStock } = require('../services/inventory');
const { shareInfo, sendEmail, sendWhatsApp, sendPdf, zipPdfs } = require('./docShared');
const { today, HttpError } = require('../services/util');
const { copyFields } = require('./invoices');

/* Quotation flow: draft -> sent -> accepted -> converted (to invoice) ; rejected ; cancelled */
const router = express.Router();
const bulkRouter = express.Router();
router.use('/bulk', bulkRouter);

async function mustGet(req, id = req.params.id) {
  const q = await getDoc('quotation', req.companyId, id);
  if (!q) throw new HttpError(404, 'Quotation not found');
  q.is_expired = ['draft', 'sent'].includes(q.status) && q.due_date && q.due_date < today();
  if (q.converted_invoice_id) q.converted_invoice = await db.prepare('SELECT id, doc_no FROM invoices WHERE id = ?').get(q.converted_invoice_id);
  return q;
}

router.get('/', async (req, res) => {
  const t = today();
  const rows = await listDocs('quotation', req.companyId, req.query);
  res.json(rows.map((r) => ({ ...r, is_expired: ['draft', 'sent'].includes(r.status) && r.due_date && r.due_date < t })));
});
router.get('/:id', async (req, res) => res.json(await mustGet(req)));
router.post('/', async (req, res) => {
  const q = await db.transaction(async () => createDoc('quotation', req.companyId, req.user, { ...req.body, status: undefined }));
  res.json(await mustGet(req, q.id));
});
router.put('/:id', async (req, res) => {
  await db.transaction(async () => updateDoc('quotation', req.companyId, req.user, req.params.id, req.body || {}));
  res.json(await mustGet(req));
});
router.delete('/:id', async (req, res) => {
  const q = await mustGet(req);
  if (q.status !== 'draft') throw new HttpError(400, 'Only draft quotations can be deleted');
  await db.prepare('DELETE FROM quotations WHERE id = ?').run(q.id);
  res.json({ ok: true });
});

const setStatus = async (req, q, status, action, detail) => {
  await db.prepare('UPDATE quotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, q.id);
  await logActivity(req.companyId, 'quotation', q.id, action || status, detail || null, req.user.id);
};
const RULES = {
  'mark-sent': [['draft'], 'sent'],
  accept: [['draft', 'sent'], 'accepted'],
  reject: [['draft', 'sent'], 'rejected'],
  cancel: [['draft', 'sent', 'accepted', 'rejected'], 'cancelled'],
  reopen: [['rejected', 'cancelled'], 'draft'],
};

async function convert(req, q, { status } = {}) {
  if (!['draft', 'sent', 'accepted'].includes(q.status)) throw new HttpError(400, `Quotation is ${q.status}; only open or accepted quotations can be converted`);
  return db.transaction(async () => {
    const inv = await createDoc('invoice', req.companyId, req.user, {
      ...copyFields(q), reference: q.reference, quotation_id: q.id, doc_date: today(), status: status === 'draft' ? 'draft' : 'unpaid',
    });
    if (inv.status !== 'draft') await applyInvoiceStock(inv, -1, req.user.id);
    await db.prepare("UPDATE quotations SET status = 'converted', converted_invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(inv.id, q.id);
    await logActivity(req.companyId, 'quotation', q.id, 'converted', `Invoice ${inv.doc_no}`, req.user.id);
    await logActivity(req.companyId, 'invoice', inv.id, 'created', `From quotation ${q.doc_no}`, req.user.id);
    return inv;
  });
}

router.post('/:id/convert', async (req, res) => {
  const inv = await convert(req, await mustGet(req), req.body || {});
  res.json({ ok: true, invoice_id: inv.id, invoice_no: inv.doc_no });
});
router.post('/:id/duplicate', async (req, res) => {
  const q = await mustGet(req);
  const copy = await db.transaction(async () => createDoc('quotation', req.companyId, req.user, { ...copyFields(q), terms: q.terms, doc_date: today() }));
  res.json(await mustGet(req, copy.id));
});
router.get('/:id/pdf', async (req, res) => sendPdf(req, res, 'quotation', await mustGet(req)));
router.get('/:id/share', async (req, res) => res.json(await shareInfo(req, 'quotation', await mustGet(req))));
router.post('/:id/email', async (req, res) => {
  const q = await mustGet(req);
  const r = await sendEmail(req, 'quotation', q, req.body || {});
  if (q.status === 'draft') await setStatus(req, q, 'sent', 'sent', 'via email');
  res.json(r);
});
router.post('/:id/whatsapp', async (req, res) => {
  const q = await mustGet(req);
  const r = await sendWhatsApp(req, 'quotation', q, req.body || {});
  if (q.status === 'draft') await setStatus(req, q, 'sent', 'sent', 'via WhatsApp');
  res.json(r);
});
router.post('/:id/:action', async (req, res) => {
  const rule = RULES[req.params.action];
  if (!rule) throw new HttpError(404, 'Unknown action');
  const q = await mustGet(req);
  if (!rule[0].includes(q.status)) throw new HttpError(400, `Cannot ${req.params.action} a ${q.status} quotation`);
  await setStatus(req, q, rule[1], req.params.action, req.body?.reason);
  res.json(await mustGet(req));
});

bulkRouter.post('/:action', async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Select at least one quotation');
  const { action } = req.params;
  if (action === 'download') {
    const docs = (await Promise.all(ids.map((id) => getDoc('quotation', req.companyId, id)))).filter(Boolean);
    return zipPdfs(req, res, 'quotation', docs, `quotations-${today()}.zip`);
  }
  const results = [];
  for (const id of ids) {
    const q = await getDoc('quotation', req.companyId, id);
    if (!q) continue;
    try {
      let extra = {};
      if (action === 'email') { await sendEmail(req, 'quotation', q); if (q.status === 'draft') await setStatus(req, q, 'sent'); }
      else if (action === 'whatsapp') { extra = await sendWhatsApp(req, 'quotation', q); if (q.status === 'draft') await setStatus(req, q, 'sent'); }
      else if (action === 'convert') { const inv = await convert(req, q); extra = { invoice_no: inv.doc_no }; }
      else if (action === 'delete') { if (q.status !== 'draft') throw new HttpError(400, 'only drafts can be deleted'); await db.prepare('DELETE FROM quotations WHERE id = ?').run(q.id); }
      else throw new HttpError(400, `Unknown action ${action}`);
      results.push({ id, doc_no: q.doc_no, party: q.party?.name, ok: true, ...extra });
    } catch (e) { results.push({ id, doc_no: q.doc_no, party: q.party?.name, ok: false, error: e.message }); }
  }
  res.json({ results, success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

module.exports = router;