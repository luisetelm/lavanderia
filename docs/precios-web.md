# Precios en la web pública

La tarifa de [tinteyburbuja.com](https://tinteyburbuja.com) (sección «Servicios y precios») sale del catálogo de la app, no de un fichero de la web. Así un cambio de precio en el catálogo aparece en la web sin tocar nada más.

## Qué se publica

Cada producto tiene en su ficha (Productos > editar > bloque **Web pública**):

- **Sección**: dónde sale en la web: *Lavado y planchado*, *Tintorería* u *Hostelería*. Sin sección, no se publica. Por defecto ningún producto se publica.
- **Nombre en la web**: el nombre que ve el público. Si se deja vacío se usa el del catálogo pasado a frase («TRAJE CABALLERO» → «Traje caballero»). Conviene escribirlo: los nombres del catálogo llevan abreviaturas («EDREDON 1.35/1.50CM»).
- **Orden**: posición dentro de su sección (menor, antes). A igual orden, alfabético.

Los productos archivados no salen aunque tengan sección.

## Qué precio sale

Sólo el **precio al público** (`basePrice`, IVA incluido), el mismo del mostrador.

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

Debajo de la tarifa hay un formulario corto: teléfono y qué prenda o servicio. Al enviarlo, `POST /api/public/price-request` (`{ phone, item, name? }`):

1. Normaliza y valida el teléfono con la misma regla que el resto de la app (`backend/src/utils/validatePhone.js`).
2. Si el número es de un cliente, vincula la conversación a su ficha; si no, crea una conversación con ese número, como cuando escribe alguien desconocido por WhatsApp.
3. Guarda un mensaje entrante del canal `web` («Pide precio desde la web: …») y sube el contador de no leídos.

En la app aparece en el chat flotante como cualquier mensaje nuevo, con la etiqueta WEB. Quien atienda le contesta por WhatsApp desde la misma conversación. Como el cliente aún no ha escrito por WhatsApp, la ventana de 24 horas está cerrada: el primer mensaje tiene que ser una plantilla, igual que con cualquier número nuevo.

Protección: campo trampa para bots y un máximo de 3 peticiones por IP cada 10 minutos.
