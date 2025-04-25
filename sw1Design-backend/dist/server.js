"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
// Configurar Express
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
// Configurar Socket.IO con CORS (para desarrollo)
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// Evento de conexión
io.on('connection', (socket) => {
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
app.get('/', (req, res) => {
    res.send('Servidor WebSocket con TypeScript funcionando 🚀');
});
