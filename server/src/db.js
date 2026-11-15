const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/*
 * Invoices, quotations and purchase orders share one column layout (see DOC_HEADER / DOC_ITEM)
 * so one engine (services/documents.js), one PDF layout and one Excel importer handle all three.
 * Field names follow the client's PO / Quotation Excel templates.
 */
const DOC_HEADER = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  doc_no TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  doc_date TEXT NOT NULL,
  due_date TEXT,                -- invoice: payment due date | quotation: offer validity date
  delivery_date TEXT,
  status TEXT NOT NULL,
  place_of_supply TEXT, is_interstate INTEGER DEFAULT 0,
  contact_person TEXT, contact_phone TEXT, contact_email TEXT,
  payment_terms TEXT, transport TEXT, reference TEXT,
  subtotal REAL DEFAULT 0, discount_total REAL DEFAULT 0, taxable_total REAL DEFAULT 0,
  cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, tax_total REAL DEFAULT 0,
  shipping REAL DEFAULT 0, round_off REAL DEFAULT 0, total REAL DEFAULT 0,
  remarks TEXT, terms TEXT,
  source TEXT DEFAULT 'manual', batch_id INTEGER,
  last_emailed_at TEXT, last_whatsapp_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP`;

const DOC_ITEM = (parent) => `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES ${parent}(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  item_code TEXT, description TEXT NOT NULL, hsn TEXT, unit TEXT,
  qty REAL NOT NULL, rate REAL NOT NULL, discount_pct REAL DEFAULT 0, tax_rate REAL DEFAULT 0,
  taxable_amount REAL DEFAULT 0, tax_amount REAL DEFAULT 0, amount REAL DEFAULT 0,
  sort INTEGER DEFAULT 0`;

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  legal_name TEXT, gstin TEXT, pan TEXT,
  address TEXT, city TEXT, state TEXT, state_code TEXT, pincode TEXT, country TEXT DEFAULT 'India',
  phone TEXT, email TEXT, website TEXT, logo_path TEXT, tagline TEXT,
  bank_name TEXT, bank_account TEXT, bank_ifsc TEXT, bank_branch TEXT, upi_id TEXT,
  currency TEXT DEFAULT 'INR',
  -- prefixes support {FY} -> 2026-27 ; numbering restarts every financial year
  invoice_prefix TEXT DEFAULT 'INV/{FY}/', quote_prefix TEXT DEFAULT 'QT/{FY}/', po_prefix TEXT DEFAULT 'PO/{FY}/',
  number_padding INTEGER DEFAULT 3,
  default_due_days INTEGER DEFAULT 15, quote_validity_days INTEGER DEFAULT 15,
  default_payment_terms TEXT, default_transport TEXT, default_place_of_supply TEXT,
  invoice_terms TEXT, quote_terms TEXT, po_terms TEXT,
  po_approval_required INTEGER DEFAULT 1,
  smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER DEFAULT 0, smtp_user TEXT, smtp_pass TEXT, smtp_from TEXT,
  wa_phone_number_id TEXT, wa_access_token TEXT,
  email_subject_template TEXT, email_body_template TEXT, whatsapp_template TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  code TEXT, name TEXT NOT NULL, contact_person TEXT, email TEXT, phone TEXT, gstin TEXT,
  address TEXT, city TEXT, state TEXT, state_code TEXT, pincode TEXT, payment_terms TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  code TEXT, name TEXT NOT NULL, contact_person TEXT, email TEXT, phone TEXT, gstin TEXT,
  address TEXT, city TEXT, state TEXT, state_code TEXT, pincode TEXT, payment_terms TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  sku TEXT, name TEXT NOT NULL, description TEXT, category TEXT, hsn TEXT,
  unit TEXT DEFAULT 'Nos', type TEXT DEFAULT 'finished',
  sale_price REAL DEFAULT 0, purchase_price REAL DEFAULT 0, tax_rate REAL DEFAULT 18,
  stock_qty REAL DEFAULT 0, reorder_level REAL DEFAULT 0, location TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_sku ON products(company_id, sku) WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- IN | OUT | ADJUST
  qty REAL NOT NULL,             -- signed change applied to stock
  balance REAL,
  ref_type TEXT, ref_id INTEGER, note TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- invoice status: draft | unpaid | partially_paid | paid | cancelled
CREATE TABLE IF NOT EXISTS invoices (${DOC_HEADER},
  amount_paid REAL DEFAULT 0, stock_applied INTEGER DEFAULT 0, quotation_id INTEGER,
  UNIQUE(company_id, doc_no));
CREATE TABLE IF NOT EXISTS invoice_items (${DOC_ITEM('invoices')});

-- quotation status: draft | sent | accepted | rejected | converted | cancelled
CREATE TABLE IF NOT EXISTS quotations (${DOC_HEADER},
  converted_invoice_id INTEGER,
  UNIQUE(company_id, doc_no));
CREATE TABLE IF NOT EXISTS quotation_items (${DOC_ITEM('quotations')});

-- PO status: draft -> pending_approval -> approved -> sent -> partially_received -> received -> closed ; rejected ; cancelled
CREATE TABLE IF NOT EXISTS purchase_orders (${DOC_HEADER},
  delivery_address TEXT, approved_by INTEGER, approved_at TEXT, rejection_reason TEXT,
  UNIQUE(company_id, doc_no));
CREATE TABLE IF NOT EXISTS po_items (${DOC_ITEM('purchase_orders')},
  received_qty REAL DEFAULT 0);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL, paid_on TEXT NOT NULL, mode TEXT, reference TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS po_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  grn_no TEXT, received_on TEXT NOT NULL, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS po_receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  po_item_id INTEGER NOT NULL REFERENCES po_items(id),
  qty REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  action TEXT NOT NULL, detail TEXT, user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_activity_entity ON activity(entity, entity_id);

CREATE TABLE IF NOT EXISTS bulk_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  doc_type TEXT DEFAULT 'invoice',
  file_name TEXT, total_rows INTEGER, docs_created INTEGER, errors TEXT,
  user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function logActivity(companyId, entity, entityId, action, detail, userId) {
  db.prepare(
    'INSERT INTO activity (company_id, entity, entity_id, action, detail, user_id) VALUES (?,?,?,?,?,?)'
  ).run(companyId, entity, entityId, action, detail || null, userId || null);
}

module.exports = { db, DATA_DIR, logActivity };
