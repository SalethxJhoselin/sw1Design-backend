import type { RequestHandler } from 'express';
import express from 'express';
import { createServer } from 'http';
import { nanoid } from 'nanoid';
import fetch from 'node-fetch';
import { Server } from 'socket.io';
import pool, { initializeDatabase } from './db.js';

// Definimos una interfaz para el cuerpo de la solicitud
interface GenerateCodeRequest {
    image: string;
}

// Definimos la interfaz para la respuesta de la API de Gemini
interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
    }>;
}


const app = express();
app.use(express.json({ limit: '10mb' }));

const generateCodeHandler: RequestHandler = async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "No se recibió la imagen" });

    const apiKey = "AIzaSyCm-PTVPeOm-Np_3QUQE324e8b0Gnu45GQ";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`;

    const prompt = `
        Eres un asistente de desarrollo frontend. A partir de esta imagen del diseño, genera el código HTML, CSS y TypeScript separados. Sé estructurado y profesional.
        1. HTML: estructura base del diseño.
        2. CSS: estilos necesarios.
        3. TypeScript: lógica de componentes si aplica.
        Responde claramente en tres bloques separados.
    `;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: "image/png",
                                    data: image,
                                },
                            },
                        ],
                    },
                ],
            }),
        });

        const data = (await response.json()) as GeminiResponse;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No se generó código.";

        const htmlMatch = text.match(/HTML:(.*?)CSS:/s);
        const cssMatch = text.match(/CSS:(.*?)TS:/s);
        const tsMatch = text.match(/TS:(.*)/s);

        res.json({
            html: htmlMatch?.[1]?.trim() || "No HTML generado.",
            css: cssMatch?.[1]?.trim() || "No CSS generado.",
            ts: tsMatch?.[1]?.trim() || "No TS generado.",
        });
    } catch (err) {
        console.error("❌ Error al llamar a Gemini API:", err);
        res.status(500).json({ error: "Error al generar código con Gemini." });
    }
}

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
        /*****************desde aqui si********************************************************* */


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