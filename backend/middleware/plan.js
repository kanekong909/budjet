const { pool } = require('../config/db');

// Verificar si el usuario puede hacer una acción según su plan
async function verificarLimite(usuarioId, tipo) {
  const [rows] = await pool.query(`
    SELECT p.*, s.estado, s.fecha_vencimiento
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE s.usuario_id = ?
  `, [usuarioId]);

  // Sin suscripción = plan gratis
  if (!rows.length) return { permitido: tipo === 'crear_obra', plan: 'gratis', limite: 1 };

  const s = rows[0];
  const vencida = new Date(s.fecha_vencimiento) < new Date();
  const plan = vencida ? 'gratis' : s.nombre;

  if (tipo === 'crear_obra') {
    const [obras] = await pool.query(
      'SELECT COUNT(*) as total FROM obra_usuarios WHERE usuario_id = ? AND rol = "admin"',
      [usuarioId]
    );
    const limite = vencida ? 1 : s.max_obras;
    return { permitido: obras[0].total < limite, plan, limite, actual: obras[0].total };
  }

  if (tipo === 'agregar_colaborador') {
    return { permitido: !vencida || s.max_colaboradores > 3, plan, limite: s.max_colaboradores };
  }

  if (tipo === 'subir_foto') {
    return { permitido: !vencida && s.max_fotos > 0, plan, limite: s.max_fotos };
  }

  if (tipo === 'pdf') {
    return { permitido: !vencida && s.permite_pdf, plan };
  }

  if (tipo === 'auditoria') {
    return { permitido: !vencida && s.permite_auditoria, plan };
  }

  return { permitido: true, plan };
}

module.exports = { verificarLimite };