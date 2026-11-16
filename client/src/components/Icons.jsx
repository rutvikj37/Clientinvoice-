/** Lightweight inline SVG icons for the sidebar (no icon library). */
function Svg({ children, title }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconDashboard = () => (
  <Svg>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" />
    <rect x="13" y="10" width="8" height="11" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
  </Svg>
);

export const IconQuotation = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M9 13h6M9 17h4" />
  </Svg>
);

export const IconInvoice = () => (
  <Svg>
    <path d="M7 3h10a2 2 0 0 1 2 2v15l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V5a2 2 0 0 1 2-2z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);

export const IconUpload = () => (
  <Svg>
    <path d="M12 16V5" />
    <path d="M8 9l4-4 4 4" />
    <path d="M5 19h14" />
  </Svg>
);

export const IconCustomers = () => (
  <Svg>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M15 19a4.5 4.5 0 0 1 5.5-4.3" />
  </Svg>
);

export const IconPurchaseOrder = () => (
  <Svg>
    <path d="M4 8h12l3 5v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z" />
    <path d="M4 8V6a1 1 0 0 1 1-1h7" />
    <circle cx="8.5" cy="18.5" r="1.5" />
    <circle cx="16.5" cy="18.5" r="1.5" />
  </Svg>
);

export const IconVendors = () => (
  <Svg>
    <path d="M3 20V9l9-5 9 5v11" />
    <path d="M9 20v-6h6v6" />
    <path d="M3 20h18" />
  </Svg>
);

export const IconInventory = () => (
  <Svg>
    <path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" />
    <path d="M4 7l2-3h12l2 3" />
    <path d="M10 11h4" />
  </Svg>
);

export const IconSettings = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
  </Svg>
);

export const IconTasks = () => (
  <Svg>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6.5l1.2 1.2L7.8 5" />
    <path d="M4.5 12.5l1.2 1.2L7.8 11" />
    <rect x="3.5" y="16.5" width="4" height="4" rx="0.8" />
  </Svg>
);
