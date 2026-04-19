const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');

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
      { folder: 'obra-progreso', resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// GET /api/progreso?obra_id=
router.get('/', async (req, res) => {
  try {
    const { obra_id } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });

    const [rows] = await pool.query(`
      SELECT p.*, u.nombre AS usuario_nombre
      FROM progreso_fotos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.obra_id = ?
      ORDER BY p.fecha DESC, p.creado_en DESC
    `, [obra_id]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/progreso
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { obra_id, fecha, etapa } = req.body;
    if (!obra_id || !req.file) return res.status(400).json({ error: 'obra_id y foto son requeridos' });

    const foto_url = await subirImagen(req.file.buffer);
    if (!foto_url) return res.status(500).json({ error: 'Error subiendo foto. Verifica Cloudinary.' });

    const [result] = await pool.query(
      'INSERT INTO progreso_fotos (obra_id, usuario_id, foto_url, fecha, etapa) VALUES (?, ?, ?, ?, ?)',
      [obra_id, req.usuario.id, foto_url, fecha || new Date().toISOString().split('T')[0], etapa || null]
    );

    res.status(201).json({ id: result.insertId, foto_url, fecha, etapa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/progreso/:id
router.delete('/:id', async (req, res) => {
  try {
    const [foto] = await pool.query('SELECT * FROM progreso_fotos WHERE id = ?', [req.params.id]);
    if (!foto.length) return res.status(404).json({ error: 'Foto no encontrada' });
    if (foto[0].usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Sin permiso' });

    await pool.query('DELETE FROM progreso_fotos WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Foto eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;