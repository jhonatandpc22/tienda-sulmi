# Tienda Sulmi · actualización de rendimiento

Conserva la tienda original y su proyecto Firebase `licoreria-sul`. Consulta **INICIAR_AQUI.md** para subirla a GitHub y Vercel.

## Cambios

- Datos del equipo disponibles al abrir; conexión de Firebase en segundo plano.
- Guardado durable por documento y cola de operaciones que se recupera al cerrar y volver a abrir.
- Reintentos con identificadores persistentes: una respuesta perdida no vuelve a descontar stock.
- Actualizaciones del servidor por cambios de documentos, sin volver a guardar todo el historial.
- Catálogo y envases con menos recorridos; se conservan las tarjetas que no cambiaron.
- CSS e íconos compilados dentro del proyecto; versiones fijas.
- Edición de ventas, impresiones y detalles compensa las cantidades anteriores en el mismo lote que guarda el reemplazo. Cancelar el formulario no altera inventario ni historial.
- Protección contra doble toque durante el guardado y conservación del carrito cuando falla IndexedDB.
- Etiquetas de costo y venta por unidad o por paquete y ajuste de altura para pantallas pequeñas.

Se mantienen ventas, consumo interno, crédito, pago dividido, ventas marcadas, filtros, ingreso de stock, envases, servicios, detalles, análisis, reporte SUNAT, vendedores y respaldos. No se incorporó un bloqueo por suscripción ni se cambió el acceso anónimo de esta tienda.

## Desarrollo y pruebas

```sh
npm ci
npm test
npm run build
npm run dev
```

Para la prueba aislada con Firebase:

```sh
npm run test:firebase
```

Requiere Java 17 o superior y puertos 8080/9099 libres. El ejecutor utiliza exclusivamente el proyecto de demostración `demo-sulmi` y sus emuladores. Puede instalar Firebase CLI para ejecutar esta comprobación; no cambia la configuración de la tienda real.

La comparación de rendimiento y sus límites están en `docs/RENDIMIENTO.md`. `docs/VALIDACION.md` enumera la verificación de esta entrega.

## Actualizaciones

Se incluyen `assets` compilados para abrir el sitio servido localmente; Vercel vuelve a generarlos mediante el comando de compilación. Sube también las carpetas `scripts` y `tests` y los archivos de configuración. `node_modules` y `dist` se generan localmente y están excluidos del repositorio.
