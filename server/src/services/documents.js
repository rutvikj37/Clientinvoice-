/**
 * One engine for invoices, quotations and purchase orders (they share the client's template fields).
 */
const { db, logActivity } = require('../db');
const { computeTotals, stateCodeFor, today, addDays, HttpError, STATES } = require('./util');

const KINDS = {
  invoice: {
    table: 'invoices', items: 'invoice_items', party: 'customers', entity: 'invoice', label: 'Invoice', partyLabel: 'Customer',
    prefix: 'invoice_prefix', priceField: 'sale_price', termsField: 'invoice_terms', dueDaysField: 'default_due_days',
    defaultStatus: 'unpaid', editable: (d) => ['draft', 'unpaid'].includes(d.status) && !(d.amount_paid > 0),
  },
  quotation: {
    table: 'quotations', items: 'quotation_items', party: 'customers', entity: 'quotation', label: 'Quotation', partyLabel: 'Customer',
    prefix: 'quote_prefix', priceField: 'sale_price', termsField: 'quote_terms', dueDaysField: 'quote_validity_days',
    defaultStatus: 'draft', editable: (d) => ['draft', 'sent', 'rejected'].includes(d.status),
  },
  po: {
    table: 'purchase_orders', items: 'po_items', party: 'vendors', entity: 'po', label: 'Purchase Order', partyLabel: 'Vendor',
    prefix: 'po_prefix', priceField: 'purchase_price', termsField: 'po_terms', dueDaysField: null,
    defaultStatus: 'draft', editable: (d) => ['draft', 'rejected'].includes(d.status),
  },
};

const kindOf = (k) => {
  const cfg = KINDS[k];
  if (!cfg) throw new HttpError(400, `Unknown document type ${k}`);
  return cfg;
};

const getCompany = (companyId) => db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);

/** Indian financial year (Apr–Mar) label, e.g. 2026-27 */
function financialYear(dateStr = today()) {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Next number for prefix like "MCH/{FY}/" -> MCH/2026-27/004. Sequence restarts each FY because the prefix changes. */
function nextDocNo(companyId, kind, dateStr) {
  const cfg = kindOf(kind);
  const company = getCompany(companyId);
  const prefix = String(company[cfg.prefix] || '').replace(/\{FY\}/g, financialYear(dateStr || today()));
  const rows = db.prepare(`SELECT doc_no FROM ${cfg.table} WHERE company_id = ? AND substr(doc_no, 1, ?) = ?`).all(companyId, prefix.length, prefix);
  let max = 0;
  for (const r of rows) {
    const n = Number(r.doc_no.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(company.number_padding || 3, '0')}`;
}

function partyStateCode(p) { return p.state_code || stateCodeFor(p.state, p.gstin); }
function companyStateCode(c) { return c.state_code || stateCodeFor(c.state, c.gstin); }
function isInterstate(company, party) {
  const a = companyStateCode(company), b = partyStateCode(party);
  return Boolean(a && b && a !== b);
}

/**
 * Normalise incoming line items. Supports:
 *  - product_id or item_code (matched to inventory SKU) to pull name/HSN/UOM/price/GST
 *  - price_after_disc (template "Price Af Disc") -> derives discount %
 *  - cgst_rate + sgst_rate or igst_rate (template columns) -> tax_rate
 */
function normaliseItems(companyId, kind, items) {
  const cfg = kindOf(kind);
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one line item');
  return items.map((it, i) => {
    let product = null;
    if (it.product_id) product = db.prepare('SELECT * FROM products WHERE id = ? AND company_id = ?').get(it.product_id, companyId);
    if (!product && it.item_code) product = db.prepare('SELECT * FROM products WHERE company_id = ? AND sku = ?').get(companyId, String(it.item_code).trim());
    const description = (it.description || '').trim() || product?.name;
    if (!description) throw new HttpError(400, `Line ${i + 1}: item description is required`);
    const qty = Number(it.qty);
    if (!(qty > 0)) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than 0`);
    const has = (v) => v !== undefined && v !== null && v !== '';
    const rate = has(it.rate) ? Number(it.rate) : Number(product?.[cfg.priceField] || 0);
    let discount = has(it.discount_pct) ? Number(it.discount_pct) : 0;
    if (has(it.price_after_disc) && rate > 0 && !has(it.discount_pct)) discount = Math.round((1 - Number(it.price_after_disc) / rate) * 10000) / 100;
    let tax = has(it.tax_rate) ? Number(it.tax_rate) : null;
    if (tax === null && (has(it.cgst_rate) || has(it.sgst_rate))) tax = Number(it.cgst_rate || 0) + Number(it.sgst_rate || 0);
    if (tax === null && has(it.igst_rate)) tax = Number(it.igst_rate);
    if (tax === null) tax = Number(product?.tax_rate || 0);
    if ([rate, discount, tax].some((n) => Number.isNaN(n))) throw new HttpError(400, `Line ${i + 1}: price, discount and GST must be numbers`);
    return {
      product_id: product?.id || null,
      item_code: (it.item_code || product?.sku || '') || null,
      description,
      hsn: (has(it.hsn) ? String(it.hsn) : product?.hsn) || null,
      unit: it.unit || product?.unit || 'Nos',
      qty, rate, discount_pct: discount, tax_rate: tax,
    };
  });
}

function insertItems(cfg, docId, lines) {
  const stmt = db.prepare(`INSERT INTO ${cfg.items}
    (doc_id, product_id, item_code, description, hsn, unit, qty, rate, discount_pct, tax_rate, taxable_amount, tax_amount, amount, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  lines.forEach((l, i) => stmt.run(docId, l.product_id, l.item_code, l.description, l.hsn, l.unit, l.qty, l.rate,
    l.discount_pct, l.tax_rate, l.taxable_amount, l.tax_amount, l.amount, i));
}

const HEADER_FIELDS = ['doc_date', 'due_date', 'delivery_date', 'place_of_supply', 'contact_person', 'contact_phone', 'contact_email',
  'payment_terms', 'transport', 'reference', 'remarks', 'terms'];

function resolveParty(companyId, cfg, partyId) {
  const party = db.prepare(`SELECT * FROM ${cfg.party} WHERE id = ? AND company_id = ?`).get(partyId, companyId);
  if (!party) throw new HttpError(400, `Select a valid ${cfg.partyLabel.toLowerCase()}`);
  return party;
}

function buildHeader(kind, company, party, data, existing, user) {
  const cfg = kindOf(kind);
  const val = (k) => (data[k] !== undefined ? (data[k] === '' ? null : data[k]) : existing ? existing[k] : undefined);
  const docDate = val('doc_date') || today();
  const h = {};
  for (const f of HEADER_FIELDS) h[f] = val(f);
  h.doc_date = docDate;
  if (!existing) {
    if (!h.due_date && cfg.dueDaysField) h.due_date = addDays(docDate, company[cfg.dueDaysField] || 15);
    h.payment_terms = h.payment_terms ?? party.payment_terms ?? company.default_payment_terms ?? null;
    h.transport = h.transport ?? company.default_transport ?? null;
    h.contact_person = h.contact_person ?? user?.name ?? null;
    h.contact_phone = h.contact_phone ?? company.phone ?? null;
    h.contact_email = h.contact_email ?? company.email ?? null;
    h.terms = h.terms ?? company[cfg.termsField] ?? null;
    if (!h.place_of_supply) {
      // Prefer company default (Quotation Template: "Ex- Works Jaipur"); else party city/state.
      h.place_of_supply = company.default_place_of_supply
        || [party.city, party.state || STATES[partyStateCode(party)]].filter(Boolean).join(' ')
        || null;
    }
  }
  return h;
}

function createDoc(kind, companyId, user, data, { source = 'manual', batchId = null, status } = {}) {
  const cfg = kindOf(kind);
  const company = getCompany(companyId);
  const party = resolveParty(companyId, cfg, data.party_id);
  const items = normaliseItems(companyId, kind, data.items);
  const interstate = isInterstate(company, party);
  const t = computeTotals(items, { interstate, shipping: data.shipping, roundOff: kind !== 'po' });
  const h = buildHeader(kind, company, party, data, null, user);
  let docNo = String(data.doc_no || '').trim();
  if (docNo) {
    if (db.prepare(`SELECT 1 FROM ${cfg.table} WHERE company_id = ? AND doc_no = ?`).get(companyId, docNo))
      throw new HttpError(409, `${cfg.label} number ${docNo} already exists`);
  } else docNo = nextDocNo(companyId, kind, h.doc_date);
  const st = status || (data.status === 'draft' ? 'draft' : cfg.defaultStatus);

  const cols = ['company_id', 'doc_no', 'party_id', 'status', 'is_interstate', ...HEADER_FIELDS,
    'subtotal', 'discount_total', 'taxable_total', 'cgst', 'sgst', 'igst', 'tax_total', 'shipping', 'round_off', 'total',
    'source', 'batch_id', 'created_by'];
  const vals = [companyId, docNo, party.id, st, interstate ? 1 : 0, ...HEADER_FIELDS.map((f) => h[f] ?? null),
    t.subtotal, t.discount_total, t.taxable_total, t.cgst, t.sgst, t.igst, t.tax_total, t.shipping, t.round_off, t.total,
    source, batchId, user?.id || null];
  if (kind === 'po') {
    cols.push('delivery_address');
    vals.push(data.delivery_address || [company.address, company.city, company.state, company.pincode].filter(Boolean).join(', ') || null);
  }
  if (kind === 'invoice' && data.quotation_id) { cols.push('quotation_id'); vals.push(data.quotation_id); }
  const info = db.prepare(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  insertItems(cfg, info.lastInsertRowid, t.lines);
  logActivity(companyId, cfg.entity, info.lastInsertRowid, 'created', source === 'bulk' ? 'Created from Excel upload' : null, user?.id);
  return db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(info.lastInsertRowid);
}

function updateDoc(kind, companyId, user, id, data, { beforeSave } = {}) {
  const cfg = kindOf(kind);
  const doc = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  if (!doc) throw new HttpError(404, `${cfg.label} not found`);
  if (!cfg.editable(doc)) throw new HttpError(400, `This ${cfg.label.toLowerCase()} can no longer be edited (status: ${doc.status.replace(/_/g, ' ')})`);
  const company = getCompany(companyId);
  const party = resolveParty(companyId, cfg, data.party_id || doc.party_id);
  const items = normaliseItems(companyId, kind, data.items);
  const interstate = isInterstate(company, party);
  const t = computeTotals(items, { interstate, shipping: data.shipping ?? doc.shipping, roundOff: kind !== 'po' });
  const h = buildHeader(kind, company, party, data, doc, user);
  const docNo = String(data.doc_no || doc.doc_no).trim();
  if (docNo !== doc.doc_no && db.prepare(`SELECT 1 FROM ${cfg.table} WHERE company_id = ? AND doc_no = ?`).get(companyId, docNo))
    throw new HttpError(409, `${cfg.label} number ${docNo} already exists`);
  if (beforeSave) beforeSave(doc);
  const sets = ['doc_no = ?', 'party_id = ?', 'is_interstate = ?', ...HEADER_FIELDS.map((f) => `${f} = ?`),
    'subtotal = ?', 'discount_total = ?', 'taxable_total = ?', 'cgst = ?', 'sgst = ?', 'igst = ?', 'tax_total = ?', 'shipping = ?', 'round_off = ?', 'total = ?',
    'updated_at = CURRENT_TIMESTAMP'];
  const vals = [docNo, party.id, interstate ? 1 : 0, ...HEADER_FIELDS.map((f) => h[f] ?? null),
    t.subtotal, t.discount_total, t.taxable_total, t.cgst, t.sgst, t.igst, t.tax_total, t.shipping, t.round_off, t.total];
  if (kind === 'po' && data.delivery_address !== undefined) { sets.push('delivery_address = ?'); vals.push(data.delivery_address || null); }
  db.prepare(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  db.prepare(`DELETE FROM ${cfg.items} WHERE doc_id = ?`).run(id);
  insertItems(cfg, id, t.lines);
  logActivity(companyId, cfg.entity, id, 'updated', null, user?.id);
  return db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id);
}

function getDoc(kind, companyId, id) {
  const cfg = kindOf(kind);
  const doc = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  if (!doc) return null;
  doc.kind = kind;
  doc.items = db.prepare(`SELECT it.*, p.stock_qty FROM ${cfg.items} it LEFT JOIN products p ON p.id = it.product_id WHERE it.doc_id = ? ORDER BY it.sort, it.id`).all(id);
  doc.party = db.prepare(`SELECT * FROM ${cfg.party} WHERE id = ?`).get(doc.party_id);
  doc.activity = db.prepare(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC`).all(cfg.entity, id);
  doc.editable = cfg.editable(doc);
  return doc;
}

/** Base list query: returns rows with party name + contact */
function listDocs(kind, companyId, { status, party_id, from, to, q, batch_id }, extraWhere = '', extraParams = []) {
  const cfg = kindOf(kind);
  let where = 'd.company_id = ?';
  const params = [companyId];
  if (status) { where += ' AND d.status = ?'; params.push(status); }
  if (party_id) { where += ' AND d.party_id = ?'; params.push(party_id); }
  if (batch_id) { where += ' AND d.batch_id = ?'; params.push(batch_id); }
  if (from) { where += ' AND d.doc_date >= ?'; params.push(from); }
  if (to) { where += ' AND d.doc_date <= ?'; params.push(to); }
  if (q) { where += " AND (d.doc_no LIKE ? OR p.name LIKE ? OR IFNULL(d.reference,'') LIKE ? OR IFNULL(p.code,'') LIKE ?)"; params.push(...Array(4).fill(`%${q}%`)); }
  where += extraWhere;
  params.push(...extraParams);
  return db.prepare(`SELECT d.*, p.name AS party_name, p.code AS party_code, p.email AS party_email, p.phone AS party_phone
    FROM ${cfg.table} d JOIN ${cfg.party} p ON p.id = d.party_id WHERE ${where} ORDER BY d.doc_date DESC, d.id DESC`).all(...params);
}

module.exports = { KINDS, kindOf, getCompany, financialYear, nextDocNo, isInterstate, normaliseItems, createDoc, updateDoc, getDoc, listDocs, HEADER_FIELDS };
