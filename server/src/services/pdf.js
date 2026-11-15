/**
 * PDF layout modelled on the client's PO / Quotation Excel templates:
 *  company block + logo/title | document meta | party details | item grid with CGST/SGST (or IGST) | totals | words | remarks | conditions
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { DATA_DIR } = require('../db');
const { amountInWords, STATES, stateCodeFor } = require('./util');

const BLUE = '#0b3a8c';
const ORANGE = '#e8620c';
const BORDER = '#000000';
const HEAD_BG = '#e9eef8';
const L = 28, W = 539, R = L + W; // A4 = 595pt wide

const num = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(3).replace(/0+$/, ''));
const fmtDate = (d) => { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}/${y}`; };

const TITLES = { invoice: (c) => (c.gstin ? 'Tax Invoice' : 'Invoice'), quotation: () => 'Quotation', po: () => 'Purchase Order' };
const NO_LABEL = { invoice: 'Invoice No.', quotation: 'Offer No.', po: 'PO No.' };
const DATE_LABEL = { invoice: 'Invoice Date', quotation: 'Offer Date', po: 'Document Date' };
const PARTY_LABEL = { invoice: 'Customer', quotation: 'Customer', po: 'Vendor' };

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function box(doc, x, y, w, h, fill) {
  if (fill) doc.rect(x, y, w, h).fill(fill);
  doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(BORDER).stroke();
}

function logoPath(company) {
  if (!company.logo_path) return null;
  const p = path.join(DATA_DIR, 'uploads', path.basename(company.logo_path));
  return fs.existsSync(p) ? p : null;
}

/** label : value rows; returns bottom y */
function kvRows(doc, x, y, rows, { labelW = 95, w = 260, size = 8 } = {}) {
  let yy = y;
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(size).fillColor('#000').text(label, x, yy, { width: labelW });
    doc.text(':', x + labelW, yy, { width: 8 });
    doc.font('Helvetica').text(value == null ? '' : String(value), x + labelW + 10, yy, { width: w - labelW - 12 });
    yy = Math.max(doc.y, yy + size + 3) + 2;
  }
  return yy;
}

function renderHeader(doc, kind, company, d) {
  let y = 28;
  // --- top block: company left, logo + title right
  const leftW = 330;
  const topH = 92;
  box(doc, L, y, W, topH);
  doc.moveTo(L + leftW, y).lineTo(L + leftW, y + topH).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BLUE).text((company.legal_name || company.name || '').toUpperCase(), L + 6, y + 6, { width: leftW - 12 });
  doc.font('Helvetica').fontSize(7.8).fillColor('#000');
  const addr = [company.address, [company.city, company.state].filter(Boolean).join(' ') + (company.pincode ? ` - ${company.pincode}` : '')].filter((s) => s && s.trim()).join(', ');
  if (addr) doc.text(addr, { width: leftW - 12 });
  if (company.email) doc.text(`Email - ${company.email}`, { width: leftW - 12 });
  if (company.phone) doc.text(`Phone - ${company.phone}`, { width: leftW - 12 });
  const ids = [company.pan && `PAN - ${company.pan}`, company.gstin && `GST - ${company.gstin}`].filter(Boolean).join(' & ');
  if (ids) doc.font('Helvetica-Bold').text(ids, { width: leftW - 12 });

  const rx = L + leftW + 6, rw = W - leftW - 12;
  const lp = logoPath(company);
  if (lp) { try { doc.image(lp, rx + (rw - 110) / 2, y + 4, { fit: [110, 58], align: 'center' }); } catch { /* bad image */ } }
  else doc.font('Helvetica-Bold').fontSize(14).fillColor(BLUE).text(company.name || '', rx, y + 20, { width: rw, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(TITLES[kind](company), rx, y + topH - 22, { width: rw, align: 'center' });
  y += topH;

  // --- meta block
  const half = 300;
  const companyState = company.state || STATES[company.state_code] || '';
  const companyCode = company.state_code || stateCodeFor(company.state, company.gstin) || '';
  const metaLeft = [
    [NO_LABEL[kind], d.doc_no],
    [DATE_LABEL[kind], fmtDate(d.doc_date)],
    ['State', companyState],
    ['State Code', companyCode],
    ['Place of Supply', d.place_of_supply || ''],
  ];
  const secondDate = kind === 'quotation' ? ['Offer Validity Date', fmtDate(d.due_date)]
    : kind === 'invoice' ? ['Due Date', fmtDate(d.due_date)] : ['Delivery Date', fmtDate(d.delivery_date)];
  const metaRight = [secondDate, ['Contact Person', d.contact_person], ['Phone No', d.contact_phone], ['Email', d.contact_email]];
  if (kind !== 'po' && d.reference) metaRight.push([kind === 'invoice' ? 'Customer PO No.' : 'Enquiry Ref', d.reference]);
  if (kind === 'po' && d.reference) metaRight.push(['Vendor Quote Ref', d.reference]);
  const y1 = kvRows(doc, L + 6, y + 5, metaLeft, { labelW: 85, w: half - 10 });
  const y2 = kvRows(doc, L + half + 6, y + 5, metaRight, { labelW: 92, w: W - half - 10 });
  const metaH = Math.max(y1, y2) - y + 3;
  box(doc, L, y, W, metaH);
  doc.moveTo(L + half, y).lineTo(L + half, y + metaH).stroke();
  y += metaH;

  // --- party block
  box(doc, L, y, W, 14, HEAD_BG);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(`Details of ${PARTY_LABEL[kind]} :`, L + 6, y + 3.5);
  y += 14;
  const p = d.party || {};
  const pState = p.state || STATES[p.state_code] || '';
  const pCode = p.state_code || stateCodeFor(p.state, p.gstin) || '';
  const partyAddr = [p.address, [p.city, p.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  const pl = kvRows(doc, L + 6, y + 5, [
    ['Name', p.name], ['Address', partyAddr], ['State', pState], ['State Code', pCode], ['GST No.', p.gstin || ''],
  ], { labelW: 60, w: half - 10 });
  const rightRows = [[`${PARTY_LABEL[kind]} Code`, p.code || ''], [`${PARTY_LABEL[kind]} Name`, p.contact_person || p.name], ['Payment Terms', d.payment_terms || ''], ['Transport', d.transport || '']];
  if (kind !== 'po' || d.delivery_date) rightRows.push(['Delivery Date', fmtDate(d.delivery_date)]);
  if (p.phone || p.email) rightRows.push(['Contact', [p.phone, p.email].filter(Boolean).join(' / ')]);
  const pr = kvRows(doc, L + half + 6, y + 5, rightRows, { labelW: 92, w: W - half - 10 });
  const partyH = Math.max(pl, pr) - y + 3;
  box(doc, L, y, W, partyH);
  doc.moveTo(L + half, y).lineTo(L + half, y + partyH).stroke();
  y += partyH;
  if (kind === 'po' && d.delivery_address) {
    const h = doc.font('Helvetica').fontSize(8).heightOfString(d.delivery_address, { width: W - 100 }) + 8;
    box(doc, L, y, W, h);
    doc.font('Helvetica-Bold').text('Deliver To :', L + 6, y + 4);
    doc.font('Helvetica').text(d.delivery_address, L + 90, y + 4, { width: W - 100 });
    y += h;
  }
  return y;
}

function columns(interstate) {
  const base = [
    { key: 'sn', label: 'Sr No.', w: 22, align: 'center' },
    { key: 'code', label: 'Item Code', w: 44 },
    { key: 'desc', label: 'Item Description', w: 84 },
    { key: 'hsn', label: 'HSN', w: 38, align: 'center' },
    { key: 'qty', label: 'Qty', w: 32, align: 'right' },
    { key: 'uom', label: 'UOM', w: 30, align: 'center' },
    { key: 'rate', label: 'Unit Price', w: 42, align: 'right' },
    { key: 'disc', label: 'Disc', w: 28, align: 'right' },
    { key: 'pad', label: 'Price Af Disc', w: 40, align: 'right' },
  ];
  const tax = interstate
    ? [{ key: 'ir', label: 'Rate', w: 34, align: 'right', group: 'IGST' }, { key: 'ia', label: 'Amt.', w: 94, align: 'right', group: 'IGST' }]
    : [
      { key: 'cr', label: 'Rate', w: 24, align: 'right', group: 'CGST' }, { key: 'ca', label: 'Amt.', w: 40, align: 'right', group: 'CGST' },
      { key: 'sr', label: 'Rate', w: 24, align: 'right', group: 'SGST' }, { key: 'sa', label: 'Amt.', w: 40, align: 'right', group: 'SGST' },
    ];
  return [...base, ...tax, { key: 'total', label: 'Total Amount', w: 51, align: 'right' }];
}

function tableHead(doc, y, cols) {
  const h1 = 12, h2 = 12;
  box(doc, L, y, W, h1 + h2, HEAD_BG);
  let x = L;
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
  const groups = {};
  for (const c of cols) {
    if (c.group) {
      groups[c.group] = groups[c.group] || { x, w: 0 };
      groups[c.group].w += c.w;
      doc.text(c.label, x + 2, y + h1 + 3, { width: c.w - 4, align: 'center' });
      doc.moveTo(x, y + h1).lineTo(x, y + h1 + h2).stroke();
    } else {
      doc.text(c.label, x + 2, y + 3, { width: c.w - 4, align: 'center', height: h1 + h2 - 4 });
      doc.moveTo(x, y).lineTo(x, y + h1 + h2).stroke();
    }
    x += c.w;
  }
  for (const [g, { x: gx, w }] of Object.entries(groups)) {
    doc.text(g, gx, y + 3, { width: w, align: 'center' });
    doc.moveTo(gx, y + h1).lineTo(gx + w, y + h1).stroke();
    doc.moveTo(gx, y).lineTo(gx, y + h1 + h2).stroke();
  }
  return y + h1 + h2;
}

function renderItems(doc, y, d) {
  const cols = columns(d.is_interstate);
  y = tableHead(doc, y, cols);
  doc.font('Helvetica').fontSize(7.5);
  d.items.forEach((it, i) => {
    const pad = it.rate * (1 - (it.discount_pct || 0) / 100);
    const half = (it.tax_amount || 0) / 2;
    const row = {
      sn: i + 1, code: it.item_code || '', desc: it.description, hsn: it.hsn || '', qty: qtyFmt(it.qty), uom: it.unit || '',
      rate: num(it.rate), disc: it.discount_pct ? `${+it.discount_pct}%` : '-', pad: num(pad),
      cr: `${+(it.tax_rate / 2).toFixed(2)}%`, ca: num(half), sr: `${+(it.tax_rate / 2).toFixed(2)}%`, sa: num(it.tax_amount - Math.round(half * 100) / 100),
      ir: `${+it.tax_rate}%`, ia: num(it.tax_amount), total: num(it.amount),
    };
    const h = Math.max(...cols.map((c) => doc.heightOfString(String(row[c.key]), { width: c.w - 4 }))) + 6;
    if (y + h > 800) { doc.addPage(); y = tableHead(doc, 28, cols); doc.font('Helvetica').fontSize(7.5); }
    let x = L;
    for (const c of cols) {
      doc.fillColor('#000').text(String(row[c.key]), x + 2, y + 3, { width: c.w - 4, align: c.align || 'left' });
      doc.moveTo(x, y).lineTo(x, y + h).stroke();
      x += c.w;
    }
    doc.moveTo(R, y).lineTo(R, y + h).stroke();
    doc.moveTo(L, y + h).lineTo(R, y + h).stroke();
    y += h;
  });
  return y;
}

function renderTotals(doc, y, kind, company, d) {
  const rows = [['Sub Total', d.taxable_total]];
  if (d.is_interstate) rows.push(['Add : IGST', d.igst]);
  else { rows.push(['Add : CGST', d.cgst]); rows.push(['Add : SGST', d.sgst]); }
  rows.push(['Total GST', d.tax_total]);
  if (d.shipping) rows.push(['Freight / Transport', d.shipping]);
  if (d.round_off) rows.push(['Round Off', d.round_off]);
  const rowH = 13;
  const h = rowH * (rows.length + 1);
  if (y + h + 120 > 820) { doc.addPage(); y = 28; }
  const lx = L + 300, lw = 150, vw = W - 300 - lw;
  box(doc, L, y, W, h);
  doc.moveTo(lx, y).lineTo(lx, y + h).stroke();
  doc.moveTo(lx + lw, y).lineTo(lx + lw, y + h).stroke();
  // left side of totals: bank details for invoices, item count otherwise
  doc.font('Helvetica').fontSize(7.8).fillColor('#000');
  if (kind === 'invoice' && (company.bank_name || company.bank_account)) {
    doc.font('Helvetica-Bold').text('Bank Details', L + 6, y + 4);
    doc.font('Helvetica').text([
      company.bank_name && `Bank : ${company.bank_name}${company.bank_branch ? ', ' + company.bank_branch : ''}`,
      company.bank_account && `A/C No. : ${company.bank_account}`,
      company.bank_ifsc && `IFSC : ${company.bank_ifsc}`,
      company.upi_id && `UPI : ${company.upi_id}`,
    ].filter(Boolean).join('\n'), L + 6, doc.y + 1, { width: 288 });
  } else {
    const totalQty = d.items.reduce((s, it) => s + Number(it.qty || 0), 0);
    doc.text(`Total items : ${d.items.length}     Total qty : ${qtyFmt(totalQty)}`, L + 6, y + 4, { width: 288 });
  }
  let yy = y;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(8).text(k, lx + 6, yy + 3, { width: lw - 12 });
    doc.font('Helvetica').text(num(v), lx + lw + 4, yy + 3, { width: vw - 8, align: 'right' });
    yy += rowH;
    doc.moveTo(lx, yy).lineTo(R, yy).stroke();
  }
  doc.rect(lx, yy, W - 300, rowH).fill(HEAD_BG);
  doc.rect(lx, yy, W - 300, rowH).stroke();
  doc.moveTo(lx + lw, yy).lineTo(lx + lw, yy + rowH).stroke();
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(9).text('Total', lx + 6, yy + 2.5, { width: lw - 12 });
  doc.text(num(d.total), lx + lw + 4, yy + 2.5, { width: vw - 8, align: 'right' });
  return y + h;
}

function textRow(doc, y, label, text, { minH = 16, bold = false } = {}) {
  const body = String(text || '');
  doc.font('Helvetica').fontSize(7.8);
  const h = Math.max(minH, doc.heightOfString(`${label} ${body}`, { width: W - 12 }) + 8);
  if (y + h > 815) { doc.addPage(); y = 28; }
  box(doc, L, y, W, h);
  doc.font('Helvetica-Bold').fillColor('#000').text(label, L + 6, y + 4, { continued: !!body });
  if (body) doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(` ${body}`);
  return y + h;
}

function renderFooter(doc, y, kind, company, d) {
  y = textRow(doc, y, 'Amount in Words :', amountInWords(d.total, company.currency), { bold: true });
  y = textRow(doc, y, 'Remarks :', d.remarks || '');
  const terms = d.terms ? d.terms.split(/\r?\n/).filter(Boolean).map((t) => (/^[·•\-\d]/.test(t.trim()) ? t.trim() : `· ${t.trim()}`)).join('\n') : '';
  // General conditions (left) + signature (right)
  doc.font('Helvetica').fontSize(7.8);
  const termsH = terms ? doc.heightOfString(terms, { width: 330 }) : 0;
  const h = Math.max(70, termsH + 22);
  if (y + h > 815) { doc.addPage(); y = 28; }
  box(doc, L, y, W, h);
  doc.moveTo(L + 340, y).lineTo(L + 340, y + h).stroke();
  doc.font('Helvetica-Bold').text('General Conditions :', L + 6, y + 4);
  if (terms) doc.font('Helvetica').text(terms, L + 6, y + 15, { width: 330 });
  doc.font('Helvetica-Bold').fontSize(8).text(`For ${(company.legal_name || company.name || '').toUpperCase()}`, L + 344, y + 5, { width: W - 350, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#444').text('Authorised Signatory', L + 344, y + h - 13, { width: W - 350, align: 'center' });
  y += h;
  if (company.tagline) doc.font('Helvetica-Bold').fontSize(7).fillColor(ORANGE).text(company.tagline.toUpperCase(), L, y + 5, { width: W, align: 'center', characterSpacing: 1 });
  if (d.status === 'draft' || d.status === 'cancelled') {
    doc.save().rotate(-30, { origin: [300, 420] }).font('Helvetica-Bold').fontSize(70).fillColor('#cc0000').opacity(0.08)
      .text(d.status.toUpperCase(), 90, 380, { width: 420, align: 'center' }).restore();
  }
}

async function documentPdf(kind, company, d) {
  const doc = new PDFDocument({ size: 'A4', margin: 28, info: { Title: `${TITLES[kind](company)} ${d.doc_no}` } });
  let y = renderHeader(doc, kind, company, d);
  y = renderItems(doc, y, d);
  y = renderTotals(doc, y, kind, company, d);
  renderFooter(doc, y, kind, company, d);
  return toBuffer(doc);
}

const pdfFileName = (kind, d) => `${{ invoice: 'Invoice', quotation: 'Quotation', po: 'PO' }[kind]}-${String(d.doc_no).replace(/[^\w.-]+/g, '_')}.pdf`;

module.exports = { documentPdf, pdfFileName };
