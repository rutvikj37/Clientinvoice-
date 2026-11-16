import { Link } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';
import { useLoad, Badge, PageHead } from '../components/ui.jsx';

export default function Dashboard() {
  const { data, error } = useLoad(() => api.get('/dashboard'));
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const s = data.sales;
  const max = Math.max(1, ...data.monthly.map((m) => m.sales));
  return (
    <>
      <PageHead title="Dashboard" sub="Your business at a glance">
        <Link className="btn" to="/bulk-upload">Bulk upload (Excel)</Link>
        <Link className="btn" to="/quotations/new">+ Quotation</Link>
        <Link className="btn" to="/purchase-orders/new">+ Purchase order</Link>
        <Link className="btn btn-primary" to="/invoices/new">+ Invoice</Link>
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="stat-label">Sales this month</div><div className="stat-value">{money(s.month_sales)}</div></div>
        <div className="stat"><div className="stat-label">Received this month</div><div className="stat-value">{money(s.received_this_month)}</div></div>
        <div className="stat"><div className="stat-label">Outstanding</div><div className="stat-value">{money(s.outstanding)}</div></div>
        <div className="stat stat-warn"><div className="stat-label">Overdue ({s.overdue_count || 0})</div><div className="stat-value">{money(s.overdue)}</div>
          {s.overdue_count > 0 && <Link to="/invoices?status=overdue" className="small">View overdue →</Link>}</div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Sales vs collection (last 6 months)</h3></div>
          {data.monthly.length === 0 ? <p className="muted">No invoices yet.</p> : (
            <div className="bars">
              {data.monthly.map((m) => (
                <div key={m.month} className="bar-col" title={`Sales ${money(m.sales)} · Collected ${money(m.collected)}`}>
                  <div className="bar-pair">
                    <div className="bar bar-a" style={{ height: `${(m.sales / max) * 100}%` }} />
                    <div className="bar bar-b" style={{ height: `${(m.collected / max) * 100}%` }} />
                  </div>
                  <div className="bar-label">{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="legend"><span><i className="dot dot-a" />Invoiced</span><span><i className="dot dot-b" />Collected</span></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Quotations</h3><Link to="/quotations" className="small">All quotations →</Link></div>
          <div className="mini-stats">
            <Link to="/quotations?status=sent" className="mini"><b>{data.quotes.open || 0}</b><span>Open quotations</span></Link>
            <Link to="/quotations?status=accepted" className="mini"><b>{data.quotes.accepted || 0}</b><span>Accepted, to invoice</span></Link>
            <div className="mini"><b>{money(data.quotes.open_value)}</b><span>Pipeline value</span></div>
          </div>
          <div className="card-head" style={{ marginTop: 16 }}><h3>Purchase orders</h3><Link to="/purchase-orders" className="small">All POs →</Link></div>
          <div className="mini-stats">
            <Link to="/purchase-orders?status=pending_approval" className="mini"><b>{data.po.pending_approval || 0}</b><span>Waiting for approval</span></Link>
            <div className="mini"><b>{data.po.open || 0}</b><span>Open POs</span></div>
            <div className="mini"><b>{money(data.po.open_value)}</b><span>Open PO value</span></div>
          </div>
          <div className="card-head" style={{ marginTop: 16 }}><h3>Low stock</h3><Link to="/inventory?low=1" className="small">Inventory →</Link></div>
          {data.lowStock.length === 0 ? <p className="muted">All items are above reorder level.</p> : (
            <div className="table-wrap"><table className="table compact"><tbody>
              {data.lowStock.map((p) => <tr key={p.id}><td>{p.name}<div className="muted small">{p.sku}</div></td><td className="num"><b className="text-danger">{p.stock_qty}</b> / {p.reorder_level} {p.unit}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Recent invoices</h3><Link to="/invoices" className="small">All invoices →</Link></div>
          <div className="table-wrap"><table className="table compact"><tbody>
            {data.recent.map((i) => (
              <tr key={i.id}><td><Link to={`/invoices/${i.id}`}>{i.doc_no}</Link><div className="muted small">{i.party_name}</div></td>
                <td className="muted small">{fmtDate(i.doc_date)}</td><td className="num">{money(i.total)}</td><td><Badge status={i.status} /></td></tr>
            ))}
          </tbody></table></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Top customers</h3></div>
          <div className="table-wrap"><table className="table compact"><tbody>
            {data.topCustomers.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{money(c.total)}</td></tr>)}
          </tbody></table></div>
        </div>
      </div>
    </>
  );
}
