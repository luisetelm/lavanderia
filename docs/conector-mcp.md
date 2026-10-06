# Conector MCP de la lavandería

Servidor MCP (Model Context Protocol) que expone los procesos de Tinte y Burbuja
a Claude: buscar clientes, ver y crear pedidos, precios, entregas, carga de
trabajo, ventas y el chat con clientes. Lo usan tres consumidores con el mismo
código:

| Consumidor | Modo | Entrada |
|---|---|---|
| claude.ai y la app de escritorio (personal) | HTTP remoto con OAuth | `https://app.tinteyburbuja.com/mcp` |
| Claude Code (desarrollo, consultas) | stdio local | `.mcp.json` del repositorio |
| El propio backend (botón ✨ del chat) | en proceso, API de Claude | `backend/src/services/asistente.js` |

## Principio de diseño

El conector **nunca toca la base de datos**: todas las herramientas llaman a la
API (`/api/...`) por HTTP con un token del usuario que conecta. Así se aplican
las mismas reglas que en el TPV (precio pactado > gran cliente > público,
suplemento de urgencia, no entregar sin cobrar, avisos, historial, permisos por
rol) y cualquier mejora de la API llega al conector sin duplicar lógica.

## Archivos

```
backend/src/mcp/
  api.js           cliente HTTP de la API (Bearer, errores en castellano, reintento tras 401)
  herramientas.js  definición de las herramientas (zod + handler); fuente única para MCP y el asistente
  servidor.js      McpServer: instrucciones + registro de herramientas según el rol
  stdio.js         arranque local (Claude Code / escritorio): entra con MCP_EMAIL/MCP_PASSWORD
  oauth.js         servidor OAuth 2.1 (registro dinámico, PKCE, login con el usuario de la app)
  http.js          app Express del servidor remoto: Streamable HTTP en /mcp + OAuth + metadatos .well-known
  arranque-http.js arranque como proceso (pm2 lavanderia-mcp)
backend/src/services/asistente.js   borrador de respuesta del chat con la API de Claude
backend/src/utils/presupuesto.js    cálculo compartido de líneas/fecha/urgencia (lo usa POST /orders y /orders/quote)
backend/sql/032_mcp_oauth.sql       tablas mcp_oauth_client y mcp_oauth_token
.mcp.json                           servidor para Claude Code
```

## Herramientas

Lectura (`readOnlyHint`):

| Herramienta | Qué hace | API |
|---|---|---|
| `buscar_cliente` | nombre, empresa, teléfono (sólo dígitos) o email | `GET /users?q&role=customer` |
| `ver_cliente` | ficha, condiciones, días fijos, pedidos, facturas, pactados vigentes | `GET /users/:id`, `GET /users/:id/prices` |
| `catalogo` | productos con precio público, tarifa gran cliente y variantes | `GET /products` |
| `precio_efectivo` | precio real de un producto para un cliente (origen: pactado / gran_cliente / base) | `POST /orders/quote` |
| `listar_pedidos` | por texto, estado, cliente, fechas de creación o entrega | `GET /orders`, `GET /users/:id` |
| `ver_pedido` | por id o número TPV/AAAA/NNNN: líneas, notas, pasos del taller, pagos, saldo, historial | `GET /orders/find`, `/orders/:id`, `/orders/:id/history` |
| `entregas_del_dia` | entregas de un día y pedidos atrasados | `GET /orders?deliveryFrom&deliveryTo` |
| `carga_de_trabajo` | calendario de carga, fecha sugerida, tope diario y % de urgencia por día | `GET /orders/delivery-dates` |
| `resumen_ventas` (admin) | hoy: pedidos, cobros, caja; periodo: ingresos por método y productos más vendidos | `GET /dashboard`, `/cash/income-report`, `/dashboard/top-products` |
| `conversaciones` | lista del chat con no leídos y ventana de 24 h de WhatsApp | `GET /messages/conversations` |
| `conversacion` | mensajes de una conversación (por id, cliente o teléfono) | `GET /messages` |
| `presupuestar_pedido` | valora un pedido sin guardarlo (líneas, fecha, suplemento de urgencia) | `POST /orders/quote` |

Escritura (piden confirmación de la persona en las instrucciones; `crear_pedido`
además exige `confirmadoPorUsuario=true`):

| Herramienta | Qué hace | API |
|---|---|---|
| `crear_pedido` | alta real del pedido (cliente existente o nuevo) | `POST /orders` |
| `cambiar_estado_pedido` | pending / in_progress / ready / collected / cancelled, con aviso opcional al cliente | `PATCH /orders/:id` |
| `registrar_pago` | cobro completo en efectivo (con cambio) o tarjeta | `POST /orders/:id/pay` |
| `fijar_precio_pactado` (admin) | precio pactado por cliente y producto con vigencia | `POST /users/:id/prices` |
| `enviar_mensaje` | texto por WhatsApp (ventana abierta) o SMS en una conversación existente | `POST /messages/send` |

Las herramientas marcadas con rol sólo se registran para ese rol: un cajero no ve
`resumen_ventas` ni `fijar_precio_pactado`. Los errores de la API (400/403/404)
llegan al modelo como resultado con `isError` y el mensaje tal cual, para que lo
explique y proponga la alternativa.

## `POST /api/orders/quote`

Nuevo endpoint: valora un pedido exactamente igual que `POST /api/orders` pero
sin guardar nada. Cuerpo `{clientId?, lines:[{productId, variantId?, quantity}],
fechaLimite?, sinSuplemento?}`; respuesta `{client, lineas[{productName,
quantity, unitPrice, discount, totalPrice, origenPrecio}], total, fechaLimite,
fechaLimiteElegida, suplementoUrgencia}`. El cálculo vive en
`utils/presupuesto.js` y lo comparte con el alta, así el presupuesto que ve
Claude es el importe que se cobrará.

## Autenticación

**Remoto (claude.ai):** OAuth 2.1 con registro dinámico de clientes y PKCE
(`oauth.js`, sobre los handlers del SDK oficial). Al conectar, Claude manda a la
persona a `/mcp/login`, donde entra con su email y contraseña de la app (sólo
roles `admin`, `cashier`, `worker` activos; el intento se registra en
`LoginLog`). El código se cambia por un token de acceso (1 h) y uno de refresco
(30 días, con rotación), guardados por hash en `mcp_oauth_token` y ligados al
usuario. En cada petición MCP, `http.js` verifica el token, emite un JWT de 15
minutos de ese usuario y monta un servidor MCP sin estado con sus herramientas.

Rutas públicas: `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource/mcp`, `/mcp/oauth/{authorize,token,register,revoke}`,
`/mcp/login`, `/mcp` (Bearer) y `/mcp/salud`.

**Local (Claude Code):** `stdio.js` inicia sesión en `MCP_API_URL` con
`MCP_EMAIL`/`MCP_PASSWORD` (o usa `MCP_TOKEN`) y renueva el token si caduca.

**Asistente interno:** `asistente.js` firma un JWT corto del empleado que pulsa
✨ y llama a la API local; sólo registra las herramientas de lectura y no envía
nada: el borrador vuelve al compositor del chat (`ChatThread.jsx`) para que se
revise antes de enviarlo. Si el compositor ya tiene texto, se usa como
indicación de lo que se quiere transmitir.

## Variables de entorno

```
MCP_PORT=4100
MCP_PUBLIC_URL=https://app.tinteyburbuja.com     # remoto: URL pública sin ruta
MCP_API_URL=http://127.0.0.1:4000/api            # API que llaman las herramientas (en local: la de producción)
MCP_EMAIL / MCP_PASSWORD / MCP_TOKEN             # sólo modo stdio
ANTHROPIC_API_KEY, ASISTENTE_MODELO              # asistente del chat (por defecto claude-opus-5-5)
JWT_SECRET                                       # el mismo del backend
```

## Probar

Con la API simulada y el prisma de mentira (sin base de datos) se cubre el modo
stdio (17 herramientas, errores de la API, normalización de teléfonos, aviso
«según cliente», cobro con cambio) y el flujo OAuth completo del modo remoto
(descubrimiento, registro, formulario, rechazo de clientes y contraseñas
erróneas, PKCE, canje único del código, refresco con rotación, revocación,
herramientas por rol). Contra la API real basta con arrancar el backend y
`npm run mcp` con un usuario en `.env`, o `npm run mcp:http` y conectar el
Inspector de MCP a `http://localhost:4100/mcp`.
