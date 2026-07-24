const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria } = require('../middleware/auditoria');

router.use(authMiddleware);

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

// GET /api/obras - Listar obras del usuario
router.get('/', async (req, res) => {
  try {
    const [obras] = await pool.query(`
      SELECT o.*, 
        u.nombre AS creador_nombre,
        ou.rol AS mi_rol,
        (SELECT COUNT(DISTINCT g.id) FROM gastos g
        LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
        LEFT JOIN categorias c ON c.id = gc.categoria_id
        WHERE g.obra_id = o.id AND COALESCE(c.tipo,'egreso') = 'egreso'
        ) AS total_gastos_count,
        (SELECT COUNT(*) FROM tareas t WHERE t.obra_id = o.id AND t.estado != 'hecho') AS tareas_pendientes,
        (SELECT COALESCE(SUM(g.monto), 0) FROM gastos g 
         LEFT JOIN gasto_categorias gc_t ON gc_t.gasto_id = g.id
         LEFT JOIN categorias cat_t ON cat_t.id = gc_t.categoria_id AND cat_t.tipo = 'ingreso'
         WHERE g.obra_id = o.id AND COALESCE(cat_t.tipo, 'egreso') = 'egreso') AS total_gastado
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
    const { nombre, descripcion, ubicacion, presupuesto, moneda } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const limites = await obtenerLimitesPlan(req.usuario.id);
    const [misObras] = await pool.query(
      "SELECT COUNT(*) as total FROM obra_usuarios WHERE usuario_id = ? AND rol = 'admin'",
      [req.usuario.id]
    );
    if (misObras[0].total >= limites.max_obras) {
      return res.status(403).json({
        error: `Tu plan permite hasta ${limites.max_obras} obra(s). Actualiza tu plan para crear más.`,
        codigo: 'LIMITE_PLAN'
      });
    }

    const [result] = await pool.query(
      'INSERT INTO obras (nombre, descripcion, ubicacion, presupuesto, moneda, creador_id) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, descripcion || null, ubicacion || null, presupuesto || 0, moneda || 'COP', req.usuario.id]
    );

    // Agregar creador como admin de la obra
    await pool.query(
      'INSERT INTO obra_usuarios (obra_id, usuario_id, rol) VALUES (?, ?, "admin")',
      [result.insertId, req.usuario.id] const limites = await obtenerLimitesPlan(req.usuario.id);
    );

    const [obra] = await pool.query('SELECT * FROM obras WHERE id = ?', [result.insertId]);

    await registrarAuditoria({
      req, accion: 'CREAR', entidad: 'obra', entidad_id: result.insertId,
      obra_id: result.insertId, obra_nombre: nombre
    });

    res.status(201).json(obra[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/obras/:id - Editar obra
router.put('/:id', async (req, res) => {
  try {
    const { nombre, descripcion, ubicacion, presupuesto, activa, moneda } = req.body;
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (acceso.length === 0) return res.status(403).json({ error: 'Sin acceso' });
    if (acceso[0].rol !== 'admin') return res.status(403).json({ error: 'Solo el admin puede editar la obra' });

    await pool.query(
      'UPDATE obras SET nombre=?, descripcion=?, ubicacion=?, presupuesto=?, activa=?, moneda=? WHERE id=?',
      [nombre, descripcion, ubicacion, presupuesto, activa ?? 1, moneda || 'COP', req.params.id]
    );

    await registrarAuditoria({
      req, accion: 'EDITAR', entidad: 'obra', entidad_id: req.params.id,
      obra_id: req.params.id, obra_nombre: nombre, datos_despues: { nombre, presupuesto }
    });

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

    const [obra] = await pool.query(`
      SELECT o.*, u.logo_empresa_url
      FROM obras o
      LEFT JOIN usuarios u ON u.id = o.creador_id
      WHERE o.id = ?
    `, [req.params.id]);
    
    if (obra.length === 0) return res.status(404).json({ error: 'Obra no encontrada' });

    // El resto del código queda igual...
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
        COUNT(DISTINCT CASE WHEN COALESCE(c.tipo,'egreso') = 'egreso' THEN g.id END) AS cantidad_gastos,
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

// DELETE /api/obras/:id
router.delete('/:id', async (req, res) => {
  try {
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!acceso.length) return res.status(403).json({ error: 'Sin acceso' });
    if (acceso[0].rol !== 'admin') return res.status(403).json({ error: 'Solo el admin puede eliminar la obra' });

    await pool.query('DELETE FROM obras WHERE id = ?', [req.params.id]);

    await registrarAuditoria({
      req, accion: 'ELIMINAR', entidad: 'obra', entidad_id: req.params.id,
      obra_id: req.params.id
    });

    res.json({ mensaje: 'Obra eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/obras/:id/semanal?lunes=YYYY-MM-DD
router.get('/:id/semanal', async (req, res) => {
  try {
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!acceso.length) return res.status(403).json({ error: 'Sin acceso' });

    // Recibir fechas calculadas en el cliente (evita problemas de zona horaria)
    const { lunes } = req.query;
    if (!lunes) return res.status(400).json({ error: 'lunes requerido' });

    const lunesActual   = lunes; // YYYY-MM-DD
    const lunesAnterior = new Date(new Date(lunesActual).getTime() - 7*24*60*60*1000)
                            .toISOString().split('T')[0];
    const domingoActual = new Date(new Date(lunesActual).getTime() + 6*24*60*60*1000)
                            .toISOString().split('T')[0];
    const domingoAnterior = new Date(new Date(lunesAnterior).getTime() + 6*24*60*60*1000)
                            .toISOString().split('T')[0];

    // Primer y último día del mes actual
    const hoy = new Date(lunesActual);
    const primerDiaMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
    const hoyStr = lunesActual; // aproximación, el cliente manda el lunes

    const [rows] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE
          WHEN g.fecha >= ? AND g.fecha <= ?
          AND COALESCE(c.tipo,'egreso') = 'egreso'
          THEN g.monto ELSE 0 END), 0) AS semana_actual,

        COALESCE(SUM(CASE
          WHEN g.fecha >= ? AND g.fecha <= ?
          AND COALESCE(c.tipo,'egreso') = 'egreso'
          THEN g.monto ELSE 0 END), 0) AS semana_anterior,

        COALESCE(SUM(CASE
          WHEN g.fecha >= ?
          AND COALESCE(c.tipo,'egreso') = 'egreso'
          THEN g.monto ELSE 0 END), 0) AS mes_actual,

        COALESCE(SUM(CASE
          WHEN MONTH(g.fecha) = MONTH(? - INTERVAL 1 MONTH)
          AND YEAR(g.fecha) = YEAR(? - INTERVAL 1 MONTH)
          AND COALESCE(c.tipo,'egreso') = 'egreso'
          THEN g.monto ELSE 0 END), 0) AS mes_anterior,

        GROUP_CONCAT(
          CASE WHEN g.fecha >= ? AND g.fecha <= ?
               AND COALESCE(c.tipo,'egreso') = 'egreso'
          THEN CONCAT(WEEKDAY(g.fecha),':',g.monto) END
          ORDER BY g.fecha SEPARATOR '|'
        ) AS dias_raw

      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      WHERE g.obra_id = ?
    `, [
      lunesActual, domingoActual,
      lunesAnterior, domingoAnterior,
      primerDiaMes,
      primerDiaMes, primerDiaMes,
      lunesActual, domingoActual,
      req.params.id
    ]);

    const diasSemana = [0,0,0,0,0,0,0];
    if (rows[0].dias_raw) {
      rows[0].dias_raw.split('|').filter(Boolean).forEach(entry => {
        const [dia, monto] = entry.split(':');
        if (dia !== undefined) diasSemana[parseInt(dia)] += parseFloat(monto) || 0;
      });
    }

    res.json({
      semana_actual:   rows[0].semana_actual,
      semana_anterior: rows[0].semana_anterior,
      mes_actual:      rows[0].mes_actual,
      mes_anterior:    rows[0].mes_anterior,
      dias_semana:     diasSemana
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/obras/:id/auditoria?usuario_id=&accion=&fecha_desde=&fecha_hasta=
router.get('/:id/auditoria', async (req, res) => {
  try {
    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!acceso.length) return res.status(403).json({ error: 'Sin acceso' });
    if (acceso[0].rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede ver la auditoría' });
    const limites = await obtenerLimitesPlan(req.usuario.id);
    if (!limites.permite_auditoria) {
      return res.status(403).json({
        error: 'La auditoría no está disponible en tu plan actual.',
        codigo: 'LIMITE_PLAN'
      });
    }

    const { usuario_id, accion, entidad, fecha_desde, fecha_hasta } = req.query;
    const condiciones = ['obra_id = ?'];
    const params = [req.params.id];

    if (usuario_id) { condiciones.push('usuario_id = ?'); params.push(usuario_id); }
    if (accion) { condiciones.push('accion = ?'); params.push(accion); }
    if (entidad) { condiciones.push('entidad = ?'); params.push(entidad); }
    if (fecha_desde) { condiciones.push('creado_en >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { condiciones.push('creado_en <= ?'); params.push(`${fecha_hasta} 23:59:59`); }

    const [eventos] = await pool.query(`
      SELECT * FROM auditoria
      WHERE ${condiciones.join(' AND ')}
      ORDER BY creado_en DESC
      LIMIT 500
    `, params);

    res.json(eventos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/obras/:id/colaboradores/:uid — cambiar el rol de alguien
// dentro de esta obra puntual (admin ↔ colaborador)
router.put('/:id/colaboradores/:uid', async (req, res) => {
  try {
    const { rol } = req.body;
    if (!['admin', 'colaborador'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const [acceso] = await pool.query(
      'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!acceso.length) return res.status(403).json({ error: 'Sin acceso' });
    if (acceso[0].rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador puede cambiar roles' });
    }

    // Evita que el único admin se autodegrade y la obra quede sin nadie
    // que pueda administrarla.
    if (Number(req.params.uid) === req.usuario.id && rol !== 'admin') {
      const [admins] = await pool.query(
        "SELECT COUNT(*) as total FROM obra_usuarios WHERE obra_id = ? AND rol = 'admin'",
        [req.params.id]
      );
      if (admins[0].total <= 1) {
        return res.status(400).json({ error: 'No puedes quitarte el rol de admin si eres el único administrador de la obra' });
      }
    }

    await pool.query(
      'UPDATE obra_usuarios SET rol = ? WHERE obra_id = ? AND usuario_id = ?',
      [rol, req.params.id, req.params.uid]
    );
    res.json({ mensaje: 'Rol actualizado', rol });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
