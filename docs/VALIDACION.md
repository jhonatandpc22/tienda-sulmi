# Validación de Tienda Sulmi · 1.1

Pruebas ejecutadas el 12 de septiembre de 2026 con datos ficticios. No se registraron operaciones de prueba en el proyecto Firebase real de Sulmi.

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 39 pruebas aprobadas: 16 de negocio, 9 de interfaz/render y 14 de sincronización. |
| `npm run test:firebase` | 7 entradas aprobadas, contando la suite, en emuladores Auth/Firestore de `demo-sulmi`. SDK 11.6.1, igual que la aplicación. |
| `npm run build` | CSS, recursos estáticos y service worker versionado generados correctamente. |

## Operaciones verificadas

Ventas por unidad y paquete, combos, ventas marcadas, consumo interno, pago dividido con crédito, abonos, ingresos de stock, impresiones, detalles con componentes, edición y cancelación del editor, eliminación de venta con devolución de stock, importación y exportación de respaldo.

Un doble toque durante el guardado registra una sola venta. Si IndexedDB rechaza el guardado, se conserva el carrito y no se confirma la operación como guardada. Las ediciones compensan la cantidad original y aplican la nueva dentro del mismo lote.

## Sincronización

- Confirmación local antes de esperar al servidor y conservación después de cerrar/reabrir.
- Respuesta perdida después de confirmar Firebase: repetir la misma operación no duplica ni venta ni descuento.
- Simulación de dos pestañas, snapshots atrasados y operaciones pendientes de otra pestaña antes de recibir su notificación.
- Rechazo real de cuota local y transacciones de IndexedDB abortadas sin cambios parciales.
- Reintentos automáticos y operaciones rechazadas por autorización que permanecen pendientes.
- Cambiar un producto escribe ese documento, sin regrabar las 2.000 ventas del escenario de prueba.

En Firebase emulado, el stock inicial de 20 quedó en 18 tras vender dos unidades. Cerrar y reenviar tras perder la respuesta lo conservó en 18, con una venta. Una entrada de otra caja lo llevó a 23; eliminar la venta y reenviar la eliminación dos veces lo dejó en 25, con una sola restitución.

## Alcance y límites

Las pruebas de interfaz utilizan JSDOM y revisión de CSS; no equivalen a una revisión visual en teléfonos físicos o en la laptop del usuario. Los tiempos de `RENDIMIENTO.md` son mediciones controladas de CPU/DOM y no latencia de Firebase.

La primera carga de un dispositivo todavía descarga el historial necesario para mantener los envases antiguos. Las aperturas posteriores usan la base local; los cambios remotos se procesan incrementalmente. La conexión y las cuotas de Firebase pueden retrasar la sincronización. La actualización conserva el modelo comercial anterior; esta revisión no certifica funciones que no figuran en los escenarios anteriores.
