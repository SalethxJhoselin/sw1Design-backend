import cors from 'cors';
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { createServer } from 'http';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import pool, { initializeDatabase } from './db.js';
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
const auth = new GoogleAuth({
    keyFile: './gemini-canvas-458322-02beb64d493a.json', // asegúrate que esta ruta sea correcta
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
async function generarConVision(imageBase64) {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const endpoint = 'https://us-central1-aiplatform.googleapis.com/v1/projects/gemini-canvas-458322/locations/us-central1/publishers/google/models/gemini-1.0-pro-vision:predict';
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            instances: [
                {
                    prompt: 'Eres un asistente frontend. Genera el HTML, CSS y TypeScript de esta interfaz. Divide claramente en tres secciones.',
                    image: {
                        bytesBase64Encoded: imageBase64,
                        mimeType: 'image/png',
                    },
                },
            ],
            parameters: {
                temperature: 0.2,
            },
        }),
    });
    const result = await response.json();
    return result;
}
const generateCodeHandler = async (req, res) => {
    const { image } = req.body;
    if (!image) {
        res.status(400).json({ error: "No se recibió la imagen" });
        return;
    }
    try {
        const result = await generarConVision(image);
        // Aquí puedes parsear `result` como lo necesites.
        console.log("✅ Respuesta de Gemini con Vision:", result);
        const text = result.predictions?.[0]?.content || 'No se generó código.';
        const htmlMatch = text.match(/HTML:(.*?)CSS:/s);
        const cssMatch = text.match(/CSS:(.*?)TS:/s);
        const tsMatch = text.match(/TS:(.*)/s);
        res.json({
            html: htmlMatch?.[1]?.trim() || "No HTML generado.",
            css: cssMatch?.[1]?.trim() || "No CSS generado.",
            ts: tsMatch?.[1]?.trim() || "No TS generado.",
        });
    }
    catch (err) {
        console.error("❌ Error al generar código con Vision:", err);
        res.status(500).json({ error: "Error al generar código con Gemini Vision." });
    }
};
app.post('/generate-code', generateCodeHandler);
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000
});
async function startServer() {
    const sessionChanges = new Map(); // projectId => {elements, metadata}
    try {
        // 1. Primero inicializa la base de datos
        await initializeDatabase();
        console.log('🛢️  Base de datos lista');
        /*****************************************************Aqui no************************** */
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
                    await pool.query(`INSERT INTO projects (id, secret_key, elements, metadata) 
                            VALUES ($1, $2, $3, $4)`, [projectId, secretKey, initialElements, initialMetadata]);
                    // Crear primer change
                    await pool.query(`INSERT INTO changes (project_id, elements, metadata)
                            VALUES ($1, $2, $3)`, [projectId, initialElements, initialMetadata]);
                    await pool.query('COMMIT');
                    console.log(`✅ Proyecto ${projectId} creado exitosamente`);
                    callback({ projectId, secretKey });
                }
                catch (err) {
                    await pool.query('ROLLBACK');
                    console.error('❌ Error en create-project:', err);
                    callback({ error: 'Database error' });
                }
            });
            socket.on('join-project', async (projectId, secretKey, callback) => {
                console.log(`🚪 Solicitud para unirse al proyecto: ${projectId}`);
                console.log(`🔑 Clave secreta proporcionada: ${secretKey}`);
                try {
                    const { rows } = await pool.query(`SELECT elements, secret_key, metadata 
            FROM projects WHERE id = $1`, [projectId]);
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
                }
                catch (err) {
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
                    const { rowCount } = await pool.query(`UPDATE projects 
                        SET elements = $1, metadata = $2, updated_at = NOW() 
                        WHERE id = $3 AND secret_key = $4`, [JSON.stringify(elements), JSON.stringify(metadata), projectId, secretKey]);
                    if (rowCount !== null && rowCount > 0) {
                        console.log(`✅ Proyecto ${projectId} actualizado correctamente en la base de datos`);
                        socket.to(projectId).emit('elements-updated', elements);
                    }
                }
                catch (err) {
                    console.error('Error en update-elements:', err);
                }
            });
            socket.on('manual-save', async (data, callback) => {
                try {
                    const modifiedProjects = Array.from(sessionChanges.entries());
                    for (const [projectId, { elements, metadata }] of modifiedProjects) {
                        await pool.query(`INSERT INTO changes (project_id, elements, metadata) VALUES ($1, $2, $3)`, [projectId, JSON.stringify(elements), JSON.stringify(metadata)]);
                    }
                    sessionChanges.clear();
                    console.log('guardado manualmente:');
                    callback({ success: true });
                }
                catch (err) {
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
                        await pool.query(`INSERT INTO changes (project_id, elements, metadata)
                                VALUES ($1, $2, $3)`, [projectId, JSON.stringify(elements), JSON.stringify(metadata)]);
                        console.log(`✅ Change guardado para proyecto ${projectId}`);
                    }
                    // Limpiar la memoria
                    sessionChanges.clear();
                }
                catch (err) {
                    console.error('Error al guardar changes:', err);
                }
            });
        });
        /*****************desde aqui si********************************************************* */
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Servidor en http://localhost:${PORT}`);
        });
    }
    catch (err) {
        console.error('⚠️ Error al iniciar el servidor:', err);
        process.exit(1);
    }
}
startServer();
