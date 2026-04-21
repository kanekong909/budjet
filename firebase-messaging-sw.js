importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "REEMPLAZA_CON_TU_NUEVA_API_KEY",
  authDomain: "obra-gastos.firebaseapp.com",
  projectId: "obra-gastos",
  storageBucket: "obra-gastos.firebasestorage.app",
  messagingSenderId: "439582720185",
  appId: "1:439582720185:web:2ed943a0590496bb3c1b68"
});

const messaging = firebase.messaging();

// Manejar notificaciones cuando la app está en segundo plano
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: './assets/icons/logo.svg',
    badge: './assets/icons/logo.svg',
    tag: 'tareas-pendientes',
    renotify: true,
    data: payload.data
  });
});

// Al hacer clic en la notificación, abrir la app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('obra.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./dashboard.html');
      }
    })
  );
});
