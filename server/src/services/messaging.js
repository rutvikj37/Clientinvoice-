const nodemailer = require('nodemailer');
const { fillTemplate, formatMoney, HttpError } = require('./util');

const LABEL = { invoice: 'Invoice', quotation: 'Quotation', po: 'Purchase Order' };
const DEFAULT_SUBJECT = '{{doc_label}} {{doc_no}} from {{company_name}}';
const DEFAULT_BODY = `Dear {{party_name}},

Please find attached {{doc_label}} {{doc_no}} dated {{doc_date}} for {{amount}}.

You can also view / download it here: {{link}}

Regards,
{{company_name}}`;
const DEFAULT_WA = `Hello {{party_name}},
{{doc_label}} *{{doc_no}}* from *{{company_name}}* for *{{amount}}*.
View / download: {{link}}`;

function docVars(kind, company, doc, link) {
  const fmt = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
  return {
    company_name: company.name, party_name: doc.party?.name || '', customer_name: doc.party?.name || '',
    doc_label: LABEL[kind], doc_no: doc.doc_no, invoice_no: doc.doc_no, doc_date: fmt(doc.doc_date), invoice_date: fmt(doc.doc_date),
    due_date: fmt(doc.due_date), amount: formatMoney(doc.total, company.currency),
    balance: formatMoney(doc.total - (doc.amount_paid || 0), company.currency), link,
  };
}

function transportFor(company) {
  const host = company.smtp_host || process.env.SMTP_HOST;
  if (!host) throw new HttpError(400, 'Email is not configured. Add SMTP details in Company Settings → Email.');
  return nodemailer.createTransport({
    host,
    port: Number(company.smtp_port || process.env.SMTP_PORT || 587),
    secure: Boolean(company.smtp_host ? company.smtp_secure : process.env.SMTP_SECURE === 'true'),
    auth: (company.smtp_user || process.env.SMTP_USER)
      ? { user: company.smtp_user || process.env.SMTP_USER, pass: company.smtp_pass || process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail(company, { to, cc, subject, text, attachments }) {
  if (!to) throw new HttpError(400, 'Recipient email address is missing');
  const transport = transportFor(company);
  const from = company.smtp_from || process.env.SMTP_FROM || company.smtp_user || process.env.SMTP_USER || company.email;
  return transport.sendMail({ from: `"${company.name}" <${from.replace(/.*<|>.*/g, '')}>`, to, cc, subject, text, attachments });
}

/** Normalise to E.164 digits without '+'. Assumes India (+91) for 10-digit numbers. */
function normalisePhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}

const waConfigured = (company) => Boolean((company.wa_phone_number_id || process.env.WA_PHONE_NUMBER_ID) && (company.wa_access_token || process.env.WA_ACCESS_TOKEN));

/**
 * Send a PDF as a WhatsApp document via the Meta WhatsApp Cloud API.
 * Note: outside a 24h customer-service window Meta requires an approved template message;
 * configure one in Meta Business Manager if you need to initiate conversations.
 */
async function sendWhatsAppDocument(company, { phone, pdf, filename, caption }) {
  const phoneId = company.wa_phone_number_id || process.env.WA_PHONE_NUMBER_ID;
  const token = company.wa_access_token || process.env.WA_ACCESS_TOKEN;
  const base = `https://graph.facebook.com/${process.env.WA_API_VERSION || 'v21.0'}/${phoneId}`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  const up = await fetch(`${base}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const upJson = await up.json();
  if (!up.ok) throw new HttpError(502, `WhatsApp media upload failed: ${upJson.error?.message || up.statusText}`);
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: normalisePhone(phone), type: 'document',
      document: { id: upJson.id, filename, caption },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new HttpError(502, `WhatsApp send failed: ${json.error?.message || res.statusText}`);
  return json;
}

function waLink(phone, text) {
  return `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;
}

module.exports = { DEFAULT_SUBJECT, DEFAULT_BODY, DEFAULT_WA, docVars, LABEL, sendMail, sendWhatsAppDocument, waConfigured, waLink, normalisePhone, fillTemplate };
