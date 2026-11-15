// Per-document-type config shared by list / form / view pages
export const DOCS = {
  invoice: {
    kind: 'invoice', api: '/invoices', path: '/invoices', label: 'Invoice', plural: 'Invoices',
    party: 'Customer', partyApi: '/customers', noLabel: 'Invoice No.', dateLabel: 'Invoice Date',
    dueLabel: 'Due Date', refLabel: 'Customer PO No.', priceField: 'sale_price',
    tabs: [['', 'All'], ['draft', 'Draft'], ['unpaid', 'Unpaid'], ['partially_paid', 'Partly paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']],
  },
  quotation: {
    kind: 'quotation', api: '/quotations', path: '/quotations', label: 'Quotation', plural: 'Quotations',
    party: 'Customer', partyApi: '/customers', noLabel: 'Offer No.', dateLabel: 'Offer Date',
    dueLabel: 'Offer Validity Date', refLabel: 'Enquiry Ref', priceField: 'sale_price',
    tabs: [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['converted', 'Converted'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']],
  },
  po: {
    kind: 'po', api: '/purchase-orders', path: '/purchase-orders', label: 'Purchase Order', plural: 'Purchase Orders',
    party: 'Vendor', partyApi: '/vendors', noLabel: 'PO No.', dateLabel: 'Document Date',
    dueLabel: null, refLabel: 'Vendor Quote Ref', priceField: 'purchase_price',
    tabs: [['', 'All'], ['draft', 'Draft'], ['pending_approval', 'Pending approval'], ['approved', 'Approved'], ['sent', 'Sent'], ['partially_received', 'Partly received'], ['received', 'Received'], ['closed', 'Closed'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']],
  },
};

/** endpoint + body for sending a document on a channel */
export function sendRequest(kind, id, channel, body) {
  const cfg = DOCS[kind];
  if (kind === 'po') return [`${cfg.api}/${id}/send`, { ...body, channel }];
  return [`${cfg.api}/${id}/${channel}`, body];
}

export const canSend = (kind, status) =>
  kind === 'invoice' ? !['draft', 'cancelled'].includes(status)
    : kind === 'po' ? ['approved', 'sent', 'partially_received', 'received'].includes(status)
      : !['cancelled'].includes(status);
