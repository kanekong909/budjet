const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
router.use(authMiddleware);

async function verificarAcceso(obraId, usuarioId) {
  const [rows] = await pool.query(
    'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
    [obraId, usuarioId]
  );
  return rows.length > 0 ? rows[0].rol : null;
}

// GET /api/chat?obra_id=&novedad_id=  (sin novedad_id = chat general de la obra)
router.get('/', async (req, res) => {
  try {
    const { obra_id, novedad_id } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });
    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const condicionNovedad = novedad_id ? 'AND m.novedad_id = ?' : 'AND m.novedad_id IS NULL';
    const params = novedad_id ? [obra_id, novedad_id] : [obra_id];

    const [mensajes] = await pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre
      FROM mensajes_chat m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.obra_id = ? ${condicionNovedad}
      ORDER BY m.creado_en ASC
      LIMIT 300
    `, params);
    res.json(mensajes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { obra_id, novedad_id, mensaje } = req.body;
    if (!obra_id || !mensaje?.trim()) {
      return res.status(400).json({ error: 'obra_id y mensaje son requeridos' });
    }
    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const [result] = await pool.query(
      'INSERT INTO mensajes_chat (obra_id, novedad_id, usuario_id, mensaje) VALUES (?, ?, ?, ?)',
      [obra_id, novedad_id || null, req.usuario.id, mensaje.trim()]
    );
    const [msg] = await pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre
      FROM mensajes_chat m LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.id = ?
    `, [result.insertId]);
    res.status(201).json(msg[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;