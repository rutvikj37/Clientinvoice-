const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const als = new AsyncLocalStorage();

function mysqlConfig() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'clientinvoice';
  const password = process.env.MYSQL_PASSWORD || 'clientinvoice';
  const database = process.env.MYSQL_DATABASE || 'clientinvoice';
  return {
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
    multipleStatements: true,
    namedPlaceholders: false,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  };
}

let pool;

function getExecutor() {
  return als.getStore() || pool;
}

function prepare(sql) {
  return {
    async get(...params) {
      const [rows] = await getExecutor().execute(sql, params);
      return rows[0];
    },
    async all(...params) {
      const [rows] = await getExecutor().execute(sql, params);
      return rows;
    },
    async run(...params) {
      const [result] = await getExecutor().execute(sql, params);
      return { lastInsertRowid: Number(result.insertId) || 0, changes: result.affectedRows || 0 };
    },
  };
}

async function exec(sql) {
  // multi-statement schema bootstrap
  await getExecutor().query(sql);
}

async function transaction(fn) {
  if (als.getStore()) return fn();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await als.run(conn, fn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

const DOC_HEADER = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  doc_no VARCHAR(64) NOT NULL,
  party_id INT NOT NULL,
  doc_date VARCHAR(32) NOT NULL,
  due_date VARCHAR(32) NULL,
  delivery_date VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL,
  place_of_supply TEXT NULL,
  is_interstate TINYINT DEFAULT 0,
  contact_person VARCHAR(255) NULL,
  contact_phone VARCHAR(64) NULL,
  contact_email VARCHAR(255) NULL,
  payment_terms TEXT NULL,
  transport VARCHAR(255) NULL,
  reference VARCHAR(255) NULL,
  subtotal DOUBLE DEFAULT 0,
  discount_total DOUBLE DEFAULT 0,
  taxable_total DOUBLE DEFAULT 0,
  cgst DOUBLE DEFAULT 0,
  sgst DOUBLE DEFAULT 0,
  igst DOUBLE DEFAULT 0,
  tax_total DOUBLE DEFAULT 0,
  shipping DOUBLE DEFAULT 0,
  round_off DOUBLE DEFAULT 0,
  total DOUBLE DEFAULT 0,
  remarks TEXT NULL,
  terms TEXT NULL,
  source VARCHAR(32) DEFAULT 'manual',
  batch_id INT NULL,
  last_emailed_at VARCHAR(32) NULL,
  last_whatsapp_at VARCHAR(32) NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;

const DOC_ITEM = (parent) => `
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_id INT NOT NULL,
  product_id INT NULL,
  item_code VARCHAR(64) NULL,
  description TEXT NOT NULL,
  hsn VARCHAR(32) NULL,
  unit VARCHAR(32) NULL,
  qty DOUBLE NOT NULL,
  rate DOUBLE NOT NULL,
  discount_pct DOUBLE DEFAULT 0,
  tax_rate DOUBLE DEFAULT 0,
  taxable_amount DOUBLE DEFAULT 0,
  tax_amount DOUBLE DEFAULT 0,
  amount DOUBLE DEFAULT 0,
  sort INT DEFAULT 0,
  CONSTRAINT fk_${parent}_items_doc FOREIGN KEY (doc_id) REFERENCES ${parent}(id) ON DELETE CASCADE`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255) NULL,
  gstin VARCHAR(32) NULL,
  pan VARCHAR(16) NULL,
  address TEXT NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  state_code VARCHAR(8) NULL,
  pincode VARCHAR(16) NULL,
  country VARCHAR(64) DEFAULT 'India',
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  website VARCHAR(255) NULL,
  logo_path VARCHAR(255) NULL,
  tagline VARCHAR(255) NULL,
  bank_name VARCHAR(255) NULL,
  bank_account VARCHAR(64) NULL,
  bank_ifsc VARCHAR(32) NULL,
  bank_branch VARCHAR(255) NULL,
  upi_id VARCHAR(128) NULL,
  currency VARCHAR(8) DEFAULT 'INR',
  invoice_prefix VARCHAR(64) DEFAULT 'INV/{FY}/',
  quote_prefix VARCHAR(64) DEFAULT 'QT/{FY}/',
  po_prefix VARCHAR(64) DEFAULT 'PO/{FY}/',
  number_padding INT DEFAULT 3,
  invoice_seq_next INT NULL,
  quote_seq_next INT NULL,
  po_seq_next INT NULL,
  default_due_days INT DEFAULT 15,
  quote_validity_days INT DEFAULT 15,
  default_payment_terms TEXT NULL,
  default_transport VARCHAR(255) NULL,
  default_place_of_supply VARCHAR(255) NULL,
  invoice_terms TEXT NULL,
  quote_terms TEXT NULL,
  po_terms TEXT NULL,
  po_approval_required TINYINT DEFAULT 1,
  smtp_host VARCHAR(255) NULL,
  smtp_port INT NULL,
  smtp_secure TINYINT DEFAULT 0,
  smtp_user VARCHAR(255) NULL,
  smtp_pass TEXT NULL,
  smtp_from VARCHAR(255) NULL,
  wa_phone_number_id VARCHAR(64) NULL,
  wa_access_token TEXT NULL,
  email_subject_template TEXT NULL,
  email_body_template TEXT NULL,
  whatsapp_template TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_users_email (email),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  gstin VARCHAR(32) NULL,
  address TEXT NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  state_code VARCHAR(8) NULL,
  pincode VARCHAR(16) NULL,
  payment_terms TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customers_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  gstin VARCHAR(32) NULL,
  address TEXT NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  state_code VARCHAR(8) NULL,
  pincode VARCHAR(16) NULL,
  payment_terms TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vendors_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  sku VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(128) NULL,
  hsn VARCHAR(32) NULL,
  unit VARCHAR(32) DEFAULT 'Nos',
  type VARCHAR(32) DEFAULT 'finished',
  sale_price DOUBLE DEFAULT 0,
  purchase_price DOUBLE DEFAULT 0,
  tax_rate DOUBLE DEFAULT 18,
  stock_qty DOUBLE DEFAULT 0,
  reorder_level DOUBLE DEFAULT 0,
  location VARCHAR(128) NULL,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_products_sku (company_id, sku),
  CONSTRAINT fk_products_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  product_id INT NOT NULL,
  type VARCHAR(16) NOT NULL,
  qty DOUBLE NOT NULL,
  balance DOUBLE NULL,
  ref_type VARCHAR(32) NULL,
  ref_id INT NULL,
  note TEXT NULL,
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  ${DOC_HEADER},
  amount_paid DOUBLE DEFAULT 0,
  stock_applied TINYINT DEFAULT 0,
  quotation_id INT NULL,
  eway_bill_no VARCHAR(32) NULL,
  eway_bill_date VARCHAR(32) NULL,
  eway_valid_upto VARCHAR(32) NULL,
  vehicle_no VARCHAR(32) NULL,
  transporter_name VARCHAR(255) NULL,
  transporter_gstin VARCHAR(32) NULL,
  transporter_id VARCHAR(64) NULL,
  approx_distance_km DOUBLE NULL,
  dispatch_from TEXT NULL,
  ship_to TEXT NULL,
  UNIQUE KEY ux_invoices_doc (company_id, doc_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoice_items (
  ${DOC_ITEM('invoices')}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quotations (
  ${DOC_HEADER},
  converted_invoice_id INT NULL,
  UNIQUE KEY ux_quotations_doc (company_id, doc_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quotation_items (
  ${DOC_ITEM('quotations')}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_orders (
  ${DOC_HEADER},
  delivery_address TEXT NULL,
  approved_by INT NULL,
  approved_at VARCHAR(32) NULL,
  rejection_reason TEXT NULL,
  UNIQUE KEY ux_po_doc (company_id, doc_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS po_items (
  ${DOC_ITEM('purchase_orders')},
  received_qty DOUBLE DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  amount DOUBLE NOT NULL,
  paid_on VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NULL,
  reference VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS po_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_id INT NOT NULL,
  grn_no VARCHAR(64) NULL,
  received_on VARCHAR(32) NOT NULL,
  note TEXT NULL,
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipts_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS po_receipt_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL,
  po_item_id INT NOT NULL,
  qty DOUBLE NOT NULL,
  CONSTRAINT fk_receipt_items_receipt FOREIGN KEY (receipt_id) REFERENCES po_receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  entity VARCHAR(32) NOT NULL,
  entity_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  detail TEXT NULL,
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY ix_activity_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bulk_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  doc_type VARCHAR(32) DEFAULT 'invoice',
  file_name TEXT NULL,
  total_rows INT NULL,
  docs_created INT NULL,
  errors TEXT NULL,
  user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'todo',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  due_date VARCHAR(32) NULL,
  assigned_to INT NULL,
  created_by INT NULL,
  completed_at VARCHAR(32) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_tasks_company (company_id),
  KEY ix_tasks_status (company_id, status),
  KEY ix_tasks_assignee (company_id, assigned_to),
  CONSTRAINT fk_tasks_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function logActivity(companyId, entity, entityId, action, detail, userId) {
  await prepare(
    'INSERT INTO activity (company_id, entity, entity_id, action, detail, user_id) VALUES (?,?,?,?,?,?)'
  ).run(companyId, entity, entityId, action, detail || null, userId || null);
}

async function ensureColumn(table, column, definitionSql) {
  const row = await prepare(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`
  ).get(table, column);
  if (!Number(row?.c)) await exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definitionSql}`);
}

async function initDb() {
  if (pool) return pool;
  const cfg = mysqlConfig();
  if (!cfg.password && process.env.NODE_ENV === 'production') {
    console.warn('Warning: MYSQL_PASSWORD is empty');
  }
  pool = mysql.createPool(cfg);
  // Verify connectivity then ensure schema
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
  await exec(SCHEMA);
  await ensureColumn('companies', 'invoice_seq_next', 'INT NULL');
  await ensureColumn('companies', 'quote_seq_next', 'INT NULL');
  await ensureColumn('companies', 'po_seq_next', 'INT NULL');
  await ensureColumn('invoices', 'eway_bill_no', 'VARCHAR(32) NULL');
  await ensureColumn('invoices', 'eway_bill_date', 'VARCHAR(32) NULL');
  await ensureColumn('invoices', 'eway_valid_upto', 'VARCHAR(32) NULL');
  await ensureColumn('invoices', 'vehicle_no', 'VARCHAR(32) NULL');
  await ensureColumn('invoices', 'transporter_name', 'VARCHAR(255) NULL');
  await ensureColumn('invoices', 'transporter_gstin', 'VARCHAR(32) NULL');
  await ensureColumn('invoices', 'transporter_id', 'VARCHAR(64) NULL');
  await ensureColumn('invoices', 'approx_distance_km', 'DOUBLE NULL');
  await ensureColumn('invoices', 'dispatch_from', 'TEXT NULL');
  await ensureColumn('invoices', 'ship_to', 'TEXT NULL');
  return pool;
}

const db = { prepare, transaction, exec, init: initDb };

module.exports = { db, DATA_DIR, logActivity, initDb, mysqlConfig };
