# Precios pactados por cliente

Permiten fijar, para un cliente y un producto, un precio distinto del de
catálogo según el acuerdo al que se haya llegado con él. Ejemplo: subir
KG. ROPA BLANCA a 1,50 € + IVA y mantener 1,573 € a los apartamentos que ya lo
tenían.

## Qué precio se cobra

Al crear un pedido, o al añadir productos a uno ya cobrado, el precio unitario
de cada línea se elige en este orden:

1. **Precio pactado vigente** del cliente para ese producto.
2. **Tarifa de gran cliente**, si el cliente está marcado como gran cliente y el
   producto la tiene.
3. **Precio normal** del producto.

El descuento en porcentaje de la ficha del cliente **no se aplica** sobre un
precio pactado: el pactado ya es el precio acordado. Sí se sigue aplicando a los
productos sin acuerdo.

Los precios van con IVA incluido, igual que en el catálogo.

La regla está en un único sitio del backend, `src/utils/precioLinea.js`. El TPV
la replica sólo para enseñar el importe antes de validar; el importe que se
guarda es siempre el que calcula el backend.

## Vigencia

- Cada acuerdo tiene fecha de inicio y, opcionalmente, de fin. Ambos días cuentan.
- Dos acuerdos del mismo cliente y producto no pueden solaparse.
- Para **cambiar un precio a partir de una fecha** basta con crear el acuerdo
  nuevo: el anterior se cierra solo el día antes.
- **Finalizar** un acuerdo lo deja de aplicar desde hoy. Si aún no había empezado
  se elimina; si ya se aplicó, queda en el histórico cerrado ayer.
- Las líneas de pedido guardan su precio, así que cambiar o finalizar un acuerdo
  no toca pedidos ni facturas anteriores.

## Dónde se ve

- **Ficha del cliente → Precios pactados.** Cualquier empleado los consulta; sólo
  administración crea, edita o finaliza.
- **TPV.** Al elegir el cliente, el catálogo y las prendas del pedido muestran el
  precio pactado con la marca «pactado».
- **Ajustar pedido.** Los productos añadidos muestran el precio pactado del cliente.

## API

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/users/:id/prices` | empleados |
| GET | `/api/users/:id/effective-prices` | empleados |
| POST | `/api/users/:id/prices` | admin |
| PUT | `/api/users/:id/prices/:priceId` | admin |
| DELETE | `/api/users/:id/prices/:priceId` | admin |

## Despliegue

1. Ejecutar `backend/sql/022_precios_pactados.sql` en la base de datos.
2. Desplegar el backend (incluye `npx prisma generate`) y el frontend.

Si el backend se despliega antes que el SQL, los pedidos se siguen cobrando con
la tarifa de siempre y el log avisa de que falta la tabla.
