const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const { registrarAuditoria } = require('../middleware/auditoria');

router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes o PDF'));
    }
  }
});

async function verificarAcceso(obraId, usuarioId) {
  const [rows] = await pool.query(
    'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
    [obraId, usuarioId]
  );
  return rows.length > 0 ? rows[0].rol : null;
}

async function subirImagen(buffer, mimetype) {
  if (!process.env.CLOUDINARY_API_KEY) return null;
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'obra-gastos', resource_type: 'auto' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Helper para parsear categorías del JOIN
function parsearCategorias(raw) {
  if (!raw) return [];
  return raw.split('|').map(s => {
    const parts = s.split(':');
    return { id: parseInt(parts[0]), nombre: parts[1], color: parts[2], tipo: parts[3] || 'egreso' };
  });
}

// GET /api/gastos
router.get('/', async (req, res) => {
  try {
    const { obra_id, fecha_desde, fecha_hasta, categoria_id, page = 1, limit = 50 } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso a esta obra' });

    let where = 'g.obra_id = ?';
    let params = [obra_id];

    if (fecha_desde) { where += ' AND g.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND g.fecha <= ?'; params.push(fecha_hasta); }
    if (categoria_id) { where += ' AND gc2.categoria_id = ?'; params.push(categoria_id); }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [gastos] = await pool.query(`
      SELECT g.*,
        u.nombre AS usuario_nombre,
        GROUP_CONCAT(DISTINCT CONCAT(c.id,':',c.nombre,':',c.color,':',COALESCE(c.tipo,'egreso')) ORDER BY c.nombre SEPARATOR '|') AS categorias_raw
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      ${categoria_id ? 'LEFT JOIN gasto_categorias gc2 ON gc2.gasto_id = g.id' : ''}
      WHERE ${where}
      GROUP BY g.id
      ORDER BY g.fecha DESC, g.creado_en DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    gastos.forEach(g => {
      g.categorias = parsearCategorias(g.categorias_raw);
      g.categoria_nombre = g.categorias.map(c => c.nombre).join(', ');
      delete g.categorias_raw;
    });

    const [total] = await pool.query(
      `SELECT 
        COUNT(DISTINCT g.id) as total,
        COALESCE(SUM(CASE WHEN COALESCE(cat_tipo.tipo,'egreso') = 'egreso' THEN g.monto ELSE 0 END), 0) as suma,
        COALESCE(SUM(CASE WHEN cat_tipo.tipo = 'ingreso' THEN g.monto ELSE 0 END), 0) as suma_ingresos
       FROM gastos g
       LEFT JOIN gasto_categorias gc_t ON gc_t.gasto_id = g.id
       LEFT JOIN categorias cat_tipo ON cat_tipo.id = gc_t.categoria_id AND cat_tipo.tipo = 'ingreso'
       ${categoria_id ? 'LEFT JOIN gasto_categorias gc2 ON gc2.gasto_id = g.id' : ''}
       WHERE ${where}`,
      params
    );

    res.json({
      gastos,
      total: total[0].total,
      suma: total[0].suma,
      suma_ingresos: total[0].suma_ingresos,
      pagina: parseInt(page),
      paginas: Math.ceil(total[0].total / parseInt(limit))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/gastos
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { descripcion, monto, fecha, obra_id, proveedor, notas, cantidad, unidad, valor_unitario } = req.body;

    if (!descripcion || !monto || !fecha || !obra_id) {
      return res.status(400).json({ error: 'descripcion, monto, fecha y obra_id son requeridos' });
    }

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso a esta obra' });

    let foto_url = null;
    if (req.file) {
      try { foto_url = await subirImagen(req.file.buffer, req.file.mimetype); }
      catch (e) { console.error('Error subiendo imagen:', e); }
    }

    const cats = req.body.categorias ? JSON.parse(req.body.categorias) : [];
    const primeraCat = cats.length ? cats[0] : null;

    const [result] = await pool.query(
      `INSERT INTO gastos (descripcion, monto, fecha, categoria_id, obra_id, usuario_id, proveedor, notas, foto_url, cantidad, unidad, valor_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [descripcion, parseFloat(monto), fecha, primeraCat, obra_id, req.usuario.id,
       proveedor || null, notas || null, foto_url,
       cantidad || null, unidad || null, valor_unitario ? parseFloat(valor_unitario) : null]
    );

    if (cats.length) {
      const vals = cats.map(cid => [result.insertId, cid]);
      await pool.query('INSERT IGNORE INTO gasto_categorias (gasto_id, categoria_id) VALUES ?', [vals]);
    }

    const [gasto] = await pool.query(`
      SELECT g.*, u.nombre AS usuario_nombre,
        GROUP_CONCAT(DISTINCT CONCAT(c.id,':',c.nombre,':',c.color,':',COALESCE(c.tipo,'egreso')) ORDER BY c.nombre SEPARATOR '|') AS categorias_raw
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.id = ? GROUP BY g.id
    `, [result.insertId]);

    gasto[0].categorias = parsearCategorias(gasto[0].categorias_raw);
    delete gasto[0].categorias_raw;

    await registrarAuditoria({ req, accion: 'CREAR', entidad: 'gasto',
      entidad_id: result.insertId, obra_id: parseInt(obra_id),
      datos_despues: gasto[0] });

    res.status(201).json(gasto[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/gastos/:id
router.put('/:id', upload.single('foto'), async (req, res) => {
  try {
    const [gastoActual] = await pool.query('SELECT * FROM gastos WHERE id = ?', [req.params.id]);
    if (!gastoActual.length) return res.status(404).json({ error: 'Gasto no encontrado' });

    const rol = await verificarAcceso(gastoActual[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    if (gastoActual[0].usuario_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo puedes editar tus propios gastos' });
    }

    const { descripcion, monto, fecha, proveedor, notas, cantidad, unidad, valor_unitario } = req.body;

    let foto_url = gastoActual[0].foto_url;
    if (req.file) {
      try { foto_url = await subirImagen(req.file.buffer, req.file.mimetype); }
      catch (e) { console.error('Error subiendo imagen:', e); }
    } else if (req.body.borrar_foto === '1') {
      foto_url = null;
    }

    const cats = req.body.categorias ? JSON.parse(req.body.categorias) : [];
    const primeraCat = cats.length ? cats[0] : null;

    await pool.query(
      `UPDATE gastos SET descripcion=?, monto=?, fecha=?, categoria_id=?, proveedor=?, notas=?, foto_url=?, cantidad=?, unidad=?, valor_unitario=? WHERE id=?`,
      [descripcion, parseFloat(monto), fecha, primeraCat, proveedor || null, notas || null,
       foto_url, cantidad || null, unidad || null,
       valor_unitario ? parseFloat(valor_unitario) : null, req.params.id]
    );

    // Reemplazar categorías
    await pool.query('DELETE FROM gasto_categorias WHERE gasto_id = ?', [req.params.id]);
    if (cats.length) {
      const vals = cats.map(cid => [req.params.id, parseInt(cid)]);
      await pool.query('INSERT IGNORE INTO gasto_categorias (gasto_id, categoria_id) VALUES ?', [vals]);
    }

    const [gasto] = await pool.query(`
      SELECT g.*, u.nombre AS usuario_nombre,
        GROUP_CONCAT(DISTINCT CONCAT(c.id,':',c.nombre,':',c.color,':',COALESCE(c.tipo,'egreso')) ORDER BY c.nombre SEPARATOR '|') AS categorias_raw
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.id = ? GROUP BY g.id
    `, [req.params.id]);

    gasto[0].categorias = parsearCategorias(gasto[0].categorias_raw);
    delete gasto[0].categorias_raw;

    await registrarAuditoria({ req, accion: 'EDITAR', entidad: 'gasto',
      entidad_id: parseInt(req.params.id), obra_id: gastoActual[0].obra_id,
      datos_antes: gastoActual[0], datos_despues: gasto[0] });

    res.json(gasto[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/gastos/:id
router.delete('/:id', async (req, res) => {
  try {
    const [gastoActual] = await pool.query('SELECT * FROM gastos WHERE id = ?', [req.params.id]);
    if (!gastoActual.length) return res.status(404).json({ error: 'Gasto no encontrado' });

    const rol = await verificarAcceso(gastoActual[0].obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    if (gastoActual[0].usuario_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios gastos' });
    }

    await registrarAuditoria({ req, accion: 'ELIMINAR', entidad: 'gasto',
      entidad_id: parseInt(req.params.id), obra_id: gastoActual[0].obra_id,
      datos_antes: gastoActual[0] });

    await pool.query('DELETE FROM gastos WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Gasto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/gastos/exportar
router.get('/exportar', async (req, res) => {
  try {
    const { obra_id, fecha_desde, fecha_hasta } = req.query;
    if (!obra_id) return res.status(400).json({ error: 'obra_id requerido' });

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    let where = 'g.obra_id = ?';
    let params = [obra_id];
    if (fecha_desde) { where += ' AND g.fecha >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND g.fecha <= ?'; params.push(fecha_hasta); }

    const [gastos] = await pool.query(`
      SELECT g.fecha, g.descripcion,
        GROUP_CONCAT(DISTINCT CONCAT(c.nombre, CASE WHEN c.tipo='ingreso' THEN ' (+)' ELSE '' END) ORDER BY c.nombre SEPARATOR ', ') AS categoria,
        g.proveedor, g.cantidad, g.unidad, g.valor_unitario, g.monto,
        u.nombre AS registrado_por, g.notas
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE ${where}
      GROUP BY g.id
      ORDER BY g.fecha DESC
    `, params);

    const [obra] = await pool.query('SELECT nombre FROM obras WHERE id = ?', [obra_id]);

    const headers = ['Fecha','Descripción','Categoría','Proveedor','Cantidad','Unidad','Valor unitario','Monto','Registrado por','Notas'];
    const rows = gastos.map(g => [
      g.fecha ? new Date(g.fecha).toLocaleDateString('es-CO') : '',
      `"${(g.descripcion || '').replace(/"/g, '""')}"`,
      g.categoria || '',
      `"${(g.proveedor || '').replace(/"/g, '""')}"`,
      g.cantidad || '',
      g.unidad || '',
      g.valor_unitario || '',
      g.monto,
      g.registrado_por || '',
      `"${(g.notas || '').replace(/"/g, '""')}"`
    ]);

    const total = gastos.reduce((sum, g) => sum + parseFloat(g.monto), 0);
    rows.push(['','TOTAL','','','','','',total.toFixed(2),'','']);

    const csv = [
      `# Gastos: ${obra[0]?.nombre || 'Obra'}`,
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gastos-obra-${obra_id}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/gastos/categorias
router.get('/categorias', async (req, res) => {
  try {
    const { obra_id } = req.query;
    const [cats] = await pool.query(
      'SELECT * FROM categorias WHERE es_global = 1 OR obra_id = ? ORDER BY nombre',
      [obra_id || null]
    );
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/gastos/categorias
router.post('/categorias', async (req, res) => {
  try {
    const { nombre, color, obra_id } = req.body;
    const [result] = await pool.query(
      'INSERT INTO categorias (nombre, color, obra_id) VALUES (?, ?, ?)',
      [nombre, color || '#6366f1', obra_id || null]
    );
    res.status(201).json({ id: result.insertId, nombre, color, obra_id });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/gastos/bulk — edición masiva
router.put('/bulk', async (req, res) => {
  try {
    const { ids, campo, valor, obra_id } = req.body;
    if (!ids?.length || !campo || !obra_id) {
      return res.status(400).json({ error: 'ids, campo y obra_id requeridos' });
    }

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso' });

    // Solo campos permitidos para edición masiva
    const camposPermitidos = ['proveedor', 'categoria_id', 'fecha', 'notas'];
    if (!camposPermitidos.includes(campo)) {
      return res.status(400).json({ error: 'Campo no permitido' });
    }

    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE gastos SET ${campo} = ? WHERE id IN (${placeholders}) AND obra_id = ?`,
      [valor || null, ...ids, obra_id]
    );

    // Si cambió categoria_id, actualizar gasto_categorias también
    if (campo === 'categoria_id' && valor) {
      for (const id of ids) {
        await pool.query('DELETE FROM gasto_categorias WHERE gasto_id = ?', [id]);
        await pool.query('INSERT IGNORE INTO gasto_categorias (gasto_id, categoria_id) VALUES (?, ?)', [id, valor]);
      }
    }

    res.json({ mensaje: `${ids.length} gastos actualizados` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;