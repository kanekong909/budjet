// ============================================================
// OFFLINE.JS — IndexedDB + Sincronización automática
// ============================================================

const DB_NAME = 'obra-gastos-offline';
const DB_VERSION = 1;
let db = null;

// ── Inicializar IndexedDB ──
function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      // Cola de gastos pendientes de sincronizar
      if (!db.objectStoreNames.contains('gastos_pendientes')) {
        const store = db.createObjectStore('gastos_pendientes', { keyPath: 'offline_id', autoIncrement: true });
        store.createIndex('obra_id', 'obra_id', { unique: false });
      }

      // Cola de tareas pendientes
      if (!db.objectStoreNames.contains('tareas_pendientes')) {
        const store = db.createObjectStore('tareas_pendientes', { keyPath: 'offline_id', autoIncrement: true });
        store.createIndex('obra_id', 'obra_id', { unique: false });
      }

      // Cache de gastos para ver offline
      if (!db.objectStoreNames.contains('gastos_cache')) {
        const store = db.createObjectStore('gastos_cache', { keyPath: 'id' });
        store.createIndex('obra_id', 'obra_id', { unique: false });
      }

      // Cache de tareas
      if (!db.objectStoreNames.contains('tareas_cache')) {
        const store = db.createObjectStore('tareas_cache', { keyPath: 'id' });
        store.createIndex('obra_id', 'obra_id', { unique: false });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ── Helpers IndexedDB ──
function dbTransaction(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function dbGetAll(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const store = dbTransaction(storeName);
    const req = indexName
      ? store.index(indexName).getAll(value)
      : store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(storeName, data) {
  return new Promise((resolve, reject) => {
    const store = dbTransaction(storeName, 'readwrite');
    const req = store.add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = dbTransaction(storeName, 'readwrite');
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const store = dbTransaction(storeName, 'readwrite');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbPutAll(storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Estado de conexión ──
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
  isOnline = true;
  mostrarEstadoConexion(true);
  sincronizarPendientes();
});

window.addEventListener('offline', () => {
  isOnline = false;
  mostrarEstadoConexion(false);
});

function mostrarEstadoConexion(online) {
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 50%; transform: translateX(-50%);
      width: 100%; max-width: 480px; z-index: 9999;
      padding: 8px 16px; text-align: center;
      font-size: .82rem; font-weight: 600;
      transition: all .3s; font-family: var(--font);
    `;
    document.body.appendChild(banner);
  }

  if (!online) {
    banner.style.background = '#ff3b30';
    banner.style.color = 'white';
    banner.textContent = '📵 Sin internet — los cambios se guardarán localmente';
    banner.style.display = 'block';
  } else {
    banner.style.background = '#34c759';
    banner.style.color = 'white';
    banner.textContent = '✅ Conexión restaurada — sincronizando…';
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 3000);
  }
}

// Mostrar estado inicial si no hay internet
if (!isOnline) mostrarEstadoConexion(false);

// ── Guardar gasto offline ──
async function guardarGastoOffline(formData) {
  // Convertir FormData a objeto (sin foto, se ignora offline)
  const data = {
    descripcion: formData.get('descripcion'),
    monto: formData.get('monto'),
    fecha: formData.get('fecha'),
    obra_id: parseInt(formData.get('obra_id')),
    categoria_id: formData.get('categoria_id') || null,
    categorias: formData.get('categorias') || '[]',
    proveedor: formData.get('proveedor') || null,
    notas: formData.get('notas') || null,
    cantidad: formData.get('cantidad') || null,
    unidad: formData.get('unidad') || null,
    valor_unitario: formData.get('valor_unitario') || null,
    _offline: true,
    _timestamp: Date.now(),
    // Para mostrar en UI antes de sincronizar
    id: `offline_${Date.now()}`,
    usuario_nombre: usuario()?.nombre || 'Tú',
    categorias_parsed: JSON.parse(formData.get('categorias') || '[]')
  };

  await dbAdd('gastos_pendientes', data);

  // Agregar al cache local para mostrar inmediatamente
  const gastoUI = {
    ...data,
    id: data.id,
    categorias: data.categorias_parsed,
    categoria_nombre: data.categorias_parsed.map ? '' : '',
    _pendiente: true
  };

  showToast('💾 Gasto guardado localmente', 'ok');
  return gastoUI;
}

// ── Guardar tarea offline ──
async function guardarTareaOffline(data) {
  const tarea = {
    ...data,
    _offline: true,
    _timestamp: Date.now(),
    id: `offline_${Date.now()}`,
    estado: 'pendiente',
    creador_nombre: usuario()?.nombre || 'Tú'
  };

  await dbAdd('tareas_pendientes', tarea);
  showToast('💾 Tarea guardada localmente', 'ok');
  return tarea;
}

// ── Sincronizar pendientes cuando vuelve el internet ──
async function sincronizarPendientes() {
  if (!isOnline) return;

  const gastosPendientes = await dbGetAll('gastos_pendientes');
  const tareasPendientes = await dbGetAll('tareas_pendientes');

  if (!gastosPendientes.length && !tareasPendientes.length) return;

  let sincronizados = 0;
  let errores = 0;

  // Sincronizar gastos
  for (const gasto of gastosPendientes) {
    try {
      const fd = new FormData();
      fd.append('descripcion', gasto.descripcion);
      fd.append('monto', gasto.monto);
      fd.append('fecha', gasto.fecha);
      fd.append('obra_id', gasto.obra_id);
      fd.append('categorias', gasto.categorias);
      if (gasto.proveedor) fd.append('proveedor', gasto.proveedor);
      if (gasto.notas) fd.append('notas', gasto.notas);
      if (gasto.cantidad) fd.append('cantidad', gasto.cantidad);
      if (gasto.unidad) fd.append('unidad', gasto.unidad);
      if (gasto.valor_unitario) fd.append('valor_unitario', gasto.valor_unitario);

      await api.postForm('/api/gastos', fd);
      await dbDelete('gastos_pendientes', gasto.offline_id);
      sincronizados++;
    } catch (e) {
      errores++;
    }
  }

  // Sincronizar tareas
  for (const tarea of tareasPendientes) {
    try {
      await api.post('/api/tareas', {
        titulo: tarea.titulo,
        descripcion: tarea.descripcion,
        fecha_limite: tarea.fecha_limite,
        obra_id: tarea.obra_id
      });
      await dbDelete('tareas_pendientes', tarea.offline_id);
      sincronizados++;
    } catch (e) {
      errores++;
    }
  }

  if (sincronizados > 0) {
    showToast(`✅ ${sincronizados} registro${sincronizados > 1 ? 's' : ''} sincronizado${sincronizados > 1 ? 's' : ''}`, 'ok');
    // Recargar datos si estamos en obra.html
    if (typeof cargarGastos === 'function') cargarGastos();
    if (typeof cargarTareas === 'function') cargarTareas();
  }

  if (errores > 0) {
    showToast(`⚠️ ${errores} registro${errores > 1 ? 's' : ''} no se pudieron sincronizar`, 'error');
  }
}

// ── Cache de gastos para ver offline ──
async function cachearGastos(gastos) {
  if (!db) return;
  try { await dbPutAll('gastos_cache', gastos); } catch (e) {}
}

async function obtenerGastosCache(obraId) {
  if (!db) return [];
  return dbGetAll('gastos_cache', 'obra_id', obraId);
}

async function cachearTareas(tareas) {
  if (!db) return;
  try { await dbPutAll('tareas_cache', tareas); } catch (e) {}
}

async function obtenerTareasCache(obraId) {
  if (!db) return [];
  return dbGetAll('tareas_cache', 'obra_id', obraId);
}

// ── Contador de pendientes ──
async function contarPendientes() {
  if (!db) return 0;
  const g = await dbGetAll('gastos_pendientes');
  const t = await dbGetAll('tareas_pendientes');
  return g.length + t.length;
}

async function mostrarBadgePendientes() {
  const total = await contarPendientes();
  let badge = document.getElementById('badge-offline');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'badge-offline';
    badge.style.cssText = `
      position: fixed; bottom: 76px; right: 16px;
      background: var(--amarillo); color: var(--gris-obra);
      border-radius: 20px; padding: 4px 10px;
      font-size: .75rem; font-weight: 700;
      z-index: 89; display: none;
      font-family: var(--font);
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
    `;
    document.body.appendChild(badge);
  }
  if (total > 0) {
    badge.textContent = `💾 ${total} pendiente${total > 1 ? 's' : ''}`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// Inicializar al cargar
initOfflineDB().then(() => {
  mostrarBadgePendientes();
  // Intentar sincronizar si hay internet al cargar
  if (isOnline) sincronizarPendientes();
});
