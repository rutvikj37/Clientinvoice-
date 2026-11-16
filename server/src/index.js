require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { DATA_DIR, initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const partyRouter = require('./routes/parties');

const app = express();
app.set('trust proxy', 1); // behind Nginx
app.disable('x-powered-by');
// API and UI are served from the same origin in production; CORS only needed for local dev
if (process.env.NODE_ENV !== 'production') app.use(cors());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/uploads', express.static(path.join(DATA_DIR, 'uploads')));

app.use('/api/company', requireAuth, require('./routes/company'));
app.use('/api/customers', requireAuth, partyRouter('customers'));
app.use('/api/vendors', requireAuth, partyRouter('vendors'));
app.use('/api/products', requireAuth, require('./routes/products'));
app.use('/api/invoices', requireAuth, require('./routes/invoices'));
app.use('/api/bulk', requireAuth, require('./routes/bulk'));
app.use('/api/quotations', requireAuth, require('./routes/quotations'));
app.use('/api/purchase-orders', requireAuth, require('./routes/purchaseOrders'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app in production
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? `Server error: ${err.message}` : err.message });
});

const PORT = process.env.PORT || 4000;
initDb().then(() => {
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`API running on http://${process.env.HOST || '127.0.0.1'}:${PORT}`));
}).catch((err) => { console.error('DB init failed', err); process.exit(1); });