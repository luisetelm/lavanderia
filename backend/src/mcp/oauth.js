// Servidor de autorización OAuth 2.1 del conector MCP remoto.
//
// Claude.ai (y cualquier cliente MCP remoto) se registra dinámicamente, manda
// a la persona a /mcp/login, donde entra con su email y contraseña de la app,
// y recibe un código que cambia por tokens. Cada token queda ligado a un
// usuario de la app (tabla mcp_oauth_token, sql/032); al llamar a una
// herramienta, http.js emite un JWT corto de ese usuario para la API.
//
// Sólo puede entrar personal (admin, cashier, worker) activo con contraseña.

import {createHash, randomBytes} from 'node:crypto';
import {compare} from 'bcrypt';
import {InvalidGrantError, InvalidRequestError, InvalidTokenError} from '@modelcontextprotocol/sdk/server/auth/errors.js';

const ROLES_PERMITIDOS = ['admin', 'cashier', 'worker'];
const VIDA_CODIGO_MS = 10 * 60 * 1000;
const VIDA_ACCESO_S = 60 * 60;               // 1 h
const VIDA_REFRESCO_S = 30 * 24 * 60 * 60;   // 30 días
const VIDA_PETICION_MS = 15 * 60 * 1000;     // tiempo para rellenar el formulario

const hash = (t) => createHash('sha256').update(String(t)).digest('hex');
const nuevoToken = () => randomBytes(32).toString('base64url');
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Errores con la forma que espera el SDK: en /token y /mcp se convierten en
// respuestas OAuth (invalid_grant, invalid_token...); en el formulario, en texto.
class ErrorOAuth extends InvalidRequestError {
    constructor(descripcion, status = 400) {
        super(descripcion);
        this.status = status;
    }
}

/**
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {string} opts.rutaLogin   p. ej. '/mcp/login'
 */
export function crearProveedorOAuth({prisma, rutaLogin}) {
    // Peticiones de autorización pendientes de que la persona entre (en memoria:
    // viven unos minutos y el servidor es un único proceso de pm2).
    const pendientes = new Map();
    const limpiarPendientes = () => {
        const ahora = Date.now();
        for (const [id, p] of pendientes) if (p.expira < ahora) pendientes.delete(id);
    };

    const clientsStore = {
        async getClient(clientId) {
            const c = await prisma.mcpOauthClient.findUnique({where: {id: clientId}});
            return c ? c.info : undefined;
        },
        async registerClient(info) {
            await prisma.mcpOauthClient.create({data: {id: info.client_id, info}});
            return info;
        },
    };

    async function emitirTokens({clientId, userId, scopes, resource}) {
        const acceso = nuevoToken();
        const refresco = nuevoToken();
        const ahora = Date.now();
        await prisma.mcpOauthToken.createMany({
            data: [
                {tipo: 'acceso', hash: hash(acceso), clientId, userId, scopes, resource: resource || null, expiresAt: new Date(ahora + VIDA_ACCESO_S * 1000)},
                {tipo: 'refresco', hash: hash(refresco), clientId, userId, scopes, resource: resource || null, expiresAt: new Date(ahora + VIDA_REFRESCO_S * 1000)},
            ],
        });
        return {
            access_token: acceso,
            token_type: 'bearer',
            expires_in: VIDA_ACCESO_S,
            refresh_token: refresco,
            scope: scopes.join(' ') || undefined,
        };
    }

    async function buscarToken(token, tipo) {
        const fila = await prisma.mcpOauthToken.findUnique({where: {hash: hash(token)}});
        if (!fila || fila.tipo !== tipo || fila.usedAt || fila.expiresAt < new Date()) return null;
        return fila;
    }

    const proveedor = {
        get clientsStore() { return clientsStore; },

        // 1. El cliente MCP llega a /authorize: guardamos la petición y
        //    mandamos a la persona al formulario de entrada.
        async authorize(client, params, res) {
            limpiarPendientes();
            const id = nuevoToken();
            pendientes.set(id, {
                clientId: client.client_id,
                clientName: client.client_name || client.client_id,
                params,
                expira: Date.now() + VIDA_PETICION_MS,
            });
            res.redirect(`${rutaLogin}?req=${encodeURIComponent(id)}`);
        },

        async challengeForAuthorizationCode(client, codigo) {
            const fila = await buscarToken(codigo, 'codigo');
            if (!fila || fila.clientId !== client.client_id) throw new InvalidGrantError('Código no válido o caducado');
            return fila.codeChallenge;
        },

        async exchangeAuthorizationCode(client, codigo, _codeVerifier, redirectUri, resource) {
            const fila = await buscarToken(codigo, 'codigo');
            if (!fila || fila.clientId !== client.client_id) throw new InvalidGrantError('Código no válido o caducado');
            if (redirectUri && fila.redirectUri && redirectUri !== fila.redirectUri) {
                throw new InvalidGrantError('redirect_uri no coincide');
            }
            await prisma.mcpOauthToken.update({where: {id: fila.id}, data: {usedAt: new Date()}});
            return emitirTokens({clientId: client.client_id, userId: fila.userId, scopes: fila.scopes, resource: resource?.href || fila.resource});
        },

        async exchangeRefreshToken(client, refresco, scopes, resource) {
            const fila = await buscarToken(refresco, 'refresco');
            if (!fila || fila.clientId !== client.client_id) throw new InvalidGrantError('Token de refresco no válido');
            // Rotación: el refresco usado deja de valer y se emite un par nuevo.
            await prisma.mcpOauthToken.update({where: {id: fila.id}, data: {usedAt: new Date()}});
            return emitirTokens({clientId: client.client_id, userId: fila.userId, scopes: scopes?.length ? scopes : fila.scopes, resource: resource?.href || fila.resource});
        },

        async verifyAccessToken(token) {
            const fila = await buscarToken(token, 'acceso');
            if (!fila) throw new InvalidTokenError('Token caducado o revocado');
            return {
                token,
                clientId: fila.clientId,
                scopes: fila.scopes,
                expiresAt: Math.floor(fila.expiresAt.getTime() / 1000),
                resource: fila.resource ? new URL(fila.resource) : undefined,
                extra: {userId: fila.userId},
            };
        },

        async revokeToken(client, peticion) {
            const fila = await prisma.mcpOauthToken.findUnique({where: {hash: hash(peticion.token)}});
            if (!fila || fila.clientId !== client.client_id || fila.usedAt) return;
            await prisma.mcpOauthToken.update({where: {id: fila.id}, data: {usedAt: new Date()}});
        },
    };

    // 2. Formulario de entrada (GET) y validación (POST).
    function paginaLogin({req, clientName, error}) {
        return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tinte y Burbuja · Acceso</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f6fa;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px;max-width:380px;width:100%}
  h1{font-size:20px;margin:0 0 6px}p{margin:0 0 18px;color:#64748b;font-size:14px;line-height:1.45}
  label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
  button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#048ABF;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:8px}
</style></head><body>
<form class="card" method="post">
  <h1>Tinte y Burbuja</h1>
  <p><strong>${escapar(clientName)}</strong> pide acceso a la lavandería en tu nombre. Entra con tu usuario de la app: las acciones que haga Claude quedarán registradas como tuyas y tendrán tus mismos permisos.</p>
  ${error ? `<div class="err">${escapar(error)}</div>` : ''}
  <input type="hidden" name="req" value="${escapar(req)}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Contraseña</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar y autorizar</button>
</form></body></html>`;
    }

    function peticionDe(id) {
        limpiarPendientes();
        const p = id ? pendientes.get(id) : null;
        if (!p) throw new ErrorOAuth('La petición de acceso ha caducado. Vuelve a conectar el conector desde Claude.');
        return p;
    }

    async function manejarLoginGet(req, res) {
        try {
            const p = peticionDe(req.query.req);
            res.type('html').send(paginaLogin({req: req.query.req, clientName: p.clientName}));
        } catch (e) {
            res.status(e.status || 400).type('html').send(`<p style="font-family:sans-serif">${escapar(e.message)}</p>`);
        }
    }

    async function manejarLoginPost(req, res) {
        let p;
        try {
            p = peticionDe(req.body?.req);
        } catch (e) {
            return res.status(e.status || 400).type('html').send(`<p style="font-family:sans-serif">${escapar(e.message)}</p>`);
        }
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;
        const userAgent = `MCP ${p.clientName} · ${String(req.headers['user-agent'] || '').slice(0, 300)}`;
        const registrar = (userId, success, reason) => prisma.loginLog.create({
            data: {userId, email, success, reason, ip, userAgent: userAgent.slice(0, 400)},
        }).catch(() => {});

        const user = await prisma.user.findUnique({where: {email}});
        const rechazar = async (userId, reason, msg) => {
            await registrar(userId, false, reason);
            res.status(401).type('html').send(paginaLogin({req: req.body.req, clientName: p.clientName, error: msg}));
        };
        if (!user || !user.password) return rechazar(user?.id || null, 'no_user', 'Email o contraseña incorrectos.');
        if (!(await compare(password, user.password))) return rechazar(user.id, 'invalid_credentials', 'Email o contraseña incorrectos.');
        if (user.isActive === false) return rechazar(user.id, 'inactive', 'Tu cuenta está desactivada. Contacta con el administrador.');
        if (!ROLES_PERMITIDOS.includes(user.role)) return rechazar(user.id, 'mcp_role', 'Sólo el personal de la lavandería puede conectar el asistente.');

        const codigo = nuevoToken();
        await prisma.mcpOauthToken.create({
            data: {
                tipo: 'codigo',
                hash: hash(codigo),
                clientId: p.clientId,
                userId: user.id,
                scopes: p.params.scopes || [],
                codeChallenge: p.params.codeChallenge,
                redirectUri: p.params.redirectUri,
                resource: p.params.resource?.href || null,
                expiresAt: new Date(Date.now() + VIDA_CODIGO_MS),
            },
        });
        await registrar(user.id, true, null);
        pendientes.delete(req.body.req);

        const destino = new URL(p.params.redirectUri);
        destino.searchParams.set('code', codigo);
        if (p.params.state) destino.searchParams.set('state', p.params.state);
        res.redirect(destino.href);
    }

    return {proveedor, manejarLoginGet, manejarLoginPost};
}
