# Rendimiento de Tienda Sulmi

Se mantuvieron los módulos, los datos históricos y los importes originales. Estas mejoras reducen trabajo repetido en la interfaz:

- **Carrito:** al añadir o cambiar una cantidad se actualiza la tarjeta del producto afectado. Las demás tarjetas conservan sus elementos HTML. Una actualización del inventario también conserva las tarjetas cuyo contenido no cambió.
- **Envases:** se construye un índice por producto al cambiar los datos, en lugar de recorrer todas las ventas y devoluciones una vez por cada producto del almacén. Se mantienen los lotes, los precios históricos, las devoluciones por precio y la compatibilidad con devoluciones antiguas registradas por nombre.
- **Notificaciones:** varias actualizaciones de Firebase recibidas antes del siguiente fotograma se dibujan juntas. La navegación a una sección sigue siendo inmediata.
- **Iconos:** se convierten sólo los iconos nuevos y una vez por fotograma. Los SVG que ya existen no se vuelven a crear.
- **Recursos:** Tailwind y Lucide se incluyen compilados y con versiones fijas. El navegador no vuelve a generar todo el CSS al abrir la tienda.

Las etiquetas del formulario indican costo y venta por **unidad** o por **paquete** según la casilla de venta por paquetes. La tarjeta identifica el precio del paquete con `/paq.`. No se modificaron los valores guardados ni la fórmula de precios.

## Comparación reproducible

Prueba de CPU y DOM ejecutada en Node.js con JSDOM, datos ficticios y sin llamadas a Firebase. Los tiempos cambian según el equipo; no representan el tiempo de carga por Internet ni una medición en un teléfono real.

| Escenario | Original | Actualización |
| --- | ---: | ---: |
| Lecturas de `items` al consultar envases de 300 productos y 12 000 ventas | 7 200 000 | 24 000 |
| Tiempo de consulta de esos envases | 657,19 ms | 21,80 ms |
| Total de envases pendientes calculado | 12 000 | 12 000 |
| Doce toques de carrito con 100 tarjetas visibles | 451,46 ms | 43,52 ms |
| Tarjetas ajenas al producto tocado conservadas | 0 de 99 | 99 de 99 |

Para repetir la comparación, conserva el `index.html` del ZIP original de Sulmi, instala las dependencias de esta actualización y ejecuta desde su carpeta:

```sh
npm ci
node scripts/benchmark-render.mjs /ruta/al/index-original.html
```

El script crea 300 productos con 100 unidades de stock, 12 000 ventas de una unidad y un envase cada una, y después prueba doce incrementos de carrito con 100 productos visibles. Imprime los resultados de ambas versiones; no guarda ventas reales ni se conecta a la base de datos.

## Comprobaciones de interfaz

```sh
node --test tests/render.test.mjs
```

Nueve pruebas verifican actualización de stock y tarjetas, filtros, etiquetas de paquetes, agrupación de notificaciones, Lucide real y compatibilidad de lotes de envases. También comprueban que una edición puede recuperar las cantidades de la venta original sin modificar el stock físico antes de guardar, y que un nuevo inventario recibido se respeta aunque el carrito conserve los precios históricos.

Estas pruebas comprueban el DOM y los cálculos; la visualización en dispositivos físicos debe verificarse con la versión desplegada.
