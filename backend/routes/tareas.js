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

// GET /api/tareas?obra_id=
router.get('/', async (req, res) => {
  try {
    const { obra_id } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const [tareas] = await pool.query(`
      SELECT t.*,
        u.nombre AS creador_nombre,
        uc.nombre AS completado_por_nombre
      FROM tareas t
      LEFT JOIN usuarios u ON u.id = t.creador_id
      LEFT JOIN usuarios uc ON uc.id = t.completado_por
      WHERE t.obra_id = ?
      ORDER BY FIELD(t.estado,'pendiente','en_progreso','hecho'), t.creado_en DESC
    `, [obra_id]);

    res.json(tareas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/tareas
router.post('/', async (req, res) => {
  try {
    const { obra_id, titulo, descripcion, fecha_limite } = req.body;
    if (!obra_id || !titulo) return res.status(400).json({ error: 'obra_id y titulo requeridos' });

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const [result] = await pool.query(
      'INSERT INTO tareas (obra_id, creador_id, titulo, descripcion, fecha_limite) VALUES (?, ?, ?, ?, ?)',
      [obra_id, req.usuario.id, titulo, descripcion || null, fecha_limite || null]
    );

    const [tarea] = await pool.query(`
      SELECT t.*, u.nombre AS creador_nombre
      FROM tareas t LEFT JOIN usuarios u ON u.id = t.creador_id
      WHERE t.id = ?
    `, [result.insertId]);

    res.status(201).json(tarea[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/tareas/:id/estado — cambiar estado
router.put('/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!['pendiente','en_progreso','hecho'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const [tarea] = await pool.query('SELECT * FROM tareas WHERE id = ?', [req.params.id]);
    if (!tarea.length) return res.status(404).json({ error: 'Tarea no encontrada' });

    const rol = await verificarAcceso(tarea[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    const completado_por = estado === 'hecho' ? req.usuario.id : null;
    const completado_en = estado === 'hecho' ? new Date() : null;

    await pool.query(
      'UPDATE tareas SET estado=?, completado_por=?, completado_en=? WHERE id=?',
      [estado, completado_por, completado_en, req.params.id]
    );

    res.json({ mensaje: 'Estado actualizado', estado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/tareas/:id — editar tarea
router.put('/:id', async (req, res) => {
  try {
    const { titulo, descripcion, fecha_limite } = req.body;
    const [tarea] = await pool.query('SELECT * FROM tareas WHERE id = ?', [req.params.id]);
    if (!tarea.length) return res.status(404).json({ error: 'Tarea no encontrada' });

    const rol = await verificarAcceso(tarea[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });
    if (tarea[0].creador_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el creador puede editar' });
    }

    await pool.query(
      'UPDATE tareas SET titulo=?, descripcion=?, fecha_limite=? WHERE id=?',
      [titulo, descripcion || null, fecha_limite || null, req.params.id]
    );
    res.json({ mensaje: 'Tarea actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/tareas/:id
router.delete('/:id', async (req, res) => {
  try {
    const [tarea] = await pool.query('SELECT * FROM tareas WHERE id = ?', [req.params.id]);
    if (!tarea.length) return res.status(404).json({ error: 'Tarea no encontrada' });

    const rol = await verificarAcceso(tarea[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });
    if (tarea[0].creador_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el creador puede eliminar' });
    }

    await pool.query('DELETE FROM tareas WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Tarea eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;