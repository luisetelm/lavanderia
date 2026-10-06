// Arranque del conector MCP remoto como proceso (pm2 «lavanderia-mcp»).
//
//   MCP_PORT         puerto (4100)
//   MCP_PUBLIC_URL   URL pública sin ruta (https://app.tinteyburbuja.com)
//   MCP_API_URL      API interna (http://127.0.0.1:4000/api)
//   JWT_SECRET       el mismo del backend

import dotenv from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrismaClient} from '@prisma/client';
import {crearAppMcp} from './http.js';
import {NOMBRE_SERVIDOR} from './servidor.js';

dotenv.config({path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')});

const PORT = Number(process.env.MCP_PORT) || 4100;
if (!process.env.JWT_SECRET) {
    console.error('[mcp-http] Falta JWT_SECRET en .env');
    process.exit(1);
}

const app = crearAppMcp({
    prisma: new PrismaClient(),
    publicUrl: process.env.MCP_PUBLIC_URL || `http://localhost:${PORT}`,
    apiUrl: process.env.MCP_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}/api`,
    jwtSecret: process.env.JWT_SECRET,
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`[mcp-http] ${NOMBRE_SERVIDOR} escuchando en http://127.0.0.1:${PORT}/mcp (público: ${process.env.MCP_PUBLIC_URL || 'sin MCP_PUBLIC_URL'})`);
});
