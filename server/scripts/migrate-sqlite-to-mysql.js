#!/usr/bin/env node
/**
 * One-time: copy rows from a SQLite app.db into MySQL (preserves IDs).
 *
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=clientinvoice \
 *     node scripts/migrate-sqlite-to-mysql.js [/path/to/app.db]
 *
 * Requires Node 22+ (uses built-in node:sqlite). Schema must already exist (run the app or seed once).
 */
require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const { initDb, mysqlConfig } = require('../src/db');

const SQLITE_PATH = process.argv[2] || process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db');

const TABLES = [
  'companies',
  'users',
  'customers',
  'vendors',
  'products',
  'stock_movements',
  'invoices',
  'invoice_items',
  'quotations',
  'quotation_items',
  'purchase_orders',
  'po_items',
  'invoice_payments',
  'po_receipts',
  'po_receipt_items',
  'activity',
  'bulk_batches',
];

function emptyToNull(row) {
  const out = { ...row };
  if ('sku' in out && (out.sku === '' || out.sku === undefined)) out.sku = null;
  return out;
}

async function main() {
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  await initDb();
  const pool = mysql.createPool(mysqlConfig());
  const conn = await pool.getConnection();

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      const exists = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!exists) {
        console.log(`skip missing table ${table}`);
        continue;
      }
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all().map(emptyToNull);
      await conn.query(`DELETE FROM \`${table}\``);
      if (!rows.length) {
        console.log(`${table}: 0 rows`);
        continue;
      }
      const cols = Object.keys(rows[0]);
      const placeholders = `(${cols.map(() => '?').join(',')})`;
      const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${placeholders}`;
      for (const row of rows) {
        await conn.execute(sql, cols.map((c) => row[c]));
      }
      console.log(`${table}: ${rows.length} rows`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // Reset AUTO_INCREMENT to max(id)+1
    for (const table of TABLES) {
      const [[{ m }]] = await conn.query(`SELECT COALESCE(MAX(id),0) AS m FROM \`${table}\``);
      await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ?`, [Number(m) + 1]);
    }
    console.log('Migration complete.');
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    conn.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
