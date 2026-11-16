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
import Tasks from './pages/Tasks.jsx';
import {
  IconDashboard,
  IconQuotation,
  IconInvoice,
  IconUpload,
  IconCustomers,
  IconPurchaseOrder,
  IconVendors,
  IconInventory,
  IconSettings,
  IconTasks,
} from './components/Icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/tasks', label: 'Tasks', icon: IconTasks },
  { section: 'Sales' },
  { to: '/quotations', label: 'Quotations', icon: IconQuotation },
  { to: '/invoices', label: 'Invoices', icon: IconInvoice },
  { to: '/bulk-upload', label: 'Bulk upload (Excel)', icon: IconUpload },
  { to: '/customers', label: 'Customers', icon: IconCustomers },
  { section: 'Purchase' },
  { to: '/purchase-orders', label: 'Purchase orders', icon: IconPurchaseOrder },
  { to: '/vendors', label: 'Vendors', icon: IconVendors },
  { section: 'Stock' },
  { to: '/inventory', label: 'Inventory', icon: IconInventory },
  { section: 'Setup' },
  { to: '/settings', label: 'Company settings', icon: IconSettings },
];

function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    document.body.classList.toggle('nav-open', open);
    return () => document.body.classList.remove('nav-open');
  }, [open]);
  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          {company?.logo_path
            ? <img src={`/api/uploads/${company.logo_path}`} alt={company?.name || 'Company logo'} className="brand-logo" />
            : (
              <>
                <div className="brand-mark">{(company?.name || 'M')[0]}</div>
                <div>
                  <div className="brand-name">{company?.name || 'MotionCrest'}</div>
                  <div className="brand-sub">Invoicing · PO · Stock</div>
                </div>
              </>
            )}
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map((n, i) => {
            if (n.section) return <div key={i} className="nav-section">{n.section}</div>;
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon" aria-hidden="true"><Icon /></span>
                <span className="nav-label">{n.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <div className="avatar">{user?.name?.[0]}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{user?.role}</div>
            </div>
          </div>
          <button type="button" className="sidebar-logout" onClick={logout}>Log out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Menu">☰</button>
          <span className="topbar-title">{company?.name}</span>
        </div>
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
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
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
