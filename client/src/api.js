const TOKEN_KEY = 'mi_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(method, url, body, { raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${url}`, { method, headers, body: payload });
  if (res.status === 401 && !url.startsWith('/auth/login')) {
    setToken(null);
    if (!location.pathname.startsWith('/login')) location.href = '/login';
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  upload: (u, formData) => request('POST', u, formData),
};

/** Download a file from an authenticated endpoint (GET or POST). */
export async function download(url, filename, body) {
  const res = await request(body ? 'POST' : 'GET', url, body, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Open an authenticated PDF in a new tab. */
export async function openPdf(url) {
  const w = window.open('', '_blank');
  const res = await request('GET', url, null, { raw: true });
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  if (w) w.location.href = href; else window.location.href = href;
}

export const money = (n, currency = 'INR') =>
  currency === 'INR'
    ? '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : `${currency} ${Number(n || 0).toFixed(2)}`;

export const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
};
export const today = () => new Date().toISOString().slice(0, 10);
