// Conector MCP remoto (Streamable HTTP + OAuth) para claude.ai y la app de
// escritorio. Proceso aparte del backend (pm2 «lavanderia-mcp», puerto
// MCP_PORT); nginx le pasa /mcp y /.well-known/oauth-*.
//
//   GET  /.well-known/oauth-authorization-server   metadatos OAuth (RFC 8414)
//   GET  /.well-known/oauth-protected-resource/mcp metadatos del recurso (RFC 9728)
//   *    /mcp/oauth/{authorize,token,register,revoke}
//   GET/POST /mcp/login                            formulario de entrada
//   POST /mcp                                      endpoint MCP (Bearer)
//
// Cada petición MCP se atiende sin estado: se verifica el token, se carga el
// usuario, se emite un JWT corto para la API y se monta un servidor MCP con
// sus herramientas. Las herramientas llaman a la API por HTTP en local.
//
//   MCP_PORT         puerto (4100)
//   MCP_PUBLIC_URL   URL pública sin ruta (https://app.tinteyburbuja.com)
//   MCP_API_URL      API interna (http://127.0.0.1:4000/api)
//   JWT_SECRET       el mismo del backend

import dotenv from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import {PrismaClient} from '@prisma/client';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {authorizationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import {tokenHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import {clientRegistrationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import {revocationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {metadataHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import {requireBearerAuth} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {crearProveedorOAuth} from './oauth.js';
import {crearApi} from './api.js';
import {crearServidorMcp, NOMBRE_SERVIDOR} from './servidor.js';

dotenv.config({path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')});

const RUTA_MCP = '/mcp';
const RUTA_LOGIN = '/mcp/login';

/**
 * Construye la app Express del conector. Separado del arranque para poder
 * probarla con un prisma de mentira y una API simulada.
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {string} opts.publicUrl  URL pública sin ruta
 * @param {string} opts.apiUrl     API interna a la que llaman las herramientas
 * @param {string} opts.jwtSecret
 */
export function crearAppMcp({prisma, publicUrl, apiUrl, jwtSecret}) {
const PUBLIC_URL = String(publicUrl).replace(/\/+$/, '');
const API_URL = String(apiUrl).replace(/\/+$/, '');
const JWT_SECRET = jwtSecret;
const URL_RECURSO = new URL(RUTA_MCP, PUBLIC_URL);
const {proveedor, manejarLoginGet, manejarLoginPost} = crearProveedorOAuth({prisma, rutaLogin: RUTA_LOGIN});

// Metadatos: el emisor es la raíz pública y los endpoints cuelgan de /mcp/oauth
// (así nginx sólo tiene que pasar /mcp y /.well-known/oauth-*).
const metadatosOAuth = {
    issuer: `${PUBLIC_URL}/`,
    authorization_endpoint: `${PUBLIC_URL}/mcp/oauth/authorize`,
    token_endpoint: `${PUBLIC_URL}/mcp/oauth/token`,
    registration_endpoint: `${PUBLIC_URL}/mcp/oauth/register`,
    revocation_endpoint: `${PUBLIC_URL}/mcp/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    service_documentation: `${PUBLIC_URL}/mcp`,
};
const metadatosRecurso = {
    resource: URL_RECURSO.href,
    authorization_servers: [metadatosOAuth.issuer],
    resource_name: 'Tinte y Burbuja',
    bearer_methods_supported: ['header'],
};

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// CORS abierto para los endpoints de descubrimiento y OAuth (los clientes MCP
// de navegador los llaman desde otro origen; el token sigue siendo necesario).
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Descubrimiento
// Cada ruta exacta con su propio router: el del SDK sólo responde en su raíz.
for (const ruta of ['/.well-known/oauth-authorization-server/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration/mcp', '/.well-known/openid-configuration']) {
    app.use(ruta, metadataHandler(metadatosOAuth));
}
for (const ruta of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    app.use(ruta, metadataHandler(metadatosRecurso));
}

// OAuth
app.use('/mcp/oauth/authorize', authorizationHandler({provider: proveedor}));
app.use('/mcp/oauth/token', tokenHandler({provider: proveedor}));
app.use('/mcp/oauth/register', clientRegistrationHandler({clientsStore: proveedor.clientsStore, clientSecretExpirySeconds: 0}));
app.use('/mcp/oauth/revoke', revocationHandler({provider: proveedor}));
app.get(RUTA_LOGIN, manejarLoginGet);
app.post(RUTA_LOGIN, express.urlencoded({extended: false}), manejarLoginPost);

// Página informativa para humanos
app.get(RUTA_MCP, (req, res, next) => {
    if ((req.headers.accept || '').includes('text/event-stream') || req.headers.authorization) return next();
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Conector MCP · Tinte y Burbuja</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1e293b;line-height:1.5}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Conector MCP de Tinte y Burbuja</h1>
<p>Este es el endpoint del conector para Claude. Para usarlo, añade en Claude un conector personalizado con la URL <code>${URL_RECURSO.href}</code> y entra con tu usuario de la app cuando te lo pida.</p>
<p>Sólo puede conectarse el personal de la lavandería. Cada acción queda registrada a nombre de quien conecta.</p></body></html>`);
});

// Endpoint MCP
const exigirToken = requireBearerAuth({
    verifier: proveedor,
    resourceMetadataUrl: `${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`,
});

app.all(RUTA_MCP, express.json({limit: '4mb'}), exigirToken, async (req, res) => {
    const userId = req.auth?.extra?.userId;
    const user = userId ? await prisma.user.findUnique({
        where: {id: Number(userId)},
        select: {id: true, firstName: true, lastName: true, email: true, role: true, isActive: true},
    }) : null;
    if (!user || user.isActive === false) {
        res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Usuario no válido"');
        return res.status(401).json({error: 'Usuario no válido o desactivado'});
    }

    // JWT corto del usuario para la API: el backend vuelve a comprobar en cada
    // petición que sigue activo y toma el rol de la base de datos.
    const token = jwt.sign({userId: user.id, role: user.role, email: user.email}, JWT_SECRET, {expiresIn: '15m'});
    const api = crearApi({baseUrl: API_URL, obtenerToken: async () => token});
    const servidor = crearServidorMcp({
        api,
        usuario: {id: user.id, role: user.role, nombre: `${user.firstName || ''} ${user.lastName || ''}`.trim()},
    });
    const transporte = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    res.on('close', () => {
        transporte.close().catch(() => {});
        servidor.close().catch(() => {});
    });
    try {
        await servidor.connect(transporte);
        await transporte.handleRequest(req, res, req.body);
    } catch (e) {
        console.error('[mcp-http] Error atendiendo petición MCP:', e);
        if (!res.headersSent) res.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: 'Error interno'}, id: null});
    }
});

app.get('/mcp/salud', (req, res) => res.json({ok: true, servidor: NOMBRE_SERVIDOR}));

return app;
}

// Arranque como proceso (pm2 lavanderia-mcp)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
        console.log(`[mcp-http] ${NOMBRE_SERVIDOR} escuchando en http://127.0.0.1:${PORT}${RUTA_MCP}`);
    });
}
