import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

// Configurar Express
const app = express();
const server = createServer(app);

// Configurar Socket.IO con CORS (para desarrollo)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Evento de conexión
io.on('connection', (socket: Socket) => {
    console.log('🟢 Usuario conectado:', socket.id);

    socket.on('new-element', (data) => {
        console.log('Nuevo elemento:', data);
        socket.broadcast.emit('receive-element', data);
    });

    socket.on('move-element', (data) => {
        socket.broadcast.emit('move-element', data);
    });

    socket.on('update-element', (data) => {
        socket.broadcast.emit('receive-update-element', data);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Usuario desconectado:', socket.id);
    });
});

// Ruta básica
app.get('/', (req: Request, res: Response) => {
    res.send('Servidor WebSocket con TypeScript funcionando 🚀');
});

