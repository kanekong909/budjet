const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Verifica que el usuario tenga acceso a la obra
async function obraAccess(req, res, next) {
  const { pool } = require('../config/db');
  const obraId = req.params.obraId || req.body.obra_id;
  if (!obraId) return next();

  const [rows] = await pool.query(
    `SELECT * FROM obra_usuarios WHERE obra_id = ? AND usuario_id = ?`,
    [obraId, req.usuario.id]
  );
  if (rows.length === 0) {
    return res.status(403).json({ error: 'Sin acceso a esta obra' });
  }
  req.obraRol = rows[0].rol;
  next();
}

module.exports = { authMiddleware, obraAccess };
