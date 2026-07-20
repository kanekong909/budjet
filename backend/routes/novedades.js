const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const { registrarAuditoria } = require('../middleware/auditoria');
router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo imágenes'));
  }
});

async function subirImagen(buffer) {
  if (!process.env.CLOUDINARY_API_KEY) return null;
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'obra-novedades', resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

async function verificarAcceso(obraId, usuarioId) {
  const [rows] = await pool.query(
    'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
    [obraId, usuarioId]
  );
  return rows.length > 0 ? rows[0].rol : null;
}

// GET /api/novedades?obra_id=&estado=pendiente
router.get('/', async (req, res) => {
  try {
    const { obra_id, estado } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });
    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const filtroEstado = estado ? 'AND n.estado = ?' : '';
    const params = [obra_id];
    if (estado) params.push(estado);

    const [novedades] = await pool.query(`
      SELECT n.*,
        u.nombre AS usuario_nombre,
        ur.nombre AS resuelta_por_nombre
      FROM novedades n
      LEFT JOIN usuarios u  ON u.id  = n.usuario_id
      LEFT JOIN usuarios ur ON ur.id = n.resuelta_por
      WHERE n.obra_id = ? ${filtroEstado}
      ORDER BY FIELD(n.estado,'pendiente','resuelta'), n.creado_en DESC
    `, params);
    res.json(novedades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/novedades  (multipart: descripcion, foto opcional)
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { obra_id, descripcion } = req.body;
    if (!obra_id || !descripcion?.trim()) {
      return res.status(400).json({ error: 'obra_id y descripcion son requeridos' });
    }
    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    let foto_url = null;
    if (req.file) {
      foto_url = await subirImagen(req.file.buffer);
      if (!foto_url) return res.status(500).json({ error: 'Error subiendo foto. Verifica Cloudinary.' });
    }

    const [result] = await pool.query(
      'INSERT INTO novedades (obra_id, usuario_id, descripcion, foto_url) VALUES (?, ?, ?, ?)',
      [obra_id, req.usuario.id, descripcion.trim(), foto_url]
    );
    const [novedad] = await pool.query(`
      SELECT n.*, u.nombre AS usuario_nombre
      FROM novedades n LEFT JOIN usuarios u ON u.id = n.usuario_id
      WHERE n.id = ?
    `, [result.insertId]);

    await registrarAuditoria({
      req, accion: 'CREAR', entidad: 'novedad', entidad_id: result.insertId,
      obra_id, datos_despues: { descripcion: descripcion.trim().slice(0, 200) }
    });

    res.status(201).json(novedad[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/novedades/:id/estado — solo admin resuelve o reabre
router.put('/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['pendiente', 'resuelta'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const [novedad] = await pool.query('SELECT * FROM novedades WHERE id = ?', [req.params.id]);
    if (!novedad.length) return res.status(404).json({ error: 'Novedad no encontrada' });
    const rol = await verificarAcceso(novedad[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });
    if (rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede cambiar el estado' });

    const resuelta_por = estado === 'resuelta' ? req.usuario.id : null;
    const resuelta_en  = estado === 'resuelta' ? new Date() : null;
    await pool.query(
      'UPDATE novedades SET estado=?, resuelta_por=?, resuelta_en=? WHERE id=?',
      [estado, resuelta_por, resuelta_en, req.params.id]
    );

    await registrarAuditoria({
      req, accion: 'EDITAR', entidad: 'novedad', entidad_id: req.params.id,
      obra_id: novedad[0].obra_id, datos_despues: { estado }
    });

    res.json({ mensaje: 'Estado actualizado', estado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/novedades/:id — reportero o admin
router.delete('/:id', async (req, res) => {
  try {
    const [novedad] = await pool.query('SELECT * FROM novedades WHERE id = ?', [req.params.id]);
    if (!novedad.length) return res.status(404).json({ error: 'Novedad no encontrada' });
    const rol = await verificarAcceso(novedad[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });
    if (novedad[0].usuario_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo quien la reportó o un admin puede eliminarla' });
    }
    await pool.query('DELETE FROM novedades WHERE id = ?', [req.params.id]);

    await registrarAuditoria({
      req, accion: 'ELIMINAR', entidad: 'novedad', entidad_id: req.params.id,
      obra_id: novedad[0].obra_id
    });

    res.json({ mensaje: 'Novedad eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;