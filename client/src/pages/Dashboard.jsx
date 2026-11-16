import { Link } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';
import { useLoad, Badge, PageHead } from '../components/ui.jsx';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Always return the last 6 calendar months so the chart doesn’t look empty with one bar. */
function lastSixMonths(rows = []) {
  const byMonth = Object.fromEntries(rows.map((m) => [m.month, m]));
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = byMonth[key] || { month: key, sales: 0, collected: 0 };
    out.push({
      month: key,
      label: `${MONTH_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
      sales: Number(row.sales) || 0,
      collected: Number(row.collected) || 0,
    });
  }
  return out;
}

function EmptyInline({ children, action }) {
  return (
    <div className="dash-empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export default function Dashboard() {
  const { data, error } = useLoad(() => api.get('/dashboard'));
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const s = data.sales || {};
  const monthly = lastSixMonths(data.monthly);
  const max = Math.max(1, ...monthly.flatMap((m) => [m.sales, m.collected]));
  const topTotal = Math.max(1, ...(data.topCustomers || []).map((c) => Number(c.total) || 0));
  const lowStock = data.lowStock || [];
  const recent = data.recent || [];
  const topCustomers = data.topCustomers || [];

  return (
    <>
      <PageHead title="Dashboard" sub="Sales, collections, stock and open work">
        <Link className="btn" to="/bulk-upload">Bulk upload</Link>
        <Link className="btn" to="/quotations/new">+ Quotation</Link>
        <Link className="btn" to="/purchase-orders/new">+ Purchase order</Link>
        <Link className="btn btn-primary" to="/invoices/new">+ Invoice</Link>
      </PageHead>

      <div className="stats">
        <Link className="stat clickable" to="/invoices">
          <div className="stat-label">Sales this month</div>
          <div className="stat-value">{money(s.month_sales)}</div>
        </Link>
        <Link className="stat clickable" to="/invoices?status=paid">
          <div className="stat-label">Received this month</div>
          <div className="stat-value">{money(s.received_this_month)}</div>
        </Link>
        <Link className="stat clickable" to="/invoices?status=unpaid">
          <div className="stat-label">Outstanding</div>
          <div className="stat-value">{money(s.outstanding)}</div>
          <div className="stat-hint">Unpaid + partly paid</div>
        </Link>
        <Link className={`stat clickable ${Number(s.overdue_count) > 0 ? 'stat-warn' : ''}`} to="/invoices?status=overdue">
          <div className="stat-label">Overdue ({s.overdue_count || 0})</div>
          <div className="stat-value">{money(s.overdue)}</div>
          {Number(s.overdue_count) > 0 && <div className="stat-hint">Needs follow-up</div>}
        </Link>
      </div>

      <div className="card dash-chart-card">
        <div className="card-head">
          <h3>Sales vs collection</h3>
          <span className="muted small">Last 6 months</span>
        </div>
        <div className="bars" role="img" aria-label="Monthly invoiced vs collected">
          {monthly.map((m) => {
            const salesH = Math.max(m.sales > 0 ? 6 : 0, (m.sales / max) * 100);
            const collH = Math.max(m.collected > 0 ? 6 : 0, (m.collected / max) * 100);
            return (
              <div
                key={m.month}
                className="bar-col"
                title={`${m.label}\nInvoiced ${money(m.sales)}\nCollected ${money(m.collected)}`}
              >
                <div className="bar-pair">
                  <div className={`bar bar-a ${m.sales === 0 ? 'bar-empty' : ''}`} style={{ height: `${salesH}%` }} />
                  <div className={`bar bar-b ${m.collected === 0 ? 'bar-empty' : ''}`} style={{ height: `${collH}%` }} />
                </div>
                <div className="bar-label">{m.label}</div>
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span><i className="dot dot-a" />Invoiced</span>
          <span><i className="dot dot-b" />Collected</span>
        </div>
      </div>

      <div className="grid-3 dash-ops">
        <div className="card">
          <div className="card-head"><h3>Quotations</h3><Link to="/quotations" className="small">View all →</Link></div>
          <div className="mini-stats mini-stats-stack">
            <Link to="/quotations?status=sent" className="mini"><b>{data.quotes?.open || 0}</b><span>Open</span></Link>
            <Link to="/quotations?status=accepted" className="mini"><b>{data.quotes?.accepted || 0}</b><span>Accepted</span></Link>
            <div className="mini"><b>{money(data.quotes?.open_value)}</b><span>Pipeline</span></div>
          </div>
          {!Number(data.quotes?.open) && !Number(data.quotes?.accepted) && (
            <EmptyInline action={<Link className="btn btn-sm" to="/quotations/new">New quotation</Link>}>
              No open quotations.
            </EmptyInline>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>Purchase orders</h3><Link to="/purchase-orders" className="small">View all →</Link></div>
          <div className="mini-stats mini-stats-stack">
            <Link to="/purchase-orders?status=pending_approval" className="mini"><b>{data.po?.pending_approval || 0}</b><span>Pending approval</span></Link>
            <div className="mini"><b>{data.po?.open || 0}</b><span>Open POs</span></div>
            <div className="mini"><b>{money(data.po?.open_value)}</b><span>Open value</span></div>
          </div>
          {!Number(data.po?.pending_approval) && !Number(data.po?.open) && (
            <EmptyInline action={<Link className="btn btn-sm" to="/purchase-orders/new">New purchase order</Link>}>
              No open purchase orders.
            </EmptyInline>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>Low stock</h3><Link to="/inventory?low=1" className="small">Inventory →</Link></div>
          {lowStock.length === 0 ? (
            <EmptyInline>All items are above reorder level.</EmptyInline>
          ) : (
            <ul className="dash-stock-list">
              {lowStock.map((p) => {
                const qty = Number(p.stock_qty) || 0;
                const reorder = Number(p.reorder_level) || 0;
                return (
                  <li key={p.id}>
                    <div>
                      <Link to="/inventory">{p.name}</Link>
                      {p.sku && <div className="muted small">{p.sku}</div>}
                    </div>
                    <div className={`dash-stock-qty ${qty <= 0 ? 'text-danger' : 'text-warn'}`}>
                      <b>{qty}</b>
                      <span className="muted"> / {reorder} {p.unit || ''}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card dash-list-card">
          <div className="card-head"><h3>Recent invoices</h3><Link to="/invoices" className="small">All invoices →</Link></div>
          {recent.length === 0 ? (
            <EmptyInline action={<Link className="btn btn-sm btn-primary" to="/invoices/new">Create invoice</Link>}>
              No invoices yet.
            </EmptyInline>
          ) : (
            <div className="table-wrap">
              <table className="table compact dash-table">
                <thead>
                  <tr><th>Invoice</th><th>Date</th><th className="num">Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {recent.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link to={`/invoices/${i.id}`}><b>{i.doc_no}</b></Link>
                        <div className="muted small">{i.party_name}</div>
                      </td>
                      <td className="muted small nowrap">{fmtDate(i.doc_date)}</td>
                      <td className="num">{money(i.total)}</td>
                      <td><Badge status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card dash-list-card">
          <div className="card-head"><h3>Top customers</h3><Link to="/customers" className="small">Customers →</Link></div>
          {topCustomers.length === 0 ? (
            <EmptyInline action={<Link className="btn btn-sm" to="/customers">Add customer</Link>}>
              No customer sales yet.
            </EmptyInline>
          ) : (
            <ul className="dash-rank-list">
              {topCustomers.map((c, idx) => {
                const total = Number(c.total) || 0;
                const pct = Math.round((total / topTotal) * 100);
                return (
                  <li key={c.name}>
                    <div className="dash-rank-row">
                      <span className="dash-rank-n">{idx + 1}</span>
                      <div className="dash-rank-meta">
                        <div className="dash-rank-name">{c.name}</div>
                        <div className="dash-rank-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
                      </div>
                      <div className="num dash-rank-amt">{money(total)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
