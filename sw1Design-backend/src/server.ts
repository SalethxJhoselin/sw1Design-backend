import express from 'express';
import { createServer } from 'http';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import pool, { initializeDatabase } from './db.js';

async function startServer() {
    // Al inicio del archivo
    const sessionChanges = new Map(); // projectId => {elements, metadata}

    try {
        // 1. Primero inicializa la base de datos
        await initializeDatabase();
        console.log('🛢️  Base de datos lista');

        const app = express();
        const server = createServer(app);
        const io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            pingTimeout: 60000
        });

        // Middleware para conexiones
        io.use((socket, next) => {
            console.log('🔄 Conexión entrante:', socket.id);
            next();
        });

        io.on('connection', (socket) => {
            console.log('🟢 Usuario conectado:', socket.id);

            socket.on('create-project', async (callback) => {
                const projectId = nanoid(12); // Más seguro que 6 caracteres
                const secretKey = nanoid(32); // Clave más larga
                const initialElements = JSON.stringify([]);
                const initialMetadata = JSON.stringify({ name: "Nuevo proyecto", version: 1 });
                console.log(`🆕 Creando nuevo proyecto: ${projectId}`);
                console.log(`🔑 Clave secreta generada: ${secretKey}`);
                console.log(`📄 Metadata inicial: ${initialMetadata}`);
                try {
                    await pool.query('BEGIN');

                    // Crear proyecto
                    await pool.query(
                        `INSERT INTO projects (id, secret_key, elements, metadata) 
                            VALUES ($1, $2, $3, $4)`,
                        [projectId, secretKey, initialElements, initialMetadata]
                    );

                    // Crear primer change
                    await pool.query(
                        `INSERT INTO changes (project_id, elements, metadata)
                            VALUES ($1, $2, $3)`,
                        [projectId, initialElements, initialMetadata]
                    );

                    await pool.query('COMMIT');
                    console.log(`✅ Proyecto ${projectId} creado exitosamente`);
                    callback({ projectId, secretKey });
                } catch (err) {
                    await pool.query('ROLLBACK');
                    console.error('❌ Error en create-project:', err);
                    callback({ error: 'Database error' });
                }
            });

            socket.on('join-project', async (projectId, secretKey, callback) => {
                console.log(`🚪 Solicitud para unirse al proyecto: ${projectId}`);
                console.log(`🔑 Clave secreta proporcionada: ${secretKey}`);
                try {
                    const { rows } = await pool.query(
                        `SELECT elements, secret_key, metadata 
            FROM projects WHERE id = $1`,
                        [projectId]
                    );

                    if (!rows.length) {
                        console.warn(`⚠️ Proyecto ${projectId} no encontrado`);
                        return callback({ error: 'Project not found' });
                    }

                    const project = rows[0];
                    const isEditor = secretKey === project.secret_key;

                    console.log(`✅ Usuario unido al proyecto ${projectId} como ${isEditor ? 'Editor' : 'Lector'}`);
                    socket.join(projectId);
                    callback({
                        elements: project.elements,
                        metadata: project.metadata,
                        isEditor
                    });
                } catch (err) {
                    console.error('❌ Error en join-project:', err);
                    callback({ error: 'Database error' });
                }
            });

            // En el evento update-elements
            socket.on('update-elements', async ({ projectId, secretKey, elements, metadata }) => {
                try {
                    console.log(`✏️  Actualización recibida para proyecto ${projectId}`);
                    console.log('🔹 Nuevos elementos:', JSON.stringify(elements));
                    console.log('🔹 Nuevo metadata:', JSON.stringify(metadata));
                    // Guardar en memoria
                    sessionChanges.set(projectId, { elements, metadata });

                    // Actualizar proyecto (como antes)
                    const { rowCount } = await pool.query(
                        `UPDATE projects 
                        SET elements = $1, metadata = $2, updated_at = NOW() 
                        WHERE id = $3 AND secret_key = $4`,
                        [JSON.stringify(elements), JSON.stringify(metadata), projectId, secretKey]
                    );

                    if (rowCount !== null && rowCount > 0) {
                        console.log(`✅ Proyecto ${projectId} actualizado correctamente en la base de datos`);
                        socket.to(projectId).emit('elements-updated', elements);
                    }
                } catch (err) {
                    console.error('Error en update-elements:', err);
                }
            });

            socket.on('manual-save', async (data, callback) => {
                try {
                    const modifiedProjects = Array.from(sessionChanges.entries());
                    for (const [projectId, { elements, metadata }] of modifiedProjects) {
                        await pool.query(
                            `INSERT INTO changes (project_id, elements, metadata) VALUES ($1, $2, $3)`,
                            [projectId, JSON.stringify(elements), JSON.stringify(metadata)]
                        );
                    }
                    sessionChanges.clear();
                    console.log('guardado manualmente:');
                    callback({ success: true });
                } catch (err) {
                    console.error('Error al guardar manualmente:', err);
                    callback({ success: false });
                }
            });

            socket.on('disconnect', async () => {
                console.log('🔴 Usuario desconectado:', socket.id);

                try {
                    // Obtener todos los proyectos que este socket modificó
                    const modifiedProjects = Array.from(sessionChanges.entries());
                    if (modifiedProjects.length === 0) {
                        console.log('ℹ️ No hay cambios en memoria para guardar.');
                    }
                    for (const [projectId, { elements, metadata }] of modifiedProjects) {
                        console.log(`💾 Guardando change para proyecto ${projectId} al desconectar...`);
                        await pool.query(
                            `INSERT INTO changes (project_id, elements, metadata)
                                VALUES ($1, $2, $3)`,
                            [projectId, JSON.stringify(elements), JSON.stringify(metadata)]
                        );

                        console.log(`✅ Change guardado para proyecto ${projectId}`);
                    }

                    // Limpiar la memoria
                    sessionChanges.clear();
                } catch (err) {
                    console.error('Error al guardar changes:', err);
                }
            });
        });

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Servidor en http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('⚠️ Error al iniciar el servidor:', err);
        process.exit(1);
    }
}

startServer();