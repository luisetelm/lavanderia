# Cola de impresión

Permite que la tablet del taller mande a imprimir en la impresora del ordenador
principal. La tablet no imprime: deja un encargo en el servidor, y el puesto que
tiene la impresora lo recoge y lo ejecuta.

## Por qué así

QZ Tray corre en la máquina que tiene la impresora y sólo escucha en local. Una
tablet no tiene QZ Tray, así que no puede imprimir por sí misma. La alternativa
—apuntar la tablet al QZ del ordenador por su IP— obligaría a abrir QZ a la red
y a que la tablet conozca su dirección. Con la cola:

- funciona desde cualquier dispositivo, también un móvil;
- no expone QZ Tray en la red;
- si el ordenador está apagado, el encargo espera en la cola en vez de perderse.

El encargo guarda **qué** imprimir (tipo + pedido), no el contenido ya compuesto.
Así el puesto receptor usa exactamente la misma lógica de impresión que cuando se
imprime desde él, y no hay dos formas distintas de componer una etiqueta.

## Configuración

En **Impresión → Este dispositivo**, en cada equipo:

| Dispositivo | «Tiene impresora conectada» | Nombre del puesto |
|---|---|---|
| Ordenador principal | ✅ activado | `Mostrador` |
| Tablet del taller | ❌ desactivado | `Tablet taller` |

El nombre del puesto sólo sirve para saber quién imprimió cada cosa si algo falla.

⚠️ Si se desactiva en **todos** los equipos, nadie vacía la cola y no se imprime
nada. Al menos uno tiene que tenerlo activado.

Puede haber más de un puesto con impresora: el reparto usa `SKIP LOCKED`, de modo
que cada encargo se lo lleva uno solo y nada se imprime por duplicado.

## Cómo funciona

1. La tablet completa un pedido → `POST /api/print-jobs` deja el encargo.
2. El ordenador principal, cada 6 segundos → `POST /api/print-jobs/claim`.
3. Imprime con su QZ Tray local y confirma → `/done`, o `/failed` si algo salió mal.

Detalles pensados para el día a día del taller:

- **No duplica**: si se pulsa dos veces, el segundo encargo reutiliza el pendiente.
- **Reintenta 3 veces**: un fallo temporal (impresora sin papel) vuelve a la cola;
  a la tercera se marca como fallido y deja de reintentarse.
- **No se solapa**: si una impresión tarda, la siguiente comprobación se salta.
- **Pestaña en segundo plano**: no reclama encargos, para no quedárselos sin poder
  imprimirlos.

## Ver y arreglar la cola

```sql
-- Qué hay pendiente o atascado
SELECT id, type, "orderId", status, "claimedBy", attempts, error, "createdAt"
FROM print_job WHERE status IN ('pending','printing','failed') ORDER BY "createdAt";

-- Reintentar un encargo fallido
UPDATE print_job SET status='pending', attempts=0, error=NULL WHERE id = ?;
```

También desde la aplicación: `GET /api/print-jobs`.

## Si algo no se imprime

1. ¿El ordenador principal tiene la aplicación abierta y la sesión iniciada? El
   vigilante sólo corre con la aplicación abierta.
2. ¿Tiene «Tiene impresora conectada» activado?
3. ¿Está activada la regla correspondiente («Al marcar como listo», «Al finalizar
   cada prenda»)? Si está desactivada en el puesto receptor, el encargo vuelve a
   la cola con ese error: la etiqueta no se pierde, pero no se imprime.
4. Mirar `error` en la tabla `print_job`.

## Pendiente

- El vigilante consulta cada 6 segundos. Para el volumen actual sobra; si algún
  día molesta la espera, el paso natural es notificar por WebSocket en vez de
  preguntar.
- Sólo están contemplados los dos tipos de etiqueta del taller
  (`finished_label` y `garment_label`). Los tickets de cliente y las etiquetas de
  lavado se siguen imprimiendo desde el mostrador, que es donde se generan.
