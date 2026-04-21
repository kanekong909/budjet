const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Middleware: solo superadmin
function soloSuperadmin(req, res, next) {
  if (req.usuario?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

router.use(authMiddleware, soloSuperadmin);

// GET /api/admin/auditoria
router.get('/auditoria', async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      accion, entidad, obra_id,
      usuario_id, fecha_desde, fecha_hasta,
      buscar
    } = req.query;

    let where = '1=1';
    let params = [];

    if (accion)      { where += ' AND a.accion = ?';              params.push(accion); }
    if (entidad)     { where += ' AND a.entidad = ?';             params.push(entidad); }
    if (obra_id)     { where += ' AND a.obra_id = ?';             params.push(obra_id); }
    if (usuario_id)  { where += ' AND a.usuario_id = ?';          params.push(usuario_id); }
    if (fecha_desde) { where += ' AND DATE(a.creado_en) >= ?';    params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND DATE(a.creado_en) <= ?';    params.push(fecha_hasta); }
    if (buscar)      { where += ' AND (a.usuario_nombre LIKE ? OR a.obra_nombre LIKE ? OR a.entidad LIKE ?)';
                       params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`); }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows] = await pool.query(`
      SELECT a.*
      FROM auditoria a
      WHERE ${where}
      ORDER BY a.creado_en DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const [total] = await pool.query(
      `SELECT COUNT(*) as total FROM auditoria a WHERE ${where}`, params
    );

    res.json({
      eventos: rows,
      total: total[0].total,
      paginas: Math.ceil(total[0].total / parseInt(limit)),
      pagina: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/stats — estadísticas generales
router.get('/stats', async (req, res) => {
  try {
    const [usuarios]  = await pool.query('SELECT COUNT(*) as total FROM usuarios');
    const [obras]     = await pool.query('SELECT COUNT(*) as total FROM obras');
    const [gastos]    = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(monto),0) as suma FROM gastos');
    const [tareas]    = await pool.query('SELECT COUNT(*) as total FROM tareas');
    const [eventos]   = await pool.query('SELECT COUNT(*) as total FROM auditoria');
    const [hoy]       = await pool.query(
      'SELECT COUNT(*) as total FROM auditoria WHERE DATE(creado_en) = CURDATE()'
    );
    const [topUsuarios] = await pool.query(`
      SELECT usuario_nombre, COUNT(*) as acciones
      FROM auditoria
      WHERE creado_en >= NOW() - INTERVAL 7 DAY
      GROUP BY usuario_nombre
      ORDER BY acciones DESC LIMIT 5
    `);
    const [topAcciones] = await pool.query(`
      SELECT accion, COUNT(*) as total
      FROM auditoria
      GROUP BY accion ORDER BY total DESC
    `);

    res.json({
      usuarios: usuarios[0].total,
      obras: obras[0].total,
      gastos: gastos[0].total,
      total_dinero: gastos[0].suma,
      tareas: tareas[0].total,
      eventos_auditoria: eventos[0].total,
      eventos_hoy: hoy[0].total,
      top_usuarios: topUsuarios,
      top_acciones: topAcciones
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.*,
        COUNT(DISTINCT ou.obra_id) AS total_obras,
        COUNT(DISTINCT g.id) AS total_gastos,
        MAX(a.creado_en) AS ultima_actividad
      FROM usuarios u
      LEFT JOIN obra_usuarios ou ON ou.usuario_id = u.id
      LEFT JOIN gastos g ON g.usuario_id = u.id
      LEFT JOIN auditoria a ON a.usuario_id = u.id
      GROUP BY u.id
      ORDER BY u.creado_en DESC
    `);
    // No devolver password_hash
    rows.forEach(r => delete r.password_hash);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/revertir/:id — revertir una acción
router.post('/revertir/:id', async (req, res) => {
  try {
    const [evento] = await pool.query('SELECT * FROM auditoria WHERE id = ?', [req.params.id]);
    if (!evento.length) return res.status(404).json({ error: 'Evento no encontrado' });

    const e = evento[0];
    if (e.revertido) return res.status(400).json({ error: 'Este evento ya fue revertido' });

    const datosBefore = e.datos_antes ? JSON.parse(e.datos_antes) : null;

    if (e.accion === 'ELIMINAR' && datosBefore) {
      // Restaurar el registro eliminado
      if (e.entidad === 'gasto') {
        await pool.query(`
          INSERT INTO gastos (id, descripcion, monto, fecha, categoria_id, obra_id, usuario_id, proveedor, notas, cantidad, unidad, valor_unitario)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          datosBefore.id, datosBefore.descripcion, datosBefore.monto,
          datosBefore.fecha, datosBefore.categoria_id, datosBefore.obra_id,
          datosBefore.usuario_id, datosBefore.proveedor, datosBefore.notas,
          datosBefore.cantidad, datosBefore.unidad, datosBefore.valor_unitario
        ]);
      } else if (e.entidad === 'tarea') {
        await pool.query(`
          INSERT INTO tareas (id, obra_id, creador_id, titulo, descripcion, estado, fecha_limite)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          datosBefore.id, datosBefore.obra_id, datosBefore.creador_id,
          datosBefore.titulo, datosBefore.descripcion,
          datosBefore.estado || 'pendiente', datosBefore.fecha_limite
        ]);
      }
    } else if (e.accion === 'EDITAR' && datosBefore) {
      // Restaurar valores anteriores
      if (e.entidad === 'gasto') {
        await pool.query(`
          UPDATE gastos SET descripcion=?, monto=?, fecha=?, categoria_id=?, proveedor=?, notas=?,
          cantidad=?, unidad=?, valor_unitario=? WHERE id=?
        `, [
          datosBefore.descripcion, datosBefore.monto, datosBefore.fecha,
          datosBefore.categoria_id, datosBefore.proveedor, datosBefore.notas,
          datosBefore.cantidad, datosBefore.unidad, datosBefore.valor_unitario,
          e.entidad_id
        ]);
      } else if (e.entidad === 'tarea') {
        await pool.query(
          'UPDATE tareas SET titulo=?, descripcion=?, fecha_limite=? WHERE id=?',
          [datosBefore.titulo, datosBefore.descripcion, datosBefore.fecha_limite, e.entidad_id]
        );
      }
    } else {
      return res.status(400).json({ error: `No se puede revertir acción: ${e.accion}` });
    }

    // Marcar como revertido
    await pool.query(
      'UPDATE auditoria SET revertido=1, revertido_en=NOW(), revertido_por=? WHERE id=?',
      [req.usuario.nombre, req.params.id]
    );

    // Registrar la reversión
    const { registrarAuditoria } = require('../middleware/auditoria');
    await registrarAuditoria({
      req,
      accion: 'REVERTIR',
      entidad: e.entidad,
      entidad_id: e.entidad_id,
      obra_id: e.obra_id,
      obra_nombre: e.obra_nombre,
      datos_antes: e.datos_despues,
      datos_despues: e.datos_antes
    });

    res.json({ mensaje: `Acción revertida correctamente` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
  }
});

// GET /api/admin/exportar — exportar auditoría CSV
router.get('/exportar', async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, accion, entidad } = req.query;
    let where = '1=1';
    let params = [];
    if (fecha_desde) { where += ' AND DATE(creado_en) >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND DATE(creado_en) <= ?'; params.push(fecha_hasta); }
    if (accion)      { where += ' AND accion = ?'; params.push(accion); }
    if (entidad)     { where += ' AND entidad = ?'; params.push(entidad); }

    const [rows] = await pool.query(
      `SELECT id, creado_en, usuario_nombre, accion, entidad, entidad_id,
              obra_nombre, ip, revertido, revertido_por, revertido_en
       FROM auditoria WHERE ${where} ORDER BY creado_en DESC`,
      params
    );

    const headers = ['ID','Fecha','Usuario','Acción','Entidad','ID Entidad','Obra','IP','Revertido','Revertido por','Fecha reversión'];
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        r.id,
        new Date(r.creado_en).toLocaleString('es-CO'),
        `"${r.usuario_nombre || ''}"`,
        r.accion,
        r.entidad,
        r.entidad_id || '',
        `"${r.obra_nombre || ''}"`,
        r.ip || '',
        r.revertido ? 'Sí' : 'No',
        `"${r.revertido_por || ''}"`,
        r.revertido_en ? new Date(r.revertido_en).toLocaleString('es-CO') : ''
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;