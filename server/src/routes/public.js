const router = require('express').Router();
const { verifyPublicLink } = require('../middleware/auth');
const { getDoc, getCompany } = require('../services/documents');
const { documentPdf, pdfFileName } = require('../services/pdf');

// Customer/vendor-facing link shared over WhatsApp / email (no login needed)
router.get('/doc/:token', async (req, res) => {
  let payload;
  try { payload = verifyPublicLink(req.params.token); } catch { return res.status(410).send('This link has expired or is invalid.'); }
  if (!['invoice', 'quotation', 'po'].includes(payload.k)) return res.status(400).send('Invalid link');
  const doc = await getDoc(payload.k, payload.cid, payload.id);
  if (!doc || (payload.k === 'invoice' && doc.status === 'draft')) return res.status(404).send('Document not found');
  const pdf = await documentPdf(payload.k, await getCompany(payload.cid), doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${pdfFileName(payload.k, doc)}"`);
  res.send(pdf);
});

module.exports = router;