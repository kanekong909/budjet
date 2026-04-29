const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

router.use(authMiddleware);

// GET /api/pagos/planes
router.get('/planes', async (req, res) => {
  const [planes] = await pool.query('SELECT * FROM planes WHERE activo = 1');
  res.json(planes);
});

// GET /api/pagos/mi-plan
router.get('/mi-plan', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, p.nombre AS plan_nombre, p.precio_mensual,
             p.max_obras, p.max_colaboradores, p.permite_pdf, p.permite_auditoria
      FROM suscripciones s
      JOIN planes p ON p.id = s.plan_id
      WHERE s.usuario_id = ?
    `, [req.usuario.id]);

    if (!rows.length) {
      return res.json({ plan: 'gratis', estado: 'sin_suscripcion' });
    }

    const s = rows[0];
    const vencida = new Date(s.fecha_vencimiento) < new Date();
    res.json({ ...s, vencida });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/pagos/webhook — Wompi notifica el pago
router.post('/webhook', async (req, res) => {
  try {
    // Verificar firma de Wompi
    const signature = req.headers['x-event-checksum'];
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHash('sha256')
      .update(body + process.env.WOMPI_PRIVATE_KEY)
      .digest('hex');

    if (signature !== expected) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const { event, data } = req.body;
    if (event === 'transaction.updated' && data.transaction.status === 'APPROVED') {
      const ref = data.transaction.reference; // formato: userId_planId_timestamp
      const [userId, planId] = ref.split('_');

      // Activar suscripción por 30 días
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 30);

      await pool.query(`
        INSERT INTO suscripciones (usuario_id, plan_id, estado, fecha_inicio, fecha_vencimiento)
        VALUES (?, ?, 'activa', CURDATE(), ?)
        ON DUPLICATE KEY UPDATE
          plan_id = VALUES(plan_id),
          estado = 'activa',
          fecha_inicio = CURDATE(),
          fecha_vencimiento = VALUES(fecha_vencimiento)
      `, [userId, planId, vencimiento.toISOString().split('T')[0]]);

      // Registrar pago
      await pool.query(
        'INSERT INTO pagos (usuario_id, plan_id, monto, referencia, estado, pasarela) VALUES (?, ?, ?, ?, "aprobado", "wompi")',
        [userId, planId, data.transaction.amount_in_cents / 100, ref]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error webhook' });
  }
});

module.exports = router;