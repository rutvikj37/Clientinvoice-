// Demo company with sample data:  npm run seed   ->  login: admin@motioncrest.test / demo123
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR } = require('./db');
const { createDoc } = require('./services/documents');
const { moveStock, applyInvoiceStock } = require('./services/inventory');

if (db.prepare("SELECT 1 FROM users WHERE email = 'admin@motioncrest.test'").get()) { console.log('Demo data already exists'); process.exit(0); }

const logoSrc = path.join(__dirname, '..', 'assets', 'demo-logo.jpg');
let logo = null;
if (fs.existsSync(logoSrc)) { logo = 'logo-demo.jpg'; fs.copyFileSync(logoSrc, path.join(DATA_DIR, 'uploads', logo)); }

const CONDITIONS = 'Prices are as per final terms.\nProvide all required documents as per GST rules at time of delivery.\nSubject to Jaipur jurisdiction only.';

db.transaction(() => {
  const cid = db.prepare(`INSERT INTO companies (name, legal_name, gstin, pan, address, city, state, state_code, pincode, phone, email, website, logo_path, tagline,
    bank_name, bank_account, bank_ifsc, invoice_prefix, quote_prefix, po_prefix, default_payment_terms, default_transport, default_place_of_supply,
    invoice_terms, quote_terms, po_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'MotionCrest Hydraulics', 'MotionCrest Hydraulics Private Limited', '08AAVCM6556H1ZQ', 'AAVCM6556H',
    'Plot No. 108, Shree Hanuman Nagar, 4th Extension Niwaru Road Jhotwara, Near Bharat Mata Chowk', 'Jaipur', 'Rajasthan', '08', '302012',
    '7300192148 / 9327525408', 'Info@motioncresthyd.com', null, logo, 'Rising to power. Moving the world.',
    'Demo Bank', '000000000000', 'DEMO0000000', 'MCH/{FY}/', 'MCH/QT/{FY}/', 'MCH/{FY}/', 'Against PI', 'By Road', 'Ex- Works Jaipur',
    CONDITIONS, CONDITIONS, CONDITIONS).lastInsertRowid;
  const user = { id: db.prepare('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)')
    .run(cid, 'Admin', 'admin@motioncrest.test', bcrypt.hashSync('demo123', 10), 'admin').lastInsertRowid, name: 'Admin' };

  const cust = db.prepare('INSERT INTO customers (company_id, code, name, contact_person, email, phone, gstin, address, city, state, state_code, pincode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const c1 = cust.run(cid, 'C-001', 'Rajasthan Engineering Works', 'Mr. Verma', 'accounts@rajeng.test', '9876543210', '08ABCDE1234F1Z5', 'Plot 22, VKI Area', 'Jaipur', 'Rajasthan', '08', '302013').lastInsertRowid;
  const c2 = cust.run(cid, 'C-002', 'Gujarat Fluid Power', 'Mr. Patel', 'purchase@gujfluid.test', '9123456780', '24AAACG5555K1Z2', 'GIDC Vatva', 'Ahmedabad', 'Gujarat', '24', '382445').lastInsertRowid;
  const ven = db.prepare('INSERT INTO vendors (company_id, code, name, contact_person, email, phone, gstin, address, city, state, state_code, payment_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const v1 = ven.run(cid, 'MCH-001', 'Shree Steel Suppliers', 'Mr. Agarwal', 'sales@shreesteel.test', '9822011111', '08AAFFS5555K1Z3', 'Sitapura Industrial Area', 'Jaipur', 'Rajasthan', '08', 'Against PI').lastInsertRowid;
  ven.run(cid, 'MCH-002', 'Gujarat Seals Pvt Ltd', 'Ms. Shah', 'orders@gujseals.test', '9898022222', '24AABCG7777L1Z1', 'Aji GIDC', 'Rajkot', 'Gujarat', '24', '30 Days');

  const prod = db.prepare('INSERT INTO products (company_id, sku, name, hsn, unit, type, sale_price, purchase_price, tax_rate, reorder_level) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const items = [
    ['HC-50', 'Hydraulic Cylinder 50mm Bore', '8412', 'Nos', 'finished', 4500, 2900, 18, 10, 40],
    ['HC-80', 'Hydraulic Cylinder 80mm Bore', '8412', 'Nos', 'finished', 7800, 5100, 18, 5, 8],
    ['PU-20', 'Gear Pump 20 LPM', '8413', 'Nos', 'finished', 12500, 8800, 18, 3, 12],
    ['HS-12', 'Hydraulic Hose 1/2" x 1m', '4009', 'Nos', 'finished', 380, 210, 18, 50, 300],
    ['RM-SS-ROD', 'Chrome Plated Rod 25mm', '7215', 'Mtr', 'raw', 0, 640, 18, 50, 35],
    ['RM-SEAL-K', 'Seal Kit 50mm', '4016', 'Set', 'raw', 0, 320, 18, 30, 60],
  ];
  const ids = items.map(([sku, name, hsn, unit, type, sp, pp, tax, reorder, opening]) => {
    const id = prod.run(cid, sku, name, hsn, unit, type, sp, pp, tax, reorder).lastInsertRowid;
    moveStock({ companyId: cid, productId: id, qty: opening, type: 'IN', refType: 'opening', note: 'Opening stock', userId: user.id });
    return id;
  });

  const i1 = createDoc('invoice', cid, user, { party_id: c1, reference: 'RE/PO/2211', delivery_date: new Date().toISOString().slice(0, 10),
    items: [{ product_id: ids[0], qty: 10, discount_pct: 5 }, { product_id: ids[3], qty: 25 }] });
  applyInvoiceStock(i1, -1, user.id);
  const i2 = createDoc('invoice', cid, user, { party_id: c2, items: [{ product_id: ids[2], qty: 4 }] });
  applyInvoiceStock(i2, -1, user.id);
  createDoc('quotation', cid, user, { party_id: c2, items: [{ product_id: ids[1], qty: 6, discount_pct: 3 }, { product_id: ids[3], qty: 40 }], remarks: 'Delivery 2 weeks from PO' });
  createDoc('po', cid, user, { party_id: v1, items: [{ product_id: ids[4], qty: 100 }, { product_id: ids[5], qty: 120, discount_pct: 2 }] });
})();
console.log('Demo data created. Login: admin@motioncrest.test / demo123');
