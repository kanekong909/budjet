const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');
const multer = require('multer');

// ⚠️ QUITAR: router.use(authMiddleware); (Se aplica por ruta para dejar el webhook público)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

async function subirComprobante(buffer, mimetype) {
  if (!process.env.CLOUDINARY_API_KEY) return null;
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'trackob-comprobantes', resource_type: 'auto' },
      (error, result) => error ? reject(error) : resolve(result.secure_url)
    );
    stream.end(buffer);
  });
}

// GET /api/pagos/planes (con o sin auth)
router.get('/planes', authMiddleware, async (req, res) => {
  try {
    const [planes] = await pool.query('SELECT * FROM planes WHERE activo = 1 ORDER BY precio_mensual ASC');
    res.json(planes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/pagos/mi-plan
router.get('/mi-plan', authMiddleware, async (req, res) => {
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

// GET /api/pagos/mis-pagos
router.get('/mis-pagos', authMiddleware, async (req, res) => {
  try {
    const [pagos] = await pool.query(`
      SELECT p.*, pl.nombre AS plan_nombre
      FROM pagos p
      LEFT JOIN planes pl ON pl.id = p.plan_id
      WHERE p.usuario_id = ?
      ORDER BY p.creado_en DESC
    `, [req.usuario.id]);
    res.json(pagos);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

function generarReferencia(usuarioId, planId) {
  return `${usuarioId}_${planId}_${Date.now()}`;
}

// POST /api/pagos/iniciar-wompi
router.post('/iniciar-wompi', authMiddleware, async (req, res) => {
  try {
    const { plan_id } = req.body;
    if (!process.env.WOMPI_INTEGRITY_SECRET) {
      return res.status(503).json({ error: 'Wompi todavía no está configurado' });
    }
    const [planes] = await pool.query('SELECT * FROM planes WHERE id = ? AND activo = 1', [plan_id]);
    if (!planes.length) return res.status(404).json({ error: 'Plan no encontrado' });
    const plan = planes[0];

    const referencia = generarReferencia(req.usuario.id, plan.id);
    const montoEnCentavos = Math.round(Number(plan.precio_mensual) * 100);
    const cadena = `${referencia}${montoEnCentavos}COP${process.env.WOMPI_INTEGRITY_SECRET}`;
    const firma = crypto.createHash('sha256').update(cadena).digest('hex');

    res.json({
      referencia,
      monto_en_centavos: montoEnCentavos,
      moneda: 'COP',
      llave_publica: process.env.WOMPI_PUBLIC_KEY,
      firma_integridad: firma
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/pagos/transferencia
router.post('/transferencia', authMiddleware, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const [planes] = await pool.query('SELECT * FROM planes WHERE id = ? AND activo = 1', [plan_id]);
    if (!planes.length) return res.status(404).json({ error: 'Plan no encontrado' });
    const plan = planes[0];

    const referencia = generarReferencia(req.usuario.id, plan.id);
    await pool.query(
      `INSERT INTO pagos (usuario_id, plan_id, monto, referencia, estado, pasarela, metodo)
       VALUES (?, ?, ?, ?, 'pendiente', 'manual', 'transferencia')`,
      [req.usuario.id, plan.id, plan.precio_mensual, referencia]
    );

    res.status(201).json({
      referencia,
      monto: plan.precio_mensual,
      plan_nombre: plan.nombre,
      datos_cuenta: process.env.CUENTA_BANCARIA_INFO || 'Contacta al administrador para los datos de la cuenta',
      instrucciones: `Transfiere ${plan.precio_mensual} e incluye la referencia "${referencia}" en la descripción. Luego sube el comprobante aquí mismo.`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/pagos/:referencia/comprobante
router.post('/:referencia/comprobante', authMiddleware, upload.single('comprobante'), async (req, res) => {
  try {
    const [pagos] = await pool.query('SELECT * FROM pagos WHERE referencia = ?', [req.params.referencia]);
    if (!pagos.length) return res.status(404).json({ error: 'Solicitud de pago no encontrada' });
    const pago = pagos[0];
    if (pago.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sin acceso' });
    if (pago.estado !== 'pendiente') return res.status(400).json({ error: 'Esta solicitud ya no está pendiente' });
    if (!req.file) return res.status(400).json({ error: 'Adjunta el comprobante' });

    const url = await subirComprobante(req.file.buffer, req.file.mimetype);
    if (!url) return res.status(500).json({ error: 'No se pudo subir el comprobante' });

    await pool.query(
      "UPDATE pagos SET comprobante_url = ?, estado = 'en_revision' WHERE id = ?",
      [url, pago.id]
    );
    res.json({ mensaje: 'Comprobante recibido, en revisión' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

async function activarSuscripcion(usuarioId, planId) {
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
  `, [usuarioId, planId, vencimiento.toISOString().split('T')[0]]);
}

// POST /api/pagos/webhook — PÚBLICO (Sin authMiddleware)
router.post('/webhook', async (req, res) => {
  try {
    const { event, data, signature, timestamp } = req.body;
    if (!signature?.properties?.length || !signature?.checksum || !timestamp) {
      return res.status(400).json({ error: 'Payload sin firma válida' });
    }

    function obtenerValor(obj, path) {
      return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
    }

    const cadena = signature.properties.map((prop) => obtenerValor(req.body, prop)).join('')
      + timestamp
      + process.env.WOMPI_EVENTS_SECRET;
    const checksumCalculado = crypto.createHash('sha256').update(cadena).digest('hex');

    if (checksumCalculado.toLowerCase() !== signature.checksum.toLowerCase()) {
      console.warn('Webhook de Wompi con firma inválida - posible intento de forjado');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    if (event === 'transaction.updated' && data.transaction.status === 'APPROVED') {
      const ref = data.transaction.reference;
      const [userId, planId] = ref.split('_');

      await activarSuscripcion(userId, planId);

      await pool.query(
        `INSERT INTO pagos (usuario_id, plan_id, monto, referencia, estado, pasarela, metodo)
         VALUES (?, ?, ?, ?, 'aprobado', 'wompi', 'wompi')
         ON DUPLICATE KEY UPDATE estado = 'aprobado'`,
        [userId, planId, data.transaction.amount_in_cents / 100, ref]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error webhook' });
  }
});

router.activarSuscripcion = activarSuscripcion;

module.exports = router;