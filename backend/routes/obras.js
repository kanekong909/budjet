const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/obras - Listar obras del usuario
router.get('/', async (req, res) => {
  try {
    const [obras] = await pool.query(`
      SELECT o.*, 
        u.nombre AS creador_nombre,
        ou.rol AS mi_rol,
        (SELECT COUNT(*) FROM gastos g WHERE g.obra_id = o.id) AS total_gastos_count,
        (SELECT COALESCE(SUM(g.monto), 0) FROM gastos g WHERE g.obra_id = o.id) AS total_gastado
      FROM obras o
      JOIN obra_usuarios ou ON ou.obra_id = o.id AND ou.usuario_id = ?
      JOIN usuarios u ON u.id = o.creador_id
      ORDER BY o.creado_en DESC
    `, [req.usuario.id]);

    res.json(obras);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/obras - Crear obra
router.post('/', async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, presupuesto } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const [result] = await pool.query(
      'INSERT INTO obras (nombre, descripcion, ubicacion, presupuesto, creador_id) VALUES (?, ?, ?, ?, ?)',
      [nombre, descripcion || null, ubicacion || null, presupuesto || 0, req.usuario.id]
    );

    // Agregar creador como admin de la obra
    await pool.query(
      'INSERT INTO obra_usuarios (obra_id, usuario_id, rol) VALUES (?, ?, "admin")',
      [result.insertId, req.usuario.id]
    );

    const [obra] = await pool.query('SELECT * FROM obras WHERE id = ?', [result.insertId]);
    res.status(201).json(obra[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/obras/:id - Editar obra
router.put('/:id', async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, presupuesto, activa } = req.body;
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (acceso.length === 0) return res.status(403).json({ error: 'Sin acceso' });
    if (acceso[0].rol !== 'admin') return res.status(403).json({ error: 'Solo el admin puede editar la obra' });

    await pool.query(
      'UPDATE obras SET nombre=?, descripcion=?, ubicacion=?, presupuesto=?, activa=? WHERE id=?',
      [nombre, descripcion, ubicacion, presupuesto, activa ?? 1, req.params.id]
    );
    res.json({ mensaje: 'Obra actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/obras/:id/resumen - Resumen + colaboradores
router.get('/:id/resumen', async (req, res) => {
  try {
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (acceso.length === 0) return res.status(403).json({ error: 'Sin acceso' });

    const [obra] = await pool.query('SELECT * FROM obras WHERE id = ?', [req.params.id]);
    if (obra.length === 0) return res.status(404).json({ error: 'Obra no encontrada' });

    const [porCategoria] = await pool.query(`
      SELECT c.nombre, c.color, c.tipo, COALESCE(SUM(g.monto), 0) AS total
      FROM categorias c
      LEFT JOIN gasto_categorias gc ON gc.categoria_id = c.id
      LEFT JOIN gastos g ON g.id = gc.gasto_id AND g.obra_id = ?
      WHERE c.es_global = 1 OR c.obra_id = ?
      GROUP BY c.id
      HAVING total > 0
      ORDER BY c.tipo ASC, total DESC
    `, [req.params.id, req.params.id]);

    const [colaboradores] = await pool.query(`
      SELECT u.id, u.nombre, u.email, ou.rol
      FROM usuarios u
      JOIN obra_usuarios ou ON ou.usuario_id = u.id
      WHERE ou.obra_id = ?
    `, [req.params.id]);

    const [totales] = await pool.query(`
      SELECT 
        COUNT(DISTINCT g.id) AS cantidad_gastos,
        COALESCE(SUM(CASE WHEN COALESCE(c.tipo,'egreso') = 'egreso' THEN g.monto ELSE 0 END), 0) AS total_gastado,
        COALESCE(SUM(CASE WHEN c.tipo = 'ingreso' THEN g.monto ELSE 0 END), 0) AS total_ingresos,
        MIN(g.fecha) AS primera_fecha,
        MAX(g.fecha) AS ultima_fecha
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      WHERE g.obra_id = ?
    `, [req.params.id]);

    res.json({
      obra: obra[0],
      totales: totales[0],
      por_categoria: porCategoria,
      colaboradores,
      mi_rol: acceso[0].rol
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/obras/:id/colaboradores
router.get('/:id/colaboradores', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre, u.email, ou.rol
      FROM usuarios u JOIN obra_usuarios ou ON ou.usuario_id = u.id
      WHERE ou.obra_id = ?
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/obras/:id/colaboradores/:uid
router.delete('/:id/colaboradores/:uid', async (req, res) => {
  try {
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!acceso.length || acceso[0].rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
    await pool.query('DELETE FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?', [req.params.id, req.params.uid]);
    res.json({ mensaje: 'Colaborador eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
