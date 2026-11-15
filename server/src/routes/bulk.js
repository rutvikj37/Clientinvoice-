/**
 * Excel bulk upload for invoices, quotations and purchase orders.
 *
 * Two kinds of file are accepted (auto-detected, several files at once):
 *  1. FLAT sheet  - one row per line item, columns named like the client's template
 *                   (Doc No, Document Date, Vendor/Customer Code, Item Code, Item Description, HSN, Qty, UOM, Unit Price, Disc, CGST Rate...).
 *                   Rows with the same Doc Ref / Doc No become one document. Columns can be re-mapped in the UI.
 *  2. FORM files  - the client's own filled PO / Quotation template (one document per sheet). Labels such as
 *                   "PO No. :", "Details of Vendor", "Item Description" are located automatically.
 */
const router = require('express').Router();
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { db } = require('../db');
const { createDoc, kindOf, KINDS } = require('../services/documents');
const { applyInvoiceStock } = require('../services/inventory');
const { stateCodeFor, HttpError, today, STATES } = require('../services/util');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 100 } });

const DOC_WORD = { invoice: 'Invoice', quotation: 'Offer', po: 'PO' };
const PARTY_WORD = { invoice: 'Customer', quotation: 'Customer', po: 'Vendor' };

// ---- field catalogue (labels follow the client's templates) ----------------
function fieldsFor(type) {
  const P = PARTY_WORD[type], D = DOC_WORD[type];
  const due = type === 'quotation' ? { key: 'due_date', label: 'Offer Validity Date', aliases: ['offer validity date', 'validity date', 'valid till', 'valid until', 'validity'] }
    : type === 'invoice' ? { key: 'due_date', label: 'Due Date', aliases: ['due date', 'payment due date'] } : null;
  return [
    { key: 'doc_ref', label: 'Doc Ref (groups rows)', group: 'doc', aliases: ['doc ref', 'ref', 'group', 'group no', 'sr', 'set'] },
    { key: 'doc_no', label: `${D} No.`, group: 'doc', aliases: [`${D} no`, `${D} number`, 'doc no', 'document no', 'po no', 'offer no', 'invoice no', 'quotation no', 'quote no', 'bill no'] },
    { key: 'doc_date', label: type === 'po' ? 'Document Date' : `${D} Date`, group: 'doc', aliases: ['document date', 'doc date', `${D} date`, 'po date', 'offer date', 'invoice date', 'date'] },
    due,
    { key: 'delivery_date', label: 'Delivery Date', group: 'doc', aliases: ['delivery date', 'delivery', 'expected date'] },
    { key: 'contact_person', label: 'Contact Person', group: 'doc', aliases: ['contact person', 'contact name'] },
    { key: 'contact_phone', label: 'Phone No', group: 'doc', aliases: ['phone no', 'phone'] },
    { key: 'contact_email', label: 'Email', group: 'doc', aliases: ['email'] },
    { key: 'place_of_supply', label: 'Place of Supply', group: 'doc', aliases: ['place of supply', 'pos'] },
    { key: 'party_code', label: `${P} Code`, group: 'party', aliases: [`${P} code`, 'party code', 'code'] },
    { key: 'party_name', label: `${P} Name *`, group: 'party', required: true, aliases: [`${P} name`, P, 'name', 'party name', 'party', 'company name'] },
    { key: 'party_address', label: 'Address', group: 'party', aliases: ['address', `${P} address`, 'billing address'] },
    { key: 'party_city', label: 'City', group: 'party', aliases: ['city', `${P} city`] },
    { key: 'party_state', label: 'State', group: 'party', aliases: ['state', `${P} state`] },
    { key: 'party_state_code', label: 'State Code', group: 'party', aliases: ['state code', `${P} state code`] },
    { key: 'party_gstin', label: 'GST No.', group: 'party', aliases: ['gst no', 'gstin', 'gst number', 'gst', `${P} gst no`, `${P} gstin`] },
    { key: 'party_phone', label: `${P} Mobile (WhatsApp)`, group: 'party', aliases: [`${P} mobile`, `${P} phone`, `${P} mobile whatsapp`, 'whatsapp', 'mobile', 'mobile no'] },
    { key: 'party_email', label: `${P} Email`, group: 'party', aliases: [`${P} email`, 'party email'] },
    { key: 'payment_terms', label: 'Payment Terms', group: 'doc', aliases: ['payment terms', 'terms of payment', 'payment'] },
    { key: 'transport', label: 'Transport', group: 'doc', aliases: ['transport', 'transporter', 'mode of transport'] },
    { key: 'reference', label: type === 'po' ? 'Vendor Quote Ref' : type === 'invoice' ? 'Customer PO No.' : 'Enquiry Ref', group: 'doc', aliases: ['reference', 'customer po', 'customer po no', 'enquiry ref', 'vendor quote ref'] },
    { key: 'remarks', label: 'Remarks', group: 'doc', aliases: ['remarks', 'remark', 'notes'] },
    { key: 'shipping', label: 'Freight', group: 'doc', aliases: ['freight', 'shipping', 'transport charges'] },
    { key: 'item_code', label: 'Item Code', group: 'item', aliases: ['item code', 'sku', 'part no', 'product code'] },
    { key: 'description', label: 'Item Description *', group: 'item', required: true, aliases: ['item description', 'description', 'item', 'item name', 'particulars', 'product'] },
    { key: 'hsn', label: 'HSN', group: 'item', aliases: ['hsn', 'hsn code', 'hsn/sac', 'sac'] },
    { key: 'qty', label: 'Qty *', group: 'item', required: true, aliases: ['qty', 'quantity'] },
    { key: 'unit', label: 'UOM', group: 'item', aliases: ['uom', 'unit', 'units'] },
    { key: 'rate', label: 'Unit Price *', group: 'item', required: true, aliases: ['unit price', 'rate', 'price'] },
    { key: 'discount_pct', label: 'Disc %', group: 'item', aliases: ['disc', 'disc %', 'discount', 'discount %'] },
    { key: 'price_after_disc', label: 'Price Af Disc', group: 'item', aliases: ['price af disc', 'price after disc', 'price after discount', 'net rate'] },
    { key: 'cgst_rate', label: 'CGST Rate', group: 'item', aliases: ['cgst rate', 'cgst %', 'cgst'] },
    { key: 'sgst_rate', label: 'SGST Rate', group: 'item', aliases: ['sgst rate', 'sgst %', 'sgst'] },
    { key: 'igst_rate', label: 'IGST Rate', group: 'item', aliases: ['igst rate', 'igst %', 'igst'] },
    { key: 'tax_rate', label: 'GST Rate (total)', group: 'item', aliases: ['gst rate', 'gst %', 'tax rate', 'tax %'] },
  ].filter(Boolean);
}
const publicFields = (type) => fieldsFor(type).map(({ key, label, group, required }) => ({ key, label, group, required: !!required }));

// ---- cell helpers -----------------------------------------------------------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\-.:*#()]+/g, ' ').replace(/\s+/g, ' ').trim();

/** value of an ExcelJS cell; percentage-formatted numbers become 18 instead of 0.18 */
function cellVal(cell) {
  let v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (Array.isArray(v.richText)) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = typeof v.text === 'object' && v.text?.richText ? v.text.richText.map((r) => r.text).join('') : v.text;
    else if (v.error) v = '';
    else v = '';
  }
  if (typeof v === 'number' && String(cell.numFmt || '').includes('%')) v = Math.round(v * 10000) / 100;
  return typeof v === 'string' ? v.trim() : v ?? '';
}

function parseDate(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // DD/MM/YYYY (Indian)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString().slice(0, 10);
}

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,%\s₹]|Rs\.?|INR/gi, ''));
  return Number.isFinite(n) ? n : NaN;
};
const str = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());

// ---- FORM detection & parsing (client's template layout) -------------------
function sheetGrid(ws) {
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const cells = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cellVal(cell);
      if (v !== '' && v !== null) cells.push({ r, c, v, text: str(v) });
    });
    // collapse merged duplicates (merged ranges repeat the master value)
    const dedup = [];
    for (const cell of cells) { const last = dedup[dedup.length - 1]; if (!(last && last.text === cell.text && last.c === cell.c - 1 && (last.c2 = cell.c))) dedup.push({ ...cell, c2: cell.c }); }
    grid.push({ r, cells: dedup });
  });
  return grid;
}

const DOCNO_RE = /^(po|offer|invoice|quotation|quote|document)\s*no\.?\s*:?\s*(.*)$/i;
function isFormSheet(grid) {
  return grid.some((row) => row.cells.some((c) => /details of (vendor|customer|buyer|supplier)/i.test(c.text) || /^(po|offer|invoice|quotation)\s*no\.?\s*:/i.test(c.text)));
}

function parseForm(ws, type) {
  const grid = sheetGrid(ws);
  const all = grid.flatMap((row) => row.cells);
  const inline = (re) => { for (const c of all) { const m = c.text.match(re); if (m) { const val = m[m.length - 1].trim(); if (val) return val; const nxt = rightOf(c); return nxt ? nxt.v : ''; } } return ''; };
  const rowOf = (r) => grid.find((g) => g.r === r)?.cells || [];
  function rightOf(cell) {
    return rowOf(cell.r).filter((x) => x.c > cell.c2 && x.text !== ':' && norm(x.text) !== norm(cell.text))[0] || null;
  }
  const partyRow = all.find((c) => /details of/i.test(c.text))?.r || 0;
  const itemHead = all.find((c) => norm(c.text) === 'item description' || norm(c.text) === 'description');
  const itemRow = itemHead?.r || Infinity;
  /** label cell with exact text; value = next cell to the right */
  const labelled = (labels, { after = 0, before = Infinity } = {}) => {
    const set = labels.map(norm);
    for (const c of all) {
      if (c.r <= after || c.r >= before) continue;
      if (set.includes(norm(c.text))) { const v = rightOf(c); if (v && !set.includes(norm(v.text))) return v.v; }
      const m = c.text.match(/^(.+?)\s*:\s*(.+)$/); // "State : Gujarat" in one cell
      if (m && set.includes(norm(m[1]))) return m[2].trim();
    }
    return '';
  };

  const h = {
    doc_no: inline(DOCNO_RE),
    doc_date: parseDate(inline(/^(document|offer|invoice|po|quotation)\s*date\s*:?\s*(.*)$/i)),
    place_of_supply: inline(/^place\s*of\s*supply\s*:?\s*(.*)$/i),
    due_date: parseDate(labelled(['Offer Validity Date', 'Validity Date', 'Due Date'], { before: itemRow })),
    delivery_date: parseDate(labelled(['Delivery Date'], { before: itemRow })),
    contact_person: str(labelled(['Contact Person'], { before: partyRow || itemRow })),
    contact_phone: str(labelled(['Phone No', 'Phone'], { before: partyRow || itemRow })),
    contact_email: str(labelled(['Email'], { before: partyRow || itemRow })),
    party_code: str(labelled(['Vendor Code', 'Customer Code', 'Party Code'], { before: itemRow })),
    party_name: str(labelled(['Name'], { after: partyRow - 1, before: itemRow }) || labelled(['Vendor Name', 'Customer Name'], { before: itemRow })),
    party_address: str(labelled(['Address'], { after: partyRow - 1, before: itemRow })),
    party_state: str(labelled(['State'], { after: partyRow, before: itemRow })),
    party_state_code: str(labelled(['State Code'], { after: partyRow, before: itemRow })),
    party_gstin: str(labelled(['GST No', 'GST No.', 'GSTIN'], { after: partyRow - 1, before: itemRow })),
    payment_terms: str(labelled(['Payment Terms'], { before: itemRow })),
    transport: str(labelled(['Transport'], { before: itemRow })),
    remarks: inline(/^remarks\s*:?\s*([\s\S]*)$/i),
    terms: inline(/^general\s*conditions\s*:?\s*([\s\S]*)$/i).replace(/^[\s\n]+/, ''),
  };
  if (h.contact_person && /^(mr|ms|mrs)\.?$/i.test(h.contact_person)) h.contact_person = '';
  // Contact person in template sits beside 'Vendor Name' when Name is filled in the right panel only
  if (!h.party_name) h.party_name = str(labelled(['Vendor Name', 'Customer Name'], { before: itemRow }));

  // ---- items
  const items = [];
  const errors = [];
  if (itemHead) {
    const head1 = rowOf(itemRow), head2 = rowOf(itemRow + 1);
    const colOf = (names, row = head1) => row.find((c) => names.map(norm).includes(norm(c.text)))?.c;
    const groupRate = (g) => { // CGST spans K:N, 'Rate' under it in next row
      const gc = head1.find((c) => norm(c.text) === g);
      if (!gc) return undefined;
      const rate = head2.find((c) => norm(c.text) === 'rate' && c.c >= gc.c && c.c <= gc.c2);
      return rate ? rate.c : gc.c;
    };
    const cols = {
      item_code: colOf(['Item Code', 'Code', 'Part No']), description: itemHead.c, hsn: colOf(['HSN', 'HSN/SAC', 'HSN Code']),
      qty: colOf(['Qty', 'Quantity']), unit: colOf(['UOM', 'Unit']), rate: colOf(['Unit Price', 'Rate', 'Price']),
      discount_pct: colOf(['Disc', 'Disc %', 'Discount']), price_after_disc: colOf(['Price Af Disc', 'Price After Disc']),
      cgst_rate: groupRate('cgst'), sgst_rate: groupRate('sgst'), igst_rate: groupRate('igst'),
    };
    const startRow = head2.some((c) => norm(c.text) === 'rate' || norm(c.text) === 'amt') || head2.every((c) => head1.some((h1) => h1.c === c.c && h1.text === c.text)) ? itemRow + 2 : itemRow + 1;
    for (let r = startRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rowText = rowOf(r).map((c) => norm(c.text)).join(' | ');
      if (/sub total|amount in words|total gst/.test(rowText) && !cellVal(row.getCell(cols.description))) break;
      const get = (k) => (cols[k] ? cellVal(row.getCell(cols[k])) : '');
      // skip spacer rows that are one merged cell across the item columns
      const descCell = row.getCell(cols.description);
      if (descCell.isMerged && descCell.master.address !== descCell.address && descCell.master.col <= (cols.item_code || cols.description)) continue;
      if (cols.item_code && row.getCell(cols.item_code).isMerged && row.getCell(cols.item_code).master.address === descCell.master?.address) continue;
      const description = str(get('description'));
      const qty = toNum(get('qty'));
      if (!description && !str(get('item_code')) && !qty) continue;
      const line = {
        item_code: str(get('item_code')), description, hsn: str(get('hsn')), qty, unit: str(get('unit')),
        rate: toNum(get('rate')), discount_pct: toNum(get('discount_pct')), price_after_disc: toNum(get('price_after_disc')),
        cgst_rate: toNum(get('cgst_rate')), sgst_rate: toNum(get('sgst_rate')), igst_rate: toNum(get('igst_rate')), __row: r,
      };
      items.push(line);
    }
  } else errors.push('Could not find the item table (a header cell named "Item Description")');
  return { header: h, items, errors };
}

// ---- FLAT parsing -----------------------------------------------------------
function parseFlat(ws) {
  let headerRowNo = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const vals = []; ws.getRow(r).eachCell((c) => { if (cellVal(c) !== '') vals.push(c); });
    if (vals.length >= 3) { headerRowNo = r; break; }
  }
  const headers = [];
  ws.getRow(headerRowNo).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = str(cellVal(cell)) || `Column ${col}`; });
  const rows = [];
  for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = { __row: r };
    let any = false;
    headers.forEach((h, i) => { if (!h) return; const v = cellVal(row.getCell(i + 1)); obj[h] = v; if (v !== '') any = true; });
    if (any) rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows };
}

function suggestMapping(headers, type) {
  const mapping = {};
  const used = new Set();
  // exact label matches first, then aliases, so "Vendor Code" beats "Code"
  for (const pass of ['label', 'alias']) {
    for (const f of fieldsFor(type)) {
      if (mapping[f.key]) continue;
      const cands = pass === 'label' ? [norm(f.label), norm(f.key)] : f.aliases.map(norm);
      const idx = headers.findIndex((h, i) => !used.has(i) && cands.includes(norm(h)));
      if (idx >= 0) { mapping[f.key] = headers[idx]; used.add(idx); }
    }
  }
  return mapping;
}

function flatToCandidates(rows, mapping, type) {
  const get = (row, k) => (mapping[k] ? row[mapping[k]] : '');
  const groups = new Map();
  for (const row of rows) {
    const h = {};
    for (const f of fieldsFor(type).filter((x) => x.group !== 'item')) h[f.key] = get(row, f.key);
    for (const k of ['doc_date', 'due_date', 'delivery_date']) h[k] = parseDate(h[k]);
    for (const k of Object.keys(h)) if (!['doc_date', 'due_date', 'delivery_date'].includes(k)) h[k] = k === 'shipping' ? toNum(h[k]) : str(h[k]);
    const key = h.doc_no ? `no:${h.doc_no}` : h.doc_ref ? `ref:${h.doc_ref}` : `pd:${(h.party_code || h.party_name).toLowerCase()}|${h.doc_date || ''}`;
    if (!groups.has(key)) groups.set(key, { key, source: `Rows`, rows: [], header: null, items: [], shipping: 0 });
    const g = groups.get(key);
    g.rows.push(row.__row);
    if (!g.header) g.header = h;
    else for (const [k, v] of Object.entries(h)) if (!g.header[k] && v) g.header[k] = v; // fill blanks from later rows
    if (h.shipping) g.shipping += h.shipping;
    g.items.push({
      item_code: str(get(row, 'item_code')), description: str(get(row, 'description')), hsn: str(get(row, 'hsn')),
      qty: toNum(get(row, 'qty')), unit: str(get(row, 'unit')), rate: toNum(get(row, 'rate')),
      discount_pct: toNum(get(row, 'discount_pct')), price_after_disc: toNum(get(row, 'price_after_disc')),
      cgst_rate: toNum(get(row, 'cgst_rate')), sgst_rate: toNum(get(row, 'sgst_rate')), igst_rate: toNum(get(row, 'igst_rate')),
      tax_rate: toNum(get(row, 'tax_rate')), __row: row.__row,
    });
  }
  return [...groups.values()].map((g) => ({ ...g, source: `Rows ${g.rows[0]}${g.rows.length > 1 ? '–' + g.rows[g.rows.length - 1] : ''}` }));
}

// ---- validation shared by both modes ---------------------------------------
function validate(companyId, type, cands, { create_products = true } = {}) {
  const cfg = kindOf(type);
  const seenNos = new Set();
  for (const c of cands) {
    c.errors = c.errors || [];
    c.warnings = c.warnings || [];
    const h = c.header || {};
    if (!h.party_name && !h.party_code) c.errors.push(`${PARTY_WORD[type]} name is missing`);
    if (h.party_code && !h.party_name && !db.prepare(`SELECT 1 FROM ${cfg.party} WHERE company_id = ? AND code = ?`).get(companyId, h.party_code))
      c.errors.push(`${PARTY_WORD[type]} code ${h.party_code} not found and no name given`);
    for (const k of ['doc_date', 'due_date', 'delivery_date']) if (h[k] === 'invalid') c.errors.push(`${k.replace('_', ' ')} is not a valid date (use DD/MM/YYYY)`);
    if (h.doc_no) {
      if (seenNos.has(h.doc_no)) c.errors.push(`${h.doc_no} appears twice in the upload`);
      seenNos.add(h.doc_no);
      if (db.prepare(`SELECT 1 FROM ${cfg.table} WHERE company_id = ? AND doc_no = ?`).get(companyId, h.doc_no)) c.errors.push(`${DOC_WORD[type]} No. ${h.doc_no} already exists`);
    }
    if (!c.items.length) c.errors.push('No line items found');
    let est = 0;
    c.items.forEach((it, i) => {
      const where = it.__row ? `Row ${it.__row}` : `Line ${i + 1}`;
      const product = it.item_code ? db.prepare('SELECT * FROM products WHERE company_id = ? AND sku = ?').get(companyId, it.item_code) : null;
      if (!it.description && !product) c.errors.push(`${where}: item description is missing`);
      if (it.qty === null || Number.isNaN(it.qty) || it.qty <= 0) c.errors.push(`${where}: Qty must be a number greater than 0`);
      if ((it.rate === null && !product) || Number.isNaN(it.rate) || it.rate < 0) c.errors.push(`${where}: Unit Price must be a valid number`);
      if (['discount_pct', 'price_after_disc', 'cgst_rate', 'sgst_rate', 'igst_rate', 'tax_rate'].some((k) => Number.isNaN(it[k]))) c.errors.push(`${where}: Disc / GST values must be numbers`);
      if (it.item_code && !product) c.warnings.push(`${where}: item code ${it.item_code} is new${create_products ? ' – will be added to inventory' : ' – stock not tracked'}`);
      const rate = it.rate ?? product?.[cfg.priceField] ?? 0;
      const net = it.price_after_disc ?? rate * (1 - (it.discount_pct || 0) / 100);
      const tax = it.tax_rate ?? ((it.cgst_rate || 0) + (it.sgst_rate || 0) || it.igst_rate || product?.tax_rate || 0);
      est += (it.qty || 0) * net * (1 + tax / 100);
    });
    c.total_estimate = Math.round(est + (c.shipping || 0));
  }
  return cands;
}

function findOrCreateParty(companyId, type, h) {
  const cfg = kindOf(type);
  const t = cfg.party;
  let p = null;
  if (h.party_code) p = db.prepare(`SELECT * FROM ${t} WHERE company_id = ? AND code = ?`).get(companyId, h.party_code);
  if (!p && h.party_gstin) p = db.prepare(`SELECT * FROM ${t} WHERE company_id = ? AND UPPER(gstin) = UPPER(?)`).get(companyId, h.party_gstin);
  if (!p && h.party_name) p = db.prepare(`SELECT * FROM ${t} WHERE company_id = ? AND LOWER(name) = LOWER(?)`).get(companyId, h.party_name);
  const state = h.party_state || (h.party_state_code ? STATES[String(h.party_state_code).padStart(2, '0')] : '') || '';
  const data = {
    code: h.party_code, name: h.party_name, address: h.party_address, city: h.party_city, state, gstin: (h.party_gstin || '').toUpperCase(),
    phone: h.party_phone, email: h.party_email,
  };
  if (p) {
    const fill = Object.entries(data).filter(([k, v]) => v && !p[k]);
    if (fill.length) db.prepare(`UPDATE ${t} SET ${fill.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...fill.map(([, v]) => v), p.id);
    p = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(p.id);
    db.prepare(`UPDATE ${t} SET state_code = ? WHERE id = ?`).run(stateCodeFor(p.state, p.gstin) || (h.party_state_code ? String(h.party_state_code).padStart(2, '0') : null), p.id);
    return { party: p, created: false };
  }
  const code = h.party_state_code ? String(h.party_state_code).padStart(2, '0') : stateCodeFor(state, data.gstin);
  const r = db.prepare(`INSERT INTO ${t} (company_id, code, name, address, city, state, state_code, gstin, phone, email) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(companyId, data.code || null, data.name, data.address || null, data.city || null, state || null, code || null, data.gstin || null, data.phone || null, data.email || null);
  return { party: db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(r.lastInsertRowid), created: true };
}

function ensureProducts(companyId, type, items) {
  const cfg = kindOf(type);
  let created = 0;
  for (const it of items) {
    if (!it.item_code) continue;
    if (db.prepare('SELECT 1 FROM products WHERE company_id = ? AND sku = ?').get(companyId, it.item_code)) continue;
    const tax = it.tax_rate ?? ((it.cgst_rate || 0) + (it.sgst_rate || 0) || it.igst_rate || 18);
    const price = it.price_after_disc ?? it.rate ?? 0;
    db.prepare(`INSERT INTO products (company_id, sku, name, hsn, unit, type, ${cfg.priceField}, tax_rate) VALUES (?,?,?,?,?,?,?,?)`)
      .run(companyId, it.item_code, it.description || it.item_code, it.hsn || null, it.unit || 'Nos', type === 'po' ? 'raw' : 'finished', price, tax);
    created++;
  }
  return created;
}

// ---- uploads in memory --------------------------------------------------------
const uploads = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of uploads) if (v.expires < now) uploads.delete(k); }, 10 * 60 * 1000).unref();

// ---- Routes -------------------------------------------------------------------
router.get('/fields', (req, res) => res.json(publicFields(req.query.type || 'invoice')));

router.get('/template', async (req, res) => {
  const type = KINDS[req.query.type] ? req.query.type : 'invoice';
  const P = PARTY_WORD[type];
  const fields = fieldsFor(type).filter((f) => !['tax_rate', 'party_city'].includes(f.key));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${DOC_WORD[type]} Upload`);
  ws.columns = fields.map((f) => ({ header: f.label.replace(' *', ''), key: f.key, width: Math.max(11, f.label.length + 3) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { wrapText: true, vertical: 'middle' };
  fields.forEach((f, i) => {
    const color = f.group === 'item' ? 'FFE8620C' : f.group === 'party' ? 'FF2E5C9E' : 'FF0B3A8C';
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });
  head.height = 32;
  const d = new Date();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId);
  const sample = [
    { doc_ref: 1, doc_date: d, delivery_date: new Date(d.getTime() + 10 * 864e5), contact_person: 'Mr. Sharma', contact_phone: company.phone || '7300192148', contact_email: company.email || '', place_of_supply: 'Jaipur Rajasthan',
      party_code: `${type === 'po' ? 'V' : 'C'}-001`, party_name: type === 'po' ? 'Shree Steel Suppliers' : 'Rajasthan Engineering Works', party_address: 'Plot 22, VKI Area, Jaipur', party_state: 'Rajasthan', party_state_code: '08', party_gstin: '08ABCDE1234F1Z5', party_phone: '9876543210', party_email: 'accounts@example.com',
      payment_terms: 'Against PI', transport: 'By Road', item_code: 'HC-50', description: 'Hydraulic Cylinder 50mm Bore', hsn: '8412', qty: 10, unit: 'Nos', rate: 4500, discount_pct: 5, cgst_rate: 9, sgst_rate: 9 },
    { doc_ref: 1, item_code: 'HS-12', description: 'Hydraulic Hose 1/2" x 1m', hsn: '4009', qty: 25, unit: 'Nos', rate: 380, discount_pct: 0, cgst_rate: 9, sgst_rate: 9 },
    { doc_ref: 2, doc_date: d, contact_person: 'Mr. Sharma', place_of_supply: 'Ahmedabad Gujarat', party_code: `${type === 'po' ? 'V' : 'C'}-002`, party_name: type === 'po' ? 'Gujarat Seals Pvt Ltd' : 'Gujarat Fluid Power', party_address: 'GIDC Vatva, Ahmedabad', party_state: 'Gujarat', party_state_code: '24', party_gstin: '24AAACG5555K1Z2', party_phone: '9123456780',
      payment_terms: '30 Days', transport: 'Courier', item_code: 'PU-20', description: 'Gear Pump 20 LPM', hsn: '8413', qty: 4, unit: 'Nos', rate: 12500, igst_rate: 18, remarks: 'Inter-state: use IGST' },
  ];
  if (type === 'quotation') sample[0].due_date = new Date(d.getTime() + 15 * 864e5);
  if (type === 'invoice') sample[0].due_date = new Date(d.getTime() + 15 * 864e5);
  sample.forEach((s) => ws.addRow(s));
  ws.columns.forEach((col) => { if (['doc_date', 'due_date', 'delivery_date'].includes(col.key)) col.numFmt = 'dd/mm/yyyy'; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const info = wb.addWorksheet('Instructions');
  info.getColumn(1).width = 28; info.getColumn(2).width = 100;
  const lines = [
    ['HOW TO USE'],
    ['', 'One row = one line item. Rows with the same "Doc Ref" (or same Doc No.) become ONE document with many items.'],
    ['', `Document details (dates, ${P.toLowerCase()}, terms) only need to be filled on the first row of each document.`],
    ['', 'Leave Doc No. empty for automatic numbering (e.g. MCH/2026-27/001).'],
    ['', `${P}s are matched by ${P} Code, then GST No., then Name. New ${P.toLowerCase()}s are created automatically.`],
    ['', 'Items are matched to inventory by Item Code. New item codes are added to inventory automatically.'],
    ['', 'Same state: fill CGST Rate + SGST Rate (e.g. 9 + 9). Other state: fill IGST Rate (e.g. 18). The system decides CGST/SGST vs IGST from the GST No./State.'],
    ['', 'Disc is a percentage. You can instead fill "Price Af Disc" and the discount is calculated.'],
    ['', 'Dates: DD/MM/YYYY. Your own column names also work: you can match them on the upload screen.'],
    ['', 'You can ALSO upload your filled PO / Quotation form files directly (one document per sheet), several files at once.'],
    [],
    ['COLUMN', 'MEANING'],
    ...fields.map((f) => [f.label, f.required ? 'Required' : f.group === 'item' ? 'Line item field' : f.group === 'party' ? `${P} details` : 'Document details']),
  ];
  lines.forEach((l, i) => { const row = info.addRow(l); if (i === 0 || l[0] === 'COLUMN') row.font = { bold: true, size: 12 }; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-${type}-template.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// the client's own blank form templates (filled copies can be uploaded directly)
router.get('/form-template', (req, res) => {
  const path = require('path');
  const file = req.query.type === 'quotation' ? 'Quotation_Template.xlsx' : 'PO_Template.xlsx';
  res.download(path.join(__dirname, '..', '..', 'assets', file), file);
});

router.post('/parse', upload.array('files', 100), async (req, res) => {
  const type = KINDS[req.query.type || req.body.type] ? req.query.type || req.body.type : 'invoice';
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'Choose one or more Excel (.xlsx) files');
  const forms = [];
  let flat = null;
  const fileErrors = [];
  for (const f of files) {
    try {
      const wb = new ExcelJS.Workbook();
      if (/\.csv$/i.test(f.originalname)) await wb.csv.read(require('stream').Readable.from(f.buffer));
      else await wb.xlsx.load(f.buffer);
      for (const ws of wb.worksheets) {
        if (!ws.actualRowCount || /instruction/i.test(ws.name)) continue;
        const grid = sheetGrid(ws);
        if (isFormSheet(grid)) {
          const parsed = parseForm(ws, type);
          forms.push({ file: f.originalname, sheet: ws.name, ...parsed });
        } else {
          const p = parseFlat(ws);
          if (!p.rows.length) continue;
          p.rows.forEach((r) => { r.__file = f.originalname; });
          if (!flat) flat = { headers: p.headers, rows: p.rows, files: [f.originalname] };
          else { flat.headers = [...new Set([...flat.headers, ...p.headers])]; flat.rows.push(...p.rows); flat.files.push(f.originalname); }
        }
      }
    } catch (e) {
      fileErrors.push(`${f.originalname}: could not read file (${e.message}). Save it as .xlsx and try again.`);
    }
  }
  if (!forms.length && !flat) throw new HttpError(400, fileErrors[0] || 'No data found in the uploaded file(s)');
  const uploadId = crypto.randomUUID();
  uploads.set(uploadId, { companyId: req.companyId, type, forms, flat, fileNames: files.map((f) => f.originalname).join(', '), expires: Date.now() + 60 * 60 * 1000 });
  res.json({
    uploadId, type, fileErrors,
    forms: forms.map((f) => ({ file: f.file, sheet: f.sheet, doc_no: f.header.doc_no, party: f.header.party_name, items: f.items.length })),
    flat: flat && {
      files: flat.files, headers: flat.headers, totalRows: flat.rows.length, mapping: suggestMapping(flat.headers, type),
      sample: flat.rows.slice(0, 5).map((r) => Object.fromEntries(flat.headers.map((h) => [h, r[h] instanceof Date ? r[h].toISOString().slice(0, 10) : r[h]]))),
    },
    fields: publicFields(type),
  });
});

router.post('/import', async (req, res) => {
  const { uploadId, mapping = {}, dry_run, options = {} } = req.body || {};
  const up = uploads.get(uploadId);
  if (!up || up.companyId !== req.companyId) throw new HttpError(400, 'Upload expired, please upload the file again');
  const { type } = up;
  const cfg = kindOf(type);
  let cands = up.forms.map((f) => ({
    key: `${f.file}#${f.sheet}`, source: `${f.file}${f.sheet && !/^(sheet1|table 1)$/i.test(f.sheet) ? ' › ' + f.sheet : ''}`,
    header: f.header, items: f.items.map((x) => ({ ...x })), errors: [...f.errors], shipping: 0,
  }));
  if (up.flat) {
    const missing = fieldsFor(type).filter((f) => f.required && !mapping[f.key]
      && !(f.key === 'party_name' && mapping.party_code) && !(['description', 'rate'].includes(f.key) && mapping.item_code));
    if (missing.length) throw new HttpError(400, `Match these required columns: ${missing.map((f) => f.label.replace(' *', '')).join(', ')}`);
    cands = cands.concat(flatToCandidates(up.flat.rows, mapping, type));
  }
  validate(req.companyId, type, cands, options);
  const summary = {
    type, documents: cands.length, valid: cands.filter((c) => !c.errors.length).length,
    docs: cands.map((c) => ({
      key: c.key, source: c.source, doc_no: c.header?.doc_no || '(auto)', party: c.header?.party_name || c.header?.party_code || '',
      date: c.header?.doc_date || today(), items: c.items.length, total_estimate: c.total_estimate, errors: c.errors, warnings: c.warnings,
    })),
  };
  summary.invalid = summary.documents - summary.valid;
  if (dry_run) return res.json(summary);

  const batchId = db.prepare('INSERT INTO bulk_batches (company_id, doc_type, file_name, total_rows, user_id) VALUES (?,?,?,?,?)')
    .run(req.companyId, type, up.fileNames, cands.reduce((s, c) => s + c.items.length, 0), req.user.id).lastInsertRowid;
  const created = [];
  const failed = cands.filter((c) => c.errors.length).map((c) => ({ source: c.source, errors: c.errors }));
  let partiesCreated = 0, productsCreated = 0;
  for (const c of cands.filter((x) => !x.errors.length)) {
    try {
      const doc = db.transaction(() => {
        const h = c.header;
        const { party, created: isNew } = findOrCreateParty(req.companyId, type, h);
        if (isNew) partiesCreated++;
        if (options.create_products !== false) productsCreated += ensureProducts(req.companyId, type, c.items);
        const status = type === 'invoice' ? (options.status === 'draft' ? 'draft' : 'unpaid') : 'draft';
        const d = createDoc(type, req.companyId, req.user, {
          doc_no: h.doc_no || '', party_id: party.id, doc_date: h.doc_date || today(), due_date: h.due_date || undefined,
          delivery_date: h.delivery_date || undefined, place_of_supply: h.place_of_supply || undefined,
          contact_person: h.contact_person || undefined, contact_phone: h.contact_phone || undefined, contact_email: h.contact_email || undefined,
          payment_terms: h.payment_terms || undefined, transport: h.transport || undefined, reference: h.reference || undefined,
          remarks: h.remarks || undefined, terms: h.terms || undefined, shipping: c.shipping || 0,
          items: c.items.map(({ __row, ...it }) => it), status,
        }, { source: 'bulk', batchId, status });
        if (type === 'invoice' && status !== 'draft') applyInvoiceStock(d, -1, req.user.id);
        return d;
      })();
      created.push({ id: doc.id, doc_no: doc.doc_no, total: doc.total, source: c.source });
    } catch (e) {
      failed.push({ source: c.source, errors: [e.message] });
    }
  }
  db.prepare('UPDATE bulk_batches SET docs_created = ?, errors = ? WHERE id = ?').run(created.length, JSON.stringify(failed), batchId);
  uploads.delete(uploadId);
  res.json({ type, batchId, created, failed, partiesCreated, productsCreated, label: cfg.label });
});

router.get('/batches', (req, res) => {
  res.json(db.prepare(`SELECT b.*, u.name AS user_name FROM bulk_batches b LEFT JOIN users u ON u.id = b.user_id
    WHERE b.company_id = ? ORDER BY b.id DESC LIMIT 100`).all(req.companyId).map((b) => ({ ...b, errors: b.errors ? JSON.parse(b.errors) : [] })));
});

module.exports = router;
module.exports._test = { parseForm, sheetGrid, isFormSheet };
