const router = require('express').Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');

router.use(authMiddleware);

// Config multer para memoria (luego se sube a Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes o PDF'));
    }
  }
});

// Helper para verificar acceso a obra
async function verificarAcceso(obraId, usuarioId) {
  const [rows] = await pool.query(
    'SELECT rol FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?',
    [obraId, usuarioId]
  );
  return rows.length > 0 ? rows[0].rol : null;
}

// Helper para subir imagen a Cloudinary
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

// GET /api/gastos?obra_id=&fecha_desde=&fecha_hasta=&categoria_id=&page=&limit=
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
    if (categoria_id) { where += ' AND g.categoria_id = ?'; params.push(categoria_id); }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [gastos] = await pool.query(`
      SELECT g.*,
        u.nombre AS usuario_nombre,
        GROUP_CONCAT(c.nombre ORDER BY c.nombre SEPARATOR ', ') AS categoria_nombre,
        GROUP_CONCAT(CONCAT(c.id,':',c.nombre,':',c.color) ORDER BY c.nombre SEPARATOR '|') AS categorias_raw
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE ${where}
      GROUP BY g.id
      ORDER BY g.fecha DESC, g.creado_en DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    // Parsear categorías como array en cada gasto
    gastos.forEach(g => {
      g.categorias = g.categorias_raw
        ? g.categorias_raw.split('|').map(s => {
            const [id, nombre, color] = s.split(':');
            return { id: parseInt(id), nombre, color };
          })
        : [];
      delete g.categorias_raw;
    });

    const [total] = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(monto), 0) as suma FROM gastos g WHERE ${where}`,
      params
    );

    res.json({
      gastos,
      total: total[0].total,
      suma: total[0].suma,
      pagina: parseInt(page),
      paginas: Math.ceil(total[0].total / parseInt(limit))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/gastos - Crear gasto (con o sin foto)
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { descripcion, monto, fecha, categoria_id, obra_id, proveedor, notas, cantidad, unidad, valor_unitario } = req.body;

    if (!descripcion || !monto || !fecha || !obra_id) {
      return res.status(400).json({ error: 'descripcion, monto, fecha y obra_id son requeridos' });
    }

    const rol = await verificarAcceso(obra_id, req.usuario.id);
    if (!rol) return res.status(403).json({ error: 'Sin acceso a esta obra' });

    let foto_url = null;
    if (req.file) {
      try {
        foto_url = await subirImagen(req.file.buffer, req.file.mimetype);
      } catch (e) {
        console.error('Error subiendo imagen:', e);
      }
    }

    await pool.query(
      `UPDATE gastos SET descripcion=?, monto=?, fecha=?, proveedor=?, notas=?, foto_url=?, cantidad=?, unidad=?, valor_unitario=? WHERE id=?`,
      [descripcion, parseFloat(monto), fecha, proveedor || null, notas || null, foto_url, cantidad || null, unidad || null, valor_unitario ? parseFloat(valor_unitario) : null, req.params.id]
    );

    // Actualizar categorías
    const cats = req.body.categorias ? JSON.parse(req.body.categorias) : [];
    await pool.query('DELETE FROM gasto_categorias WHERE gasto_id = ?', [req.params.id]);
    if (cats.length) {
      const vals = cats.map(cid => [req.params.id, cid]);
      await pool.query('INSERT IGNORE INTO gasto_categorias (gasto_id, categoria_id) VALUES ?', [vals]);
      await pool.query('UPDATE gastos SET categoria_id = ? WHERE id = ?', [cats[0], req.params.id]);
    } else {
      await pool.query('UPDATE gastos SET categoria_id = NULL WHERE id = ?', [req.params.id]);
    }

    const [gasto] = await pool.query(`
      SELECT g.*, u.nombre AS usuario_nombre,
        GROUP_CONCAT(CONCAT(c.id,':',c.nombre,':',c.color) ORDER BY c.nombre SEPARATOR '|') AS categorias_raw
      FROM gastos g
      LEFT JOIN gasto_categorias gc ON gc.gasto_id = g.id
      LEFT JOIN categorias c ON c.id = gc.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.id = ? GROUP BY g.id
    `, [req.params.id]);

    gasto[0].categorias = gasto[0].categorias_raw
      ? gasto[0].categorias_raw.split('|').map(s => { const [id,nombre,color]=s.split(':'); return {id:parseInt(id),nombre,color}; })
      : [];
    delete gasto[0].categorias_raw;

    res.json(gasto[0]);
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

    // Solo el creador o admin puede editar
    if (gastoActual[0].usuario_id !== req.usuario.id && rol !== 'admin') {
      return res.status(403).json({ error: 'Solo puedes editar tus propios gastos' });
    }

    const { descripcion, monto, fecha, categoria_id, proveedor, notas, cantidad, unidad, valor_unitario } = req.body;

    let foto_url = gastoActual[0].foto_url;
    if (req.file) {
      try {
        foto_url = await subirImagen(req.file.buffer, req.file.mimetype);
      } catch (e) {
        console.error('Error subiendo imagen:', e);
      }
    }

    await pool.query(
          `UPDATE gastos SET descripcion=?, monto=?, fecha=?, categoria_id=?, proveedor=?, notas=?, foto_url=?, cantidad=?, unidad=?, valor_unitario=? WHERE id=?`,
          [descripcion, parseFloat(monto), fecha, categoria_id || null, proveedor || null, notas || null, foto_url, cantidad || null, unidad || null, valor_unitario ? parseFloat(valor_unitario) : null, req.params.id]
        );

    const [gasto] = await pool.query(`
      SELECT g.*, c.nombre AS categoria_nombre, c.color AS categoria_color, u.nombre AS usuario_nombre
      FROM gastos g
      LEFT JOIN categorias c ON c.id = g.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.id = ?
    `, [req.params.id]);

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

    await pool.query('DELETE FROM gastos WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Gasto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/gastos/exportar?obra_id=&fecha_desde=&fecha_hasta= - Exportar CSV
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
      SELECT g.fecha, g.descripcion, c.nombre AS categoria, g.proveedor,
             g.monto, u.nombre AS registrado_por, g.notas
      FROM gastos g
      LEFT JOIN categorias c ON c.id = g.categoria_id
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE ${where}
      ORDER BY g.fecha DESC
    `, params);

    const [obra] = await pool.query('SELECT nombre FROM obras WHERE id = ?', [obra_id]);

    // Generar CSV
    const headers = ['Fecha', 'Descripción', 'Categoría', 'Proveedor', 'Monto', 'Registrado por', 'Notas'];
    const rows = gastos.map(g => [
      g.fecha ? new Date(g.fecha).toLocaleDateString('es-CO') : '',
      `"${(g.descripcion || '').replace(/"/g, '""')}"`,
      g.categoria || '',
      `"${(g.proveedor || '').replace(/"/g, '""')}"`,
      g.monto,
      g.registrado_por || '',
      `"${(g.notas || '').replace(/"/g, '""')}"`
    ]);

    const total = gastos.reduce((sum, g) => sum + parseFloat(g.monto), 0);
    rows.push(['', 'TOTAL', '', '', total.toFixed(2), '', '']);

    const csv = [
      `# Gastos: ${obra[0]?.nombre || 'Obra'}`,
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gastos-obra-${obra_id}.csv"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/gastos/categorias?obra_id=
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

// POST /api/gastos/categorias - Crear categoría personalizada
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

module.exports = router;
