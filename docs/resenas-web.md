# Reseñas de Google en la web pública

La sección «Opiniones» de tinteyburbuja.com enseña reseñas reales del Perfil de Empresa, leídas a través de la app.

## Cómo llega

1. La app está conectada a Google desde la página de reseñas (admin, «Conectar Google» con hola@labuhardilla.online); los tokens y el local viven en `AppSettings` (`google_*`). `backend/src/services/google.js` lee las reseñas con la API v4 de My Business, que devuelve además la media y el total reales (`fetchReviewsConResumen`).
2. `GET /api/public/reviews` (`backend/src/routes/public.js`, sin token) devuelve:

```json
{
  "averageRating": 4.8,
  "totalReviews": 53,
  "updatedAt": "2026-10-08T17:00:00.000Z",
  "reviews": [
    { "id": "AbFv…", "name": "Tiscar Zafra", "photo": "https://lh3…", "rating": 5,
      "text": "Todo perfecto. Muy profesionales. Gracias.", "date": "2026-06-11T09:31:51Z", "reply": "Muchas gracias…" }
  ]
}
```

   Sólo salen reseñas de 4 o 5 estrellas con texto (mínimo 15 caracteres), las más recientes primero y como mucho 12. El texto va sin la traducción que Google pega al final (`textoOriginal`). La media y el total son los de Google con todas las reseñas, también las que no se enseñan.
3. La app guarda la respuesta una hora en memoria (cuota de la API de Google) y manda `Cache-Control` de 15 minutos. Si Google falla y hay copia anterior, se sirve esa; si no, 503.
4. La web (`Lavanderaweb/src/lib/reviews.ts`, `useReviews`) pide esta URL al cargar, una sola vez aunque la usen el Hero y la sección de opiniones. Si no responde o viene vacía, enseña la lista fija de reserva y los números de `src/lib/site.ts`.

## Cuándo se ve una reseña nueva

Como mucho una hora y cuarto después de publicarse en Google (una hora de caché en la app más 15 minutos en el navegador). No hay nada que hacer a mano.

## Qué sigue siendo fijo

El bloque JSON-LD de `Lavanderaweb/index.html` (`aggregateRating` y tres `review`) y los números de reserva de `site.ts`. Conviene actualizarlos de vez en cuando con lo que devuelva el endpoint.
