-- 032: tablas del servidor OAuth del conector MCP remoto (src/mcp/oauth.js).
--
-- mcp_oauth_client: clientes MCP registrados dinámicamente (claude.ai, la app
--   de escritorio...). `info` guarda los metadatos tal cual los manda el
--   cliente (redirect_uris, client_name, client_secret...).
-- mcp_oauth_token: códigos de autorización, tokens de acceso y de refresco,
--   guardados por su hash SHA-256 y ligados al usuario de la app que entró.
--   `used_at` marca el código canjeado o el token revocado/rotado.
--
-- Aplicar en el servidor:  psql -U lavanderia -d lavanderia -f sql/032_mcp_oauth.sql

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_oauth_client (
    id         VARCHAR(255) PRIMARY KEY,
    info       JSONB        NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_token (
    id             SERIAL PRIMARY KEY,
    tipo           VARCHAR(16)  NOT NULL,            -- 'codigo' | 'acceso' | 'refresco'
    hash           VARCHAR(64)  NOT NULL UNIQUE,     -- sha256 hex del token
    client_id      VARCHAR(255) NOT NULL REFERENCES mcp_oauth_client(id) ON DELETE CASCADE,
    user_id        INTEGER      NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    scopes         TEXT[]       NOT NULL DEFAULT '{}',
    code_challenge VARCHAR(255),
    redirect_uri   TEXT,
    resource       TEXT,
    expires_at     TIMESTAMPTZ  NOT NULL,
    used_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_token_user_idx ON mcp_oauth_token(user_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_token_expires_idx ON mcp_oauth_token(expires_at);

COMMIT;
