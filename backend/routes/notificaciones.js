const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// ── Firebase Admin SDK ──
let admin = null;

function getFirebaseAdmin() {
  if (admin) return admin;
  try {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
      });
    }
  } catch (e) {
    console.error('Error inicializando Firebase Admin:', e.message);
    admin = null;
  }
  return admin;
}

// ── Tabla de tokens (crear si no existe) ──
async function initTablaTokens() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      token VARCHAR(500) NOT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_token (token),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);
}
initTablaTokens().catch(console.error);

// ── Guardar token FCM ──
router.post('/token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token requerido' });

    await pool.query(
      'INSERT INTO push_tokens (usuario_id, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id)',
      [req.usuario.id, token]
    );
    res.json({ mensaje: 'Token guardado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Eliminar token (desuscribirse) ──
router.delete('/token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    await pool.query('DELETE FROM push_tokens WHERE token = ? AND usuario_id = ?', [token, req.usuario.id]);
    res.json({ mensaje: 'Token eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Función para enviar notificación a un token ──
async function enviarNotificacion(token, titulo, cuerpo, data = {}) {
  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) return false;

  try {
    await firebaseAdmin.messaging().send({
      token,
      notification: { title: titulo, body: cuerpo },
      data,
      webpush: {
        notification: {
          title: titulo,
          body: cuerpo,
          icon: '/assets/icons/logo.svg',
          badge: '/assets/icons/logo.svg',
          tag: 'tareas-pendientes',
          renotify: true
        },
        fcmOptions: { link: '/obra.html' }
      }
    });
    return true;
  } catch (err) {
    // Token inválido — eliminarlo
    if (err.code === 'messaging/registration-token-not-registered') {
      await pool.query('DELETE FROM push_tokens WHERE token = ?', [token]);
    }
    return false;
  }
}

// ── Notificar tareas pendientes a todos los usuarios ──
async function notificarTareasPendientes() {
  try {
    // Buscar usuarios con tareas pendientes o en progreso
    const [usuarios] = await pool.query(`
      SELECT DISTINCT
        u.id AS usuario_id,
        u.nombre,
        COUNT(t.id) AS total_pendientes,
        GROUP_CONCAT(DISTINCT o.nombre ORDER BY o.nombre SEPARATOR ', ') AS obras
      FROM usuarios u
      JOIN obra_usuarios ou ON ou.usuario_id = u.id
      JOIN obras o ON o.id = ou.obra_id AND o.activa = 1
      JOIN tareas t ON t.obra_id = o.id AND t.estado IN ('pendiente', 'en_progreso')
      JOIN push_tokens pt ON pt.usuario_id = u.id
      GROUP BY u.id
    `);

    for (const usuario of usuarios) {
      // Obtener sus tokens
      const [tokens] = await pool.query(
        'SELECT token FROM push_tokens WHERE usuario_id = ?',
        [usuario.usuario_id]
      );

      const titulo = `🏗️ Tienes ${usuario.total_pendientes} tarea${usuario.total_pendientes > 1 ? 's' : ''} pendiente${usuario.total_pendientes > 1 ? 's' : ''}`;
      const cuerpo = `En: ${usuario.obras}`;

      for (const { token } of tokens) {
        await enviarNotificacion(token, titulo, cuerpo, {
          tipo: 'tareas_pendientes',
          total: String(usuario.total_pendientes)
        });
      }
    }

    console.log(`✅ Notificaciones enviadas a ${usuarios.length} usuario(s)`);
  } catch (err) {
    console.error('Error enviando notificaciones:', err);
  }
}

// ── Cron job cada 8 horas ──
function iniciarCronNotificaciones() {
  const OCHO_HORAS = 8 * 60 * 60 * 1000;

  // Ejecutar al iniciar (después de 30 segundos para que la BD esté lista)
  setTimeout(() => {
    notificarTareasPendientes();
    // Luego cada 8 horas
    setInterval(notificarTareasPendientes, OCHO_HORAS);
  }, 30000);

  console.log('⏰ Cron de notificaciones iniciado (cada 8 horas)');
}

module.exports = { router, iniciarCronNotificaciones };
