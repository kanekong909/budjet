const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.MYSQLHOST     || process.env.DB_HOST,
  port:     process.env.MYSQLPORT     || process.env.DB_PORT     || 3306,
  database: process.env.MYSQL_DATABASE|| process.env.DB_NAME,
  user:     process.env.MYSQLUSER     || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        rol ENUM('admin','colaborador') DEFAULT 'colaborador',
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS obras (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        descripcion TEXT,
        ubicacion VARCHAR(255),
        presupuesto DECIMAL(15,2) DEFAULT 0,
        activa TINYINT(1) DEFAULT 1,
        creador_id INT NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creador_id) REFERENCES usuarios(id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS obra_usuarios (
        obra_id INT NOT NULL,
        usuario_id INT NOT NULL,
        rol ENUM('admin','colaborador') DEFAULT 'colaborador',
        PRIMARY KEY (obra_id, usuario_id),
        FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        color VARCHAR(7) DEFAULT '#6366f1',
        obra_id INT,
        es_global TINYINT(1) DEFAULT 0,
        FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      INSERT IGNORE INTO categorias (id, nombre, color, es_global) VALUES
      (1, 'Materiales', '#f59e0b', 1),
      (2, 'Mano de obra', '#3b82f6', 1),
      (3, 'Herramientas', '#10b981', 1),
      (4, 'Transporte', '#8b5cf6', 1),
      (5, 'Administrativo', '#ef4444', 1),
      (6, 'Otros', '#6b7280', 1)
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS gastos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        fecha DATE NOT NULL,
        categoria_id INT,
        obra_id INT NOT NULL,
        usuario_id INT NOT NULL,
        proveedor VARCHAR(150),
        notas TEXT,
        foto_url VARCHAR(500),
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
        FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE CASCADE,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      )
    `);
    console.log('✅ Base de datos inicializada correctamente');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };