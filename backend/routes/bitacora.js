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

// GET /api/bitacora?obra_id=
router.get('/', async (req, res) => {
  try {
    const { obra_id } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const [notas] = await pool.query(`
      SELECT b.*, u.nombre AS autor_nombre
      FROM bitacora b
      LEFT JOIN usuarios u ON u.id = b.usuario_id
      WHERE b.obra_id = ?
      ORDER BY b.fecha DESC
    `, [obra_id]);

    res.json(notas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/bitacora — crear o actualizar nota del día (upsert)
router.post('/', async (req, res) => {
  try {
    const { obra_id, fecha, nota } = req.body;
    if (!obra_id || !fecha || !nota?.trim()) {
      return res.status(400).json({ error: 'obra_id, fecha y nota son requeridos' });
    }

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    // Upsert: si ya existe nota para esa fecha la actualiza
    await pool.query(`
      INSERT INTO bitacora (obra_id, usuario_id, fecha, nota)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE nota = VALUES(nota), usuario_id = VALUES(usuario_id), actualizado_en = NOW()
    `, [obra_id, req.usuario.id, fecha, nota.trim()]);

    const [result] = await pool.query(`
      SELECT b.*, u.nombre AS autor_nombre
      FROM bitacora b
      LEFT JOIN usuarios u ON u.id = b.usuario_id
      WHERE b.obra_id = ? AND b.fecha = ?
    `, [obra_id, fecha]);

    res.status(201).json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/bitacora/:id
router.delete('/:id', async (req, res) => {
  try {
    const [nota] = await pool.query('SELECT * FROM bitacora WHERE id = ?', [req.params.id]);
    if (!nota.length) return res.status(404).json({ error: 'Nota no encontrada' });

    const rol = await verificarAcceso(nota[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });
    if (nota[0].usuario_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso' });
    }

    await pool.query('DELETE FROM bitacora WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Nota eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;