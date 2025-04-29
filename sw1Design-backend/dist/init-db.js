import pool from './db.js';
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(12) PRIMARY KEY,
        secret_key VARCHAR(64) NOT NULL,
        elements JSONB NOT NULL,
        metadata JSONB DEFAULT '{"name":"Nuevo proyecto", "version":1}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX idx_projects_elements ON projects USING GIN (elements jsonb_path_ops);
      CREATE INDEX idx_projects_updated ON projects (updated_at);
    `);
        console.log('✅ Tabla e índices creados/existen');
    }
    catch (err) {
        console.error('Error crítico al inicializar DB:', err);
        process.exit(1); // Falla grave, detener aplicación
    }
    finally {
        client.release();
    }
}
// No cerrar el pool aquí para reutilizarlo
initializeDatabase();
