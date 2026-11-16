// Ensures MotionCrest company + admin login only (no sample parties/products/docs).
//   npm run seed   ->  login: admin@gmail.com / admin123
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR, initDb } = require('./db');

const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = 'admin123';

const BANK = {
  bank_name: 'IDFC FIRST Bank',
  bank_account: '75685864328',
  bank_ifsc: 'IDFB0043421',
  bank_branch: 'Jaipur - Jhotwara Branch',
};

async function seed() {
  await initDb();

  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(ADMIN_EMAIL)) {
    // Keep live bank details in sync with the company account (idempotent).
    const r = await db
      .prepare(
        `UPDATE companies SET bank_name = ?, bank_account = ?, bank_ifsc = ?, bank_branch = ?
       WHERE legal_name LIKE '%MOTIONCREST%' OR name LIKE '%MotionCrest%'`
      )
      .run(BANK.bank_name, BANK.bank_account, BANK.bank_ifsc, BANK.bank_branch);
    console.log(
      r.changes
        ? `Admin already exists; bank details updated (${BANK.bank_name} / ${BANK.bank_ifsc}).`
        : 'Admin already exists. Login: admin@gmail.com / admin123'
    );
    return;
  }

  const logoSrc = path.join(__dirname, '..', 'assets', 'demo-logo.jpg');
  let logo = null;
  if (fs.existsSync(logoSrc)) {
    logo = 'logo-demo.jpg';
    fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
    fs.copyFileSync(logoSrc, path.join(DATA_DIR, 'uploads', logo));
  }

  const CONDITIONS =
    'Prices are as per final terms.\nProvide all required documents as per GST rules at time of delivery.\nSubject to Jaipur jurisdiction only.';

  await db.transaction(async () => {
    const cid = (await db
      .prepare(
        `INSERT INTO companies (name, legal_name, gstin, pan, address, city, state, state_code, pincode, phone, email, website, logo_path, tagline,
    bank_name, bank_account, bank_ifsc, bank_branch, invoice_prefix, quote_prefix, po_prefix, default_payment_terms, default_transport, default_place_of_supply,
    invoice_terms, quote_terms, po_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        'MotionCrest Hydraulics',
        'MOTIONCREST HYDRAULICS PRIVATE LIMITED',
        '08AAVCM6556H1ZQ',
        'AAVCM6556H',
        'Plot No. 108, Shree Hanuman Nagar, 4th Extension Niwaru Road Jhotwara, Near Bharat Mata Chowk',
        'Jaipur',
        'Rajasthan',
        '08',
        '302012',
        '7300192148 / 9327525408',
        'Info@motioncresthyd.com',
        null,
        logo,
        'Rising to power. Moving the world.',
        BANK.bank_name,
        BANK.bank_account,
        BANK.bank_ifsc,
        BANK.bank_branch,
        'MCH/{FY}/',
        'MCH/QT/{FY}/',
        'MCH/{FY}/',
        'Against PI',
        'By Road',
        'Ex- Works Jaipur',
        CONDITIONS,
        CONDITIONS,
        CONDITIONS
      )).lastInsertRowid;

    await db.prepare('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)').run(
      cid,
      'Admin',
      ADMIN_EMAIL,
      bcrypt.hashSync(ADMIN_PASSWORD, 10),
      'admin'
    );
  });

  console.log('Company + admin created. Login: admin@gmail.com / admin123');
}

seed().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });