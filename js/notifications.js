// ============================================================
// NOTIFICATIONS.JS — Push notifications con Firebase
// ============================================================

const VAPID_KEY = 'DEsAEqmTnjRPCApw27FSzDosBQRPUtSnTHKfKo9XzlM';

// Inicializar Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDZA5_zkZei7PkBPa3DUjz7HV9AcaN7c6Y",
  authDomain: "obra-gastos.firebaseapp.com",
  projectId: "obra-gastos",
  storageBucket: "obra-gastos.firebasestorage.app",
  messagingSenderId: "439582720185",
  appId: "1:439582720185:web:2ed943a0590496bb3c1b68"
};

let messaging = null;

async function initFirebase() {
  try {
    // Cargar Firebase dinámicamente
    if (!window.firebase) return;
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
  } catch (e) {
    console.log('Firebase ya inicializado o error:', e.message);
    try { messaging = firebase.messaging(); } catch (e2) {}
  }
}

// ── Solicitar permiso y obtener token ──
async function solicitarPermisoPush() {
  if (!('Notification' in window)) {
    showToast('Tu navegador no soporta notificaciones', 'error');
    return null;
  }

  if (Notification.permission === 'denied') {
    showToast('Notificaciones bloqueadas. Actívalas en configuración del navegador.', 'error');
    return null;
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return null;

  try {
    await initFirebase();
    if (!messaging) return null;

    // Registrar el SW manualmente con la ruta correcta para GitHub Pages
    const swRegistration = await navigator.serviceWorker.register(
      '/budjet/firebase-messaging-sw.js',
      { scope: '/budjet/' }
    );

    // Esperar a que el SW esté activo
    await new Promise((resolve, reject) => {
      if (swRegistration.active) { resolve(); return; }
      const sw = swRegistration.installing || swRegistration.waiting;
      if (!sw) { reject(new Error('No SW found')); return; }
      sw.addEventListener('statechange', e => {
        if (e.target.state === 'activated') resolve();
        if (e.target.state === 'redundant') reject(new Error('SW redundant'));
      });
      // Timeout de seguridad
      setTimeout(resolve, 4000);
    });

    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
    if (token) {
      // Guardar token en el backend
      await api.post('/api/notificaciones/token', { token });
      localStorage.setItem('og_push_token', token);
      showToast('✅ Notificaciones activadas');
      return token;
    }
  } catch (err) {
    console.error('Error obteniendo token FCM:', err);
    showToast('Error activando notificaciones', 'error');
  }
  return null;
}

// ── Verificar si ya tiene permiso ──
async function verificarNotificaciones() {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const token = localStorage.getItem('og_push_token');
  return !!token;
}

// ── Manejar mensajes cuando la app está abierta ──
async function iniciarListenerForeground() {
  await initFirebase();
  if (!messaging) return;
  messaging.onMessage(payload => {
    const { title, body } = payload.notification || {};
    if (title) showToast(`🔔 ${title}: ${body}`, 'ok');
  });
}
