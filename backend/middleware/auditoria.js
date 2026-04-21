const { pool } = require('../config/db');

// Registrar evento de auditoría
async function registrarAuditoria({
  req,
  accion,        // 'CREAR' | 'EDITAR' | 'ELIMINAR' | 'LOGIN' | 'REVERTIR'
  entidad,       // 'gasto' | 'tarea' | 'obra' | 'usuario' | 'progreso'
  entidad_id,
  obra_id,
  obra_nombre,
  datos_antes,
  datos_despues
}) {
  try {
    const usuario_id   = req?.usuario?.id || null;
    const usuario_nombre = req?.usuario?.nombre || 'Sistema';
    const ip = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null;

    await pool.query(`
      INSERT INTO auditoria 
        (usuario_id, usuario_nombre, accion, entidad, entidad_id, obra_id, obra_nombre, datos_antes, datos_despues, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      usuario_id,
      usuario_nombre,
      accion,
      entidad,
      entidad_id || null,
      obra_id || null,
      obra_nombre || null,
      datos_antes ? JSON.stringify(datos_antes) : null,
      datos_despues ? JSON.stringify(datos_despues) : null,
      ip
    ]);
  } catch (err) {
    console.error('Error registrando auditoría:', err.message);
  }
}

module.exports = { registrarAuditoria };