const express = require('express');
const { db, logActivity } = require('../db');
const { createDoc, updateDoc, getDoc, listDocs, getCompany } = require('../services/documents');
const { moveStock } = require('../services/inventory');
const { shareInfo, sendEmail, sendWhatsApp, sendPdf, zipPdfs } = require('./docShared');
const { today, round2, HttpError } = require('../services/util');

/*
 * PO flow:
 *   draft --submit--> pending_approval --approve--> approved --send--> sent --receive (GRN)--> partially_received --receive--> received --close--> closed
 *                                      --reject---> rejected (edit & resubmit)
 *   If company.po_approval_required = 0, submit goes straight to approved. Cancel allowed until goods are received.
 */
const TRANSITIONS = {
  submit: { from: ['draft', 'rejected'] },
  approve: { from: ['pending_approval'], admin: true },
  reject: { from: ['pending_approval'], admin: true },
  send: { from: ['approved', 'sent'] },
  receive: { from: ['approved', 'sent', 'partially_received'] },
  close: { from: ['partially_received', 'received'] },
  cancel: { from: ['draft', 'pending_approval', 'approved', 'sent', 'rejected'] },
};

const router = express.Router();
const bulkRouter = express.Router();
router.use('/bulk', bulkRouter);

async function mustGet(req, id = req.params.id) {
  const po = await getDoc('po', req.companyId, id);
  if (!po) throw new HttpError(404, 'Purchase order not found');
  const receipts = await db.prepare('SELECT r.*, u.name AS user_name FROM po_receipts r LEFT JOIN users u ON u.id = r.user_id WHERE r.po_id = ? ORDER BY r.id').all(po.id);
  po.receipts = await Promise.all(receipts.map(async (r) => ({
    ...r,
    items: await db.prepare('SELECT ri.qty, pi.description, pi.item_code, pi.unit FROM po_receipt_items ri JOIN po_items pi ON pi.id = ri.po_item_id WHERE ri.receipt_id = ?').all(r.id),
  })));
  po.approver = po.approved_by ? (await db.prepare('SELECT name FROM users WHERE id = ?').get(po.approved_by))?.name : null;
  po.allowed_actions = Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(po.status)).map(([k]) => k);
  return po;
}

router.get('/', async (req, res) => {
  const rows = await listDocs('po', req.companyId, req.query);
  const qty = db.prepare('SELECT COALESCE(SUM(qty),0) AS o, COALESCE(SUM(received_qty),0) AS r FROM po_items WHERE doc_id = ?');
  const mapped = await Promise.all(rows.map(async (r) => {
    const q = await qty.get(r.id);
    return { ...r, qty_ordered: q.o, qty_received: q.r };
  }));
  res.json(mapped);
});
router.get('/stats', async (req, res) => {
  res.json(await db.prepare('SELECT status, COUNT(*) AS count, COALESCE(SUM(total),0) AS value FROM purchase_orders WHERE company_id = ? GROUP BY status').all(req.companyId));
});
router.get('/:id', async (req, res) => res.json(await mustGet(req)));
router.post('/', async (req, res) => {
  const po = await db.transaction(async () => createDoc('po', req.companyId, req.user, { ...req.body, status: undefined }));
  res.json(await mustGet(req, po.id));
});
router.put('/:id', async (req, res) => {
  await db.transaction(async () => updateDoc('po', req.companyId, req.user, req.params.id, req.body || {}));
  res.json(await mustGet(req));
});
router.delete('/:id', async (req, res) => {
  const po = await mustGet(req);
  if (po.status !== 'draft') throw new HttpError(400, 'Only draft POs can be deleted. Cancel it instead.');
  await db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id);
  res.json({ ok: true });
});
router.post('/:id/duplicate', async (req, res) => {
  const po = await mustGet(req);
  const copy = await db.transaction(async () => createDoc('po', req.companyId, req.user, {
    party_id: po.party_id, place_of_supply: po.place_of_supply, contact_person: po.contact_person, contact_phone: po.contact_phone, contact_email: po.contact_email,
    payment_terms: po.payment_terms, transport: po.transport, remarks: po.remarks, terms: po.terms, delivery_address: po.delivery_address,
    items: po.items.map(({ product_id, item_code, description, hsn, unit, qty, rate, discount_pct, tax_rate }) => ({ product_id, item_code, description, hsn, unit, qty, rate, discount_pct, tax_rate })),
  }));
  res.json(await mustGet(req, copy.id));
});
router.get('/:id/pdf', async (req, res) => sendPdf(req, res, 'po', await mustGet(req)));
router.get('/:id/share', async (req, res) => res.json(await shareInfo(req, 'po', await mustGet(req))));

function transition(req, po, action) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new HttpError(404, 'Unknown action');
  if (!rule.from.includes(po.status)) throw new HttpError(400, `${po.doc_no}: cannot ${action} a PO that is ${po.status.replace(/_/g, ' ')}`);
  if (rule.admin && req.user.role !== 'admin') throw new HttpError(403, 'Only an admin can approve or reject purchase orders');
}
const setStatus = async (id, s) => db.prepare('UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(s, id);

async function submit(req, po) {
  transition(req, po, 'submit');
  const company = await getCompany(req.companyId);
  if (company.po_approval_required) {
    await setStatus(po.id, 'pending_approval');
    await logActivity(req.companyId, 'po', po.id, 'submitted', 'Sent for approval', req.user.id);
  } else await approve(req, { ...po, status: 'pending_approval' }, 'Auto-approved (approval not required)', true);
}
async function approve(req, po, comment, skipCheck) {
  if (!skipCheck) transition(req, po, 'approve');
  await db.prepare("UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, rejection_reason = NULL WHERE id = ?").run(req.user.id, po.id);
  await logActivity(req.companyId, 'po', po.id, 'approved', comment, req.user.id);
}

async function send(req, po, body = {}) {
  transition(req, po, 'send');
  const channel = body.channel || 'manual';
  let result = { ok: true };
  if (channel === 'email') result = await sendEmail(req, 'po', po, body);
  else if (channel === 'whatsapp') result = await sendWhatsApp(req, 'po', po, body);
  await setStatus(po.id, 'sent');
  if (channel === 'manual') await logActivity(req.companyId, 'po', po.id, 'sent', 'Marked as sent', req.user.id);
  return result;
}

router.post('/:id/send', async (req, res) => {
  const r = await send(req, await mustGet(req), req.body || {});
  res.json({ ...r, po: await mustGet(req) });
});

router.post('/:id/:action', async (req, res) => {
  const { action } = req.params;
  const po = await mustGet(req);
  const body = req.body || {};
  if (action === 'submit') await submit(req, po);
  else if (action === 'approve') await approve(req, po, body.comment);
  else if (action === 'reject') {
    transition(req, po, 'reject');
    await db.prepare("UPDATE purchase_orders SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(body.reason || null, po.id);
    await logActivity(req.companyId, 'po', po.id, 'rejected', body.reason, req.user.id);
  } else if (action === 'receive') {
    transition(req, po, 'receive');
    const lines = (body.items || []).map((l) => ({ id: Number(l.po_item_id), qty: Number(l.qty) })).filter((l) => l.qty > 0);
    if (!lines.length) throw new HttpError(400, 'Enter the received quantity for at least one item');
    await db.transaction(async () => {
      const count = (await db.prepare('SELECT COUNT(*) AS n FROM po_receipts WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id = ?)').get(req.companyId)).n;
      const grn = `GRN-${String(count + 1).padStart(4, '0')}`;
      const rec = await db.prepare('INSERT INTO po_receipts (po_id, grn_no, received_on, note, user_id) VALUES (?,?,?,?,?)').run(po.id, grn, body.received_on || today(), body.note || null, req.user.id);
      for (const l of lines) {
        const item = po.items.find((i) => i.id === l.id);
        if (!item) throw new HttpError(400, 'Invalid PO line');
        const pending = round2(item.qty - item.received_qty);
        if (l.qty > pending + 1e-9) throw new HttpError(400, `${item.description}: only ${pending} pending`);
        await db.prepare('INSERT INTO po_receipt_items (receipt_id, po_item_id, qty) VALUES (?,?,?)').run(rec.lastInsertRowid, item.id, l.qty);
        await db.prepare('UPDATE po_items SET received_qty = received_qty + ? WHERE id = ?').run(l.qty, item.id);
        if (item.product_id) {
          await moveStock({ companyId: req.companyId, productId: item.product_id, qty: l.qty, type: 'IN', refType: 'po', refId: po.id, note: `${grn} against ${po.doc_no}`, userId: req.user.id });
          await db.prepare('UPDATE products SET purchase_price = ? WHERE id = ?').run(round2(item.rate * (1 - (item.discount_pct || 0) / 100)), item.product_id);
        }
      }
      const left = (await db.prepare('SELECT COALESCE(SUM(qty - received_qty),0) AS p FROM po_items WHERE doc_id = ?').get(po.id)).p;
      await setStatus(po.id, left > 1e-9 ? 'partially_received' : 'received');
      await logActivity(req.companyId, 'po', po.id, 'received', `${grn}: ${lines.length} line(s)`, req.user.id);
    });
  } else if (action === 'close' || action === 'cancel') {
    transition(req, po, action);
    await setStatus(po.id, action === 'close' ? 'closed' : 'cancelled');
    await logActivity(req.companyId, 'po', po.id, action === 'close' ? 'closed' : 'cancelled', body.reason, req.user.id);
  } else throw new HttpError(404, 'Unknown action');
  res.json({ ok: true, po: await mustGet(req) });
});

bulkRouter.post('/:action', async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Select at least one PO');
  const { action } = req.params;
  if (action === 'download') {
    const docs = (await Promise.all(ids.map((id) => getDoc('po', req.companyId, id)))).filter(Boolean);
    return zipPdfs(req, res, 'po', docs, `purchase-orders-${today()}.zip`);
  }
  const results = [];
  for (const id of ids) {
    const po = await getDoc('po', req.companyId, id);
    if (!po) continue;
    try {
      let extra = {};
      if (action === 'submit') await submit(req, po);
      else if (action === 'approve') await approve(req, po);
      else if (action === 'email') extra = await send(req, po, { channel: 'email' });
      else if (action === 'whatsapp') extra = await send(req, po, { channel: 'whatsapp' });
      else if (action === 'cancel') { transition(req, po, 'cancel'); await setStatus(po.id, 'cancelled'); await logActivity(req.companyId, 'po', po.id, 'cancelled', null, req.user.id); }
      else if (action === 'delete') { if (po.status !== 'draft') throw new HttpError(400, 'only drafts can be deleted'); await db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id); }
      else throw new HttpError(400, `Unknown action ${action}`);
      results.push({ id, doc_no: po.doc_no, party: po.party?.name, ok: true, ...extra });
    } catch (e) { results.push({ id, doc_no: po.doc_no, party: po.party?.name, ok: false, error: e.message }); }
  }
  res.json({ results, success: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

module.exports = router;