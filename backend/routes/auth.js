const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

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

module.exports = router;
