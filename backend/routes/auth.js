const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

async function obtenerLimitesPlan(usuarioId) {
  const [rows] = await pool.query(`
    SELECT p.max_obras, p.max_colaboradores, p.permite_pdf, p.permite_auditoria, s.fecha_vencimiento
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE s.usuario_id = ? AND s.estado = 'activa'
  `, [usuarioId]);

  if (!rows.length || new Date(rows[0].fecha_vencimiento) < new Date()) {
    // Sin suscripción activa (o vencida) = plan gratis. Ajusta estos
    // números a lo que de verdad quieras regalar en el plan gratis.
    return { max_obras: 1, max_colaboradores: 3, permite_pdf: false, permite_auditoria: false };
  }
  return rows[0];
}

// POST /api/auth/registro
router.post('/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const [existing] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Este correo ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, "admin")',
      [nombre, email, hash]
    );

    const token = jwt.sign(
      { id: result.insertId, nombre, email, rol: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ token, usuario: { id: result.insertId, nombre, email, rol: 'admin' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = rows[0];
    const valid = await bcrypt.compare(password, usuario.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/invitar - Agregar colaborador a obra
router.post('/invitar', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { email, obra_id, rol = 'colaborador' } = req.body;
    const [usuarios] = await pool.query('SELECT id, nombre, email FROM usuarios WHERE email = ?', [email]);

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado. Primero debe registrarse.' });
    }

    const [obraInfo] = await pool.query('SELECT creador_id FROM obras WHERE id = ?', [obra_id]);
    if (!obraInfo.length) return res.status(404).json({ error: 'Obra no encontrada' });

    const limites = await obtenerLimitesPlan(obraInfo[0].creador_id);
    const [totalColaboradores] = await pool.query(
      'SELECT COUNT(*) as total FROM obra_usuarios WHERE obra_id = ?',
      [obra_id]
    );
    if (totalColaboradores[0].total >= limites.max_colaboradores) {
      return res.status(403).json({
        error: `Esta obra ya tiene el máximo de ${limites.max_colaboradores} colaboradores para su plan.`,
        codigo: 'LIMITE_PLAN'
      });
    }

    const usuario = usuarios[0];
    await pool.query(
      'INSERT IGNORE INTO obra_usuarios (obra_id, usuario_id, rol) VALUES (?, ?, ?)',
      [obra_id, usuario.id, rol]
    );

    res.json({ mensaje: 'Colaborador agregado', usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/auth/fondo — guardar URL de fondo
router.put('/fondo', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { fondo_url } = req.body;
    await pool.query('UPDATE usuarios SET fondo_url = ? WHERE id = ?', [fondo_url || null, req.usuario.id]);
    res.json({ mensaje: 'Fondo actualizado', fondo_url });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/auth/perfil — obtener datos del usuario incluyendo fondo
router.get('/perfil', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, nombre, email, rol, fondo_url, logo_empresa_url FROM usuarios WHERE id = ?', [req.usuario.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/auth/password — cambiar contraseña
router.put('/password', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;
    if (!password_actual || !password_nueva) {
      return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    }
    if (password_nueva.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const valida = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!valida) return res.status(401).json({ error: 'La contraseña actual no es correcta' });

    const nuevoHash = await bcrypt.hash(password_nueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [nuevoHash, req.usuario.id]);

    res.json({ mensaje: 'Contraseña actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/auth/perfil — actualizar nombre
router.put('/perfil', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    await pool.query('UPDATE usuarios SET nombre = ? WHERE id = ?', [nombre.trim(), req.usuario.id]);
    res.json({ mensaje: 'Perfil actualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/fondo-upload', require('../middleware/auth').authMiddleware, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    if (!process.env.CLOUDINARY_API_KEY) return res.status(500).json({ error: 'Cloudinary no configurado' });

    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'trackob-fondos', resource_type: 'image', transformation: [{ width: 1920, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }] },
        (error, result) => error ? reject(error) : resolve(result.secure_url)
      );
      stream.end(req.file.buffer);
    });

    // Guardar en BD también
    await pool.query('UPDATE usuarios SET fondo_url = ? WHERE id = ?', [url, req.usuario.id]);

    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error subiendo imagen' });
  }
});

// PUT /api/auth/logo-empresa — guardar o quitar el logo (mandando null)
router.put('/logo-empresa', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { logo_url } = req.body;
    await pool.query('UPDATE usuarios SET logo_empresa_url = ? WHERE id = ?', [logo_url || null, req.usuario.id]);
    res.json({ mensaje: 'Logo actualizado', logo_url });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/logo-empresa-upload
router.post('/logo-empresa-upload', require('../middleware/auth').authMiddleware, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    if (!process.env.CLOUDINARY_API_KEY) return res.status(500).json({ error: 'Cloudinary no configurado' });
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'trackob-logos', resource_type: 'image', transformation: [{ width: 600, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }] },
        (error, result) => error ? reject(error) : resolve(result.secure_url)
      );
      stream.end(req.file.buffer);
    });
    await pool.query('UPDATE usuarios SET logo_empresa_url = ? WHERE id = ?', [url, req.usuario.id]);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error subiendo imagen' });
  }
});

module.exports = router;
