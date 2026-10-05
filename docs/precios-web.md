# Precios en la web pública

La tarifa de [tinteyburbuja.com](https://tinteyburbuja.com) (sección «Servicios y precios») sale del catálogo de la app, no de un fichero de la web. Así un cambio de precio en el catálogo aparece en la web sin tocar nada más.

## Qué se publica

Cada producto tiene en su ficha (Productos > editar > bloque **Web pública**):

- **Sección**: dónde sale en la web: *Lavado y planchado*, *Tintorería* u *Hostelería*. Sin sección, no se publica. Por defecto ningún producto se publica.
- **Nombre en la web**: el nombre que ve el público. Si se deja vacío se usa el del catálogo pasado a frase («TRAJE CABALLERO» → «Traje caballero»). Conviene escribirlo: los nombres del catálogo llevan abreviaturas («EDREDON 1.35/1.50CM»).
- **Orden**: posición dentro de su sección (menor, antes). A igual orden, alfabético.

Los productos archivados no salen aunque tengan sección.

## Qué precio sale

Sólo el **precio al público** (`basePrice`, IVA incluido), el mismo del mostrador. En la web y en la plantilla de WhatsApp va siempre como «desde», porque es el precio para la fecha de entrega que propone el calendario: adelantarla lleva el suplemento de urgencia (`sql/027`), que se calcula en el TPV en cada pedido.

- La **tarifa de gran cliente** (`bigClientPrice`) y los **precios pactados** con cada cliente no se publican nunca. Son acuerdos con hoteles, restaurantes y apartamentos a los que se factura a fin de mes.
- En la sección **Hostelería** los productos salen **sin precio**: la web dice «presupuesto» y remite a WhatsApp. Sirve para enseñar qué se hace (mantelería, ropa de cama, uniformes), no cuánto cuesta.

Dos tipos de cliente, dos tratos: el particular paga el precio de la web al recoger; el gran cliente tiene su tarifa, factura mensual y, si quiere, domiciliación (`docs/domiciliacion-sepa.md`).

## Cómo lo lee la web

`GET /api/public/prices` (sin token; el prefijo `/api/public/` está en la lista de rutas públicas de `backend/src/server.js`). Responde:

```json
{
  "currency": "EUR",
  "vatIncluded": true,
  "updatedAt": "2026-10-05T12:00:00.000Z",
  "sections": {
    "lavado":     [{ "id": 110, "name": "Ropa por kilos", "price": 4, "unit": "kg" }],
    "tintoreria": [{ "id": 2,   "name": "Traje de caballero", "price": 18.5, "unit": "prenda" }],
    "hosteleria": [{ "id": 55,  "name": "Mantelería", "price": null, "unit": "prenda" }]
  }
}
```

`unit` es `kg` si el nombre del catálogo contiene «KG», `prenda` en el resto. La respuesta lleva `Cache-Control` de 15 minutos: un cambio tarda como mucho eso en verse.

La web (`Lavanderaweb/src/components/Services.tsx`) pide esta URL al cargar y, si no responde o viene vacía, muestra la lista fija que lleva en el código, para que la página nunca se quede sin tarifa.

## Base de datos

`backend/sql/031_productos_web.sql`: columnas `web_section`, `web_name` y `web_order` en `"Product"`, con `CHECK` sobre la sección. Ejecutar antes de desplegar el backend, como el resto de scripts de `sql/`.

## Pedir precio desde la web

Debajo de la tarifa hay un formulario corto: teléfono con WhatsApp y prenda. Hay dos caminos, los dos por `POST /api/public/price-request`:

**Producto de la tarifa** (`{ phone, productId }`). La app le manda al momento la plantilla de WhatsApp `precio_web` con el nombre del producto y su precio al público. Es la única forma de escribir a quien nunca nos ha escrito: WhatsApp sólo permite iniciar conversación con una plantilla aprobada. Si el cliente responde, se abre la ventana de 24 horas y el equipo sigue en texto libre desde el chat. Sólo vale para productos de Lavado y Tintorería con precio; Hostelería no tiene precio público.

**Otra prenda** (`{ phone, item }`). No hay precio que mandar: entra en el chat como mensaje del canal `web` («Pide precio desde la web: …») y el equipo contesta por WhatsApp, con plantilla, como a cualquier número nuevo.

En los dos casos:

1. El teléfono se normaliza y valida con la regla de toda la app (`backend/src/utils/validatePhone.js`).
2. Si el número es de un cliente, la conversación queda en su ficha; si no, se crea con ese número.
3. Queda un mensaje entrante `web` con lo pedido, y la plantilla enviada como mensaje saliente, y la conversación sube a no leída para que el equipo vea el interés aunque el precio ya haya salido.
4. Si la plantilla no se puede mandar (no está aprobada, WhatsApp sin configurar, el número no tiene WhatsApp), la petición queda igualmente en el chat y la web le dice al cliente que le escribiremos nosotros. La respuesta lleva `sent: true|false`.

La plantilla está definida en `backend/src/services/whatsapp.js` (`PLANTILLA_PRECIO_WEB`) y se da de alta en Meta con `POST /api/whatsapp/templates/setup-defaults` (admin), junto a las de pedido listo y recogido. Hasta que Meta la apruebe, el formulario funciona por el segundo camino.

Protección: campo trampa para bots y un máximo de 3 peticiones por IP cada 10 minutos.
