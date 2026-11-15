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

## Production

```bash
npm run install:all
npm run build                # builds client/dist, served by the API server
JWT_SECRET=... PUBLIC_URL=https://your-domain npm start
```

Data (SQLite DB + uploaded logos) lives in `server/data/`, or `DATA_DIR`. Back up that folder.

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
