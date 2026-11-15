# Manufacturing Invoice: Invoicing · Quotations · Purchase Orders · Inventory

A web platform for manufacturing companies to create GST invoices, quotations and purchase orders, send them on **WhatsApp** and **email**, generate them **in bulk from Excel**, run a **PO approval and goods-receipt flow**, and track **inventory**.

Document fields and the PDF layout follow the client's own PO / Quotation Excel formats (`server/assets/PO_Template.xlsx`, `server/assets/Quotation_Template.xlsx`).

## Features

| Module | What it does |
|---|---|
| **Login** | Email + password accounts per company. Admin and Staff roles; admins approve POs and manage settings. |
| **Company settings** | Name, address, GST No., PAN, logo, bank details, numbering prefixes (`MCH/{FY}/` → `MCH/2026-27/001`, restarts each April), default payment terms / transport / place of supply, general conditions, SMTP email, WhatsApp API, team members. |
| **Invoices** | Create / edit / issue / duplicate / cancel, record payments (part or full), overdue tracking, PDF, Excel export. Per-row action menu and bulk actions (WhatsApp, email, ZIP of PDFs, issue, mark paid, cancel, delete drafts). Issuing an invoice deducts stock; cancelling returns it. |
| **Quotations** | Draft → Sent → Accepted → **Convert to invoice** in one click. Rejected / cancelled / reopen. |
| **Purchase orders** | Draft → Submit → **Approval** (admin) → Send to vendor (WhatsApp / email) → **Receive goods (GRN)**, partial or full → Closed. Receiving adds stock and updates purchase price. Rejected POs can be edited and resubmitted. |
| **Inventory** | Items with Item Code, HSN, UOM, sell / cost price, GST %, reorder level. Stock in / out / physical-count adjustments, full movement history, low-stock alerts. |
| **Bulk upload (Excel)** | For invoices, quotations **and** POs. Accepts (1) a **bulk sheet**, one row per item and grouped by Doc Ref / Doc No., with automatic column matching and a manual mapping screen; and (2) the client's **filled PO / Quotation form files** as-is, several at once. Validates first (preview with errors / warnings), then creates documents, auto-creating new customers / vendors and new inventory items. |
| **GST** | CGST + SGST for same-state parties, IGST for inter-state, decided from GST No. / state. Amount in words (Indian numbering). |
| **WhatsApp** | Works with no setup: opens WhatsApp with a ready message and a secure PDF link. With the **WhatsApp Business Cloud API** connected, the PDF is sent directly, including in bulk. |
| **Email** | Sends the PDF as an attachment through the company's own SMTP (Gmail, Zoho, Outlook…). |

## Tech stack

- **Server:** Node.js 20+ · Express 5 · SQLite (better-sqlite3) · PDFKit · ExcelJS · Nodemailer · JWT
- **Client:** React 18 · Vite · React Router

## Run locally

```bash
npm run install:all          # install server + client deps
cp server/.env.example server/.env
npm run seed                 # optional demo data → admin@motioncrest.test / demo123
npm run dev:server           # API on http://localhost:4000
npm run dev:client           # UI on http://localhost:5173 (proxies /api)
```

## Deploy on a VPS (Ubuntu 22.04 / 24.04, Debian 12)

1. Point your domain's **A record** to the VPS IP (for example `invoice.yourcompany.com`).
2. SSH into the VPS and run:

```bash
curl -fsSL https://raw.githubusercontent.com/rutvikj37/Clientinvoice-/main/deploy/setup-vps.sh -o setup.sh
sudo DOMAIN=invoice.yourcompany.com EMAIL=you@yourcompany.com bash setup.sh
```

This installs Node.js 22, builds the app, runs it as a `systemd` service (auto-restart and start on boot) behind **Nginx**, gets a free **HTTPS** certificate, enables the firewall and sets up **daily backups** to `/var/backups/clientinvoice` (kept 14 days). A random `JWT_SECRET` is generated in `/opt/clientinvoice/server/.env`.

No domain yet? Run `sudo bash setup.sh` and the app is served on `http://<server-ip>`. Run it again later with `DOMAIN=` and `EMAIL=` to add HTTPS.
Private repo? Add `GITHUB_TOKEN=<read-only token>` to the command.

3. Open the site and **Create an account**. This first user becomes the admin, and public sign-up then closes; add staff from **Settings → Team**. To keep sign-up open, set `ALLOW_REGISTRATION=true` in `server/.env`.

| Task | Command |
|---|---|
| Update to latest code | `sudo bash /opt/clientinvoice/deploy/update.sh` |
| Logs | `journalctl -u clientinvoice -f` |
| Restart | `sudo systemctl restart clientinvoice` |
| Manual backup | `sudo /etc/cron.daily/clientinvoice-backup` |

Data (SQLite DB + uploaded logos) lives in `/var/lib/clientinvoice`.

## Excel bulk upload: columns

Download the ready-made template from **Bulk upload → Download bulk sheet template**. Columns (same names as the client's format):

`Doc Ref, PO No. / Offer No. / Invoice No., Document Date, Offer Validity Date / Due Date, Delivery Date, Contact Person, Phone No, Email, Place of Supply, Vendor/Customer Code, Vendor/Customer Name, Address, State, State Code, GST No., Vendor/Customer Mobile (WhatsApp), Vendor/Customer Email, Payment Terms, Transport, Reference, Remarks, Freight, Item Code, Item Description, HSN, Qty, UOM, Unit Price, Disc %, Price Af Disc, CGST Rate, SGST Rate, IGST Rate`

- Rows with the same **Doc Ref** (or Doc No.) become one document.
- Leave Doc No. empty for automatic numbering.
- Parties are matched by Code → GST No. → Name; items by Item Code.
- Dates `DD/MM/YYYY`; percent-formatted cells are handled.

## Project structure

```
server/
  src/
    db.js                  schema (invoices, quotations, purchase_orders share one layout)
    services/documents.js  one engine for all three document types (numbering, GST, totals)
    services/pdf.js        PDF layout matching the client's templates
    services/messaging.js  email (SMTP) + WhatsApp (Cloud API / wa.me link)
    services/inventory.js  stock movements
    routes/                auth, company, customers/vendors, products, invoices, quotations,
                           purchaseOrders, bulk (Excel), dashboard, public (share links)
  assets/                  client's blank PO / Quotation templates + demo logo
client/src/
  pages/DocList|DocForm|DocView.jsx   shared screens for invoices, quotations, POs
  pages/BulkUpload.jsx, Inventory.jsx, Parties.jsx, Settings.jsx, Dashboard.jsx
```
