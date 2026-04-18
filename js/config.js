// ============================================================
// CONFIGURACIÓN — Edita esta línea con tu URL de Railway
// ============================================================
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'       // ← local
  : 'https://budjet-production.up.railway.app'; // ← producción

// ============================================================
// Cliente API — maneja auth y errores automáticamente
// ============================================================
const api = {
  token: () => localStorage.getItem('og_token'),

  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const t = this.token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  },

  async request(method, path, body = null, isFormData = false) {
    const opts = { method, headers: isFormData ? { 'Authorization': `Bearer ${this.token()}` } : this.headers() };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(API_URL + path, opts);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      localStorage.removeItem('og_token');
      localStorage.removeItem('og_usuario');
      window.location.href = 'index.html';
      throw new Error('Sesión expirada');
    }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  },

  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),
  postForm: (path, formData) => api.request('POST', path, formData, true),
  putForm: (path, formData) => api.request('PUT', path, formData, true),
};

// ============================================================
// Utilidades globales
// ============================================================
const usuario = () => JSON.parse(localStorage.getItem('og_usuario') || 'null');
const obraActual = () => JSON.parse(localStorage.getItem('og_obra') || 'null');

function guardarSesion(token, usuario) {
  localStorage.setItem('og_token', token);
  localStorage.setItem('og_usuario', JSON.stringify(usuario));
}

function formatMoney(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).substring(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return '';
  const fecha = new Date(y, m - 1, d);
  return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function showToast(msg, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.orig = btn.textContent;
    btn.textContent = 'Cargando…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.orig || btn.textContent;
    btn.disabled = false;
  }
}

// Proteger páginas que requieren auth
function requireAuth() {
  if (!api.token()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// Cerrar sesión
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// Sheets / overlays — disponibles en todas las páginas
function cerrarSheet(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function abrirSheet(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
