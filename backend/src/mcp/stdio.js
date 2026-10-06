// Conector MCP en modo local (stdio): para Claude Code o la app de escritorio
// en el ordenador de un empleado. Inicia sesión en la API con las credenciales
// del .env del backend y expone las herramientas de ese usuario.
//
//   MCP_API_URL   URL de la API (por defecto https://app.tinteyburbuja.com/api)
//   MCP_EMAIL / MCP_PASSWORD   usuario de la app con el que actuar
//   MCP_TOKEN     alternativa: un JWT ya emitido (caduca a las 8 h)
//
// Nada puede escribirse en stdout salvo el protocolo MCP: los avisos van a
// stderr.

import dotenv from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {crearApi, iniciarSesion, decodificarJwt} from './api.js';
import {crearServidorMcp} from './servidor.js';

dotenv.config({path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')});

const API_URL = (process.env.MCP_API_URL || 'https://app.tinteyburbuja.com/api').replace(/\/+$/, '');

async function credenciales() {
    if (process.env.MCP_TOKEN) {
        const p = decodificarJwt(process.env.MCP_TOKEN) || {};
        return {
            token: process.env.MCP_TOKEN,
            usuario: {id: p.userId, role: p.role, nombre: p.email || `usuario ${p.userId}`},
            renovar: null,
        };
    }
    const email = process.env.MCP_EMAIL;
    const password = process.env.MCP_PASSWORD;
    if (!email || !password) {
        throw new Error('Faltan MCP_EMAIL y MCP_PASSWORD (o MCP_TOKEN) en backend/.env');
    }
    const r = await iniciarSesion(API_URL, email, password);
    const estado = {token: r.token};
    return {
        get token() { return estado.token; },
        usuario: {id: r.user?.id, role: r.user?.role, nombre: r.user?.name || `${r.user?.firstName || ''} ${r.user?.lastName || ''}`.trim()},
        renovar: async () => {
            const n = await iniciarSesion(API_URL, email, password);
            estado.token = n.token;
        },
    };
}

async function main() {
    const cred = await credenciales();
    const api = crearApi({
        baseUrl: API_URL,
        obtenerToken: async () => cred.token,
        renovarToken: cred.renovar || undefined,
    });
    const server = crearServidorMcp({api, usuario: cred.usuario});
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[mcp] Conectado a ${API_URL} como ${cred.usuario.nombre} (${cred.usuario.role})`);
}

main().catch((e) => {
    console.error('[mcp] No se pudo arrancar:', e.message);
    process.exit(1);
});
