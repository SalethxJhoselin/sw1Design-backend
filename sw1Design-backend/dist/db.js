// db.js
import { Pool } from 'pg';
const pool = new Pool({
    user: 'postgres.jzissgbnbmqyrmyehhsx',
    host: 'aws-0-us-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'develop2025',
    port: 6543,
});
export async function initializeDatabase() {
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
            
            CREATE INDEX IF NOT EXISTS idx_projects_elements ON projects USING GIN (elements jsonb_path_ops);
            CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at);
        `);
        console.log('✅ Tabla e índices creados/verificados');
        await client.query(`
            CREATE TABLE IF NOT EXISTS changes (
                id SERIAL PRIMARY KEY,
                project_id VARCHAR(12) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                elements JSONB NOT NULL,
                metadata JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT fk_project FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_changes_project ON changes(project_id);
        `);
        console.log('✅ Tabla de changes creado');
    }
    catch (err) {
        console.error('Error crítico al inicializar DB:', err);
        throw err; // Propaga el error
    }
    finally {
        client.release();
    }
}
pool.on('error', (err) => {
    console.error('Error en el pool de PostgreSQL:', err);
});
export default pool;
