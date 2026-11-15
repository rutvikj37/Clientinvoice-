const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

function stateCodeFor(state, gstin) {
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  if (!state) return null;
  const s = String(state).trim().toLowerCase();
  for (const [code, name] of Object.entries(STATES)) if (name.toLowerCase() === s) return code;
  return null;
}

/**
 * Compute line + header totals for an invoice or PO.
 * items: [{qty, rate, discount_pct, tax_rate}]
 */
function computeTotals(items, { interstate = false, shipping = 0, roundOff = true } = {}) {
  let subtotal = 0, discountTotal = 0, taxable = 0, tax = 0;
  const lines = items.map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const gross = round2(qty * rate);
    const disc = round2(gross * (Number(it.discount_pct) || 0) / 100);
    const taxableAmount = round2(gross - disc);
    const taxAmount = round2(taxableAmount * (Number(it.tax_rate) || 0) / 100);
    subtotal += gross; discountTotal += disc; taxable += taxableAmount; tax += taxAmount;
    return { ...it, qty, rate, taxable_amount: taxableAmount, tax_amount: taxAmount, amount: round2(taxableAmount + taxAmount) };
  });
  tax = round2(tax);
  const cgst = interstate ? 0 : round2(tax / 2);
  const sgst = interstate ? 0 : round2(tax - cgst);
  const igst = interstate ? tax : 0;
  const raw = round2(taxable + tax + (Number(shipping) || 0));
  const total = roundOff ? Math.round(raw) : raw;
  return {
    lines,
    subtotal: round2(subtotal), discount_total: round2(discountTotal), taxable_total: round2(taxable),
    cgst, sgst, igst, tax_total: tax, shipping: Number(shipping) || 0,
    round_off: round2(total - raw), total: round2(total),
  };
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) { return n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`; }
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ones[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}
// Indian numbering: crore, lakh, thousand
function amountInWords(amount, currency = 'INR') {
  const n = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - n) * 100);
  if (n === 0 && paise === 0) return 'Zero Only';
  const parts = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1000;
  if (crore) parts.push(`${crore > 99 ? amountInWords(crore, '').replace(/ Only$/, '') : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  const main = currency === 'INR' ? `Rupees ${parts.join(' ')}` : parts.join(' ');
  const p = paise ? ` and ${twoDigits(paise)} Paise` : '';
  return `${main}${p} Only`.trim();
}

const today = () => new Date().toISOString().slice(0, 10);
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function formatMoney(n, currency = 'INR') {
  const v = Number(n || 0);
  if (currency === 'INR') return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { round2, STATES, stateCodeFor, computeTotals, amountInWords, today, addDays, formatMoney, fillTemplate, HttpError };
