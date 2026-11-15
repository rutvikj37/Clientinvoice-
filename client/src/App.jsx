import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DocList from './pages/DocList.jsx';
import DocForm from './pages/DocForm.jsx';
import DocView from './pages/DocView.jsx';
import BulkUpload from './pages/BulkUpload.jsx';
import Parties from './pages/Parties.jsx';
import Inventory from './pages/Inventory.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { section: 'Sales' },
  { to: '/quotations', label: 'Quotations', icon: '📝' },
  { to: '/invoices', label: 'Invoices', icon: '🧾' },
  { to: '/bulk-upload', label: 'Bulk upload (Excel)', icon: '⇪' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { section: 'Purchase' },
  { to: '/purchase-orders', label: 'Purchase orders', icon: '📦' },
  { to: '/vendors', label: 'Vendors', icon: '🏭' },
  { section: 'Stock' },
  { to: '/inventory', label: 'Inventory', icon: '▤' },
  { section: 'Setup' },
  { to: '/settings', label: 'Company settings', icon: '⚙' },
];

function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          {company?.logo_path ? <img src={`/api/uploads/${company.logo_path}`} alt="" /> : <div className="brand-mark">{(company?.name || 'F')[0]}</div>}
          <div><div className="brand-name">{company?.name || 'FactoryBill'}</div><div className="brand-sub">Invoicing · PO · Stock</div></div>
        </div>
        <nav>
          {NAV.map((n, i) => n.section
            ? <div key={i} className="nav-section">{n.section}</div>
            : <NavLink key={n.to} to={n.to} end={n.end} className="nav-link"><span className="nav-icon">{n.icon}</span>{n.label}</NavLink>)}
        </nav>
        <div className="sidebar-foot">
          <div className="user"><div className="avatar">{user?.name?.[0]}</div><div><div>{user?.name}</div><div className="muted small">{user?.role}</div></div></div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Log out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <div className="topbar"><button className="icon-btn" onClick={() => setOpen(true)} aria-label="Menu">☰</button><span>{company?.name}</span></div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {['invoice', 'quotation', 'po'].flatMap((k) => {
          const base = { invoice: '/invoices', quotation: '/quotations', po: '/purchase-orders' }[k];
          return [
            <Route key={`${k}-l`} path={base} element={<DocList kind={k} key={k} />} />,
            <Route key={`${k}-n`} path={`${base}/new`} element={<DocForm kind={k} key={`${k}-new`} />} />,
            <Route key={`${k}-v`} path={`${base}/:id`} element={<DocView kind={k} />} />,
            <Route key={`${k}-e`} path={`${base}/:id/edit`} element={<DocForm kind={k} />} />,
          ];
        })}
        <Route path="/bulk-upload" element={<BulkUpload />} />
        <Route path="/customers" element={<Parties kind="customers" key="c" />} />
        <Route path="/vendors" element={<Parties kind="vendors" key="v" />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
