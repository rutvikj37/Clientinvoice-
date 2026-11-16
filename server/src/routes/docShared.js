// Sharing helpers used by invoices, quotations and purchase orders
const { db, logActivity } = require('../db');
const { kindOf, getCompany } = require('../services/documents');
const { documentPdf, pdfFileName } = require('../services/pdf');
const msg = require('../services/messaging');
const { signPublicLink } = require('../middleware/auth');
const { HttpError } = require('../services/util');

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const publicLink = (req, kind, doc) => `${baseUrl(req)}/api/public/doc/${signPublicLink(kind, doc.id, doc.company_id)}`;

async function shareInfo(req, kind, doc) {
  const company = await getCompany(req.companyId);
  const vars = msg.docVars(kind, company, doc, publicLink(req, kind, doc));
  // custom templates in settings are written for invoices; other docs use defaults
  const subjT = kind === 'invoice' && company.email_subject_template ? company.email_subject_template : msg.DEFAULT_SUBJECT;
  const bodyT = kind === 'invoice' && company.email_body_template ? company.email_body_template : msg.DEFAULT_BODY;
  const waT = kind === 'invoice' && company.whatsapp_template ? company.whatsapp_template : msg.DEFAULT_WA;
  return {
    link: vars.link,
    email: { to: doc.party?.email || '', subject: msg.fillTemplate(subjT, vars), message: msg.fillTemplate(bodyT, vars) },
    whatsapp: { phone: doc.party?.phone || '', message: msg.fillTemplate(waT, vars), api: msg.waConfigured(company) },
  };
}

async function sendEmail(req, kind, doc, { to, cc, subject, message } = {}) {
  const cfg = kindOf(kind);
  if (doc.status === 'draft' && kind === 'invoice') throw new HttpError(400, `${doc.doc_no}: issue the invoice before sending`);
  if (doc.status === 'cancelled') throw new HttpError(400, `${doc.doc_no}: document is cancelled`);
  const company = await getCompany(req.companyId);
  const s = await shareInfo(req, kind, doc);
  const recipient = to || s.email.to;
  if (!recipient) throw new HttpError(400, `${doc.doc_no}: ${cfg.partyLabel.toLowerCase()} has no email address`);
  const pdf = await documentPdf(kind, company, doc);
  await msg.sendMail(company, {
    to: recipient, cc, subject: subject || s.email.subject, text: message || s.email.message,
    attachments: [{ filename: pdfFileName(kind, doc), content: pdf, contentType: 'application/pdf' }],
  });
  await db.prepare(`UPDATE ${cfg.table} SET last_emailed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(doc.id);
  await logActivity(req.companyId, cfg.entity, doc.id, 'emailed', recipient, req.user.id);
  return { ok: true };
}

async function sendWhatsApp(req, kind, doc, { phone, message } = {}) {
  const cfg = kindOf(kind);
  if (doc.status === 'draft' && kind === 'invoice') throw new HttpError(400, `${doc.doc_no}: issue the invoice before sending`);
  if (doc.status === 'cancelled') throw new HttpError(400, `${doc.doc_no}: document is cancelled`);
  const company = await getCompany(req.companyId);
  const s = await shareInfo(req, kind, doc);
  const number = phone || s.whatsapp.phone;
  if (!number) throw new HttpError(400, `${doc.doc_no}: ${cfg.partyLabel.toLowerCase()} has no phone number`);
  const text = message || s.whatsapp.message;
  let result;
  if (msg.waConfigured(company)) {
    const pdf = await documentPdf(kind, company, doc);
    await msg.sendWhatsAppDocument(company, { phone: number, pdf, filename: pdfFileName(kind, doc), caption: text });
    result = { mode: 'api', sent: true };
  } else result = { mode: 'link', url: msg.waLink(number, text) };
  await db.prepare(`UPDATE ${cfg.table} SET last_whatsapp_at = CURRENT_TIMESTAMP WHERE id = ?`).run(doc.id);
  await logActivity(req.companyId, cfg.entity, doc.id, 'whatsapp', `${result.mode === 'api' ? 'Sent via API to' : 'Shared link to'} ${number}`, req.user.id);
  return { doc_no: doc.doc_no, party: doc.party?.name, ...result };
}

async function sendPdf(req, res, kind, doc) {
  const pdf = await documentPdf(kind, await getCompany(req.companyId), doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfFileName(kind, doc)}"`);
  res.send(pdf);
}

async function zipPdfs(req, res, kind, docs, name) {
  const { ZipArchive } = require('archiver');
  const company = await getCompany(req.companyId);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.pipe(res);
  for (const d of docs) zip.append(await documentPdf(kind, company, d), { name: pdfFileName(kind, d) });
  await zip.finalize();
}

module.exports = { shareInfo, sendEmail, sendWhatsApp, sendPdf, zipPdfs, publicLink };