# Actualizar Tienda Sulmi

1. Sube todo el contenido de este ZIP a la raíz del repositorio de Sulmi, reemplazando los archivos anteriores. Incluye `assets`, `scripts`, `package.json` y `package-lock.json`.
2. En Vercel utiliza **Other**, comando `npm run build`, salida `dist` y Node **22.x**. `vercel.json` ya incluye el comando y la carpeta.
3. Firebase sigue siendo **licoreria-sul**, el proyecto original. Conserva **Authentication → Anónimo** habilitado. No hay que crear cuentas nuevas.
4. Se incluye `firestore.rules` para las cinco colecciones existentes. Si las reglas actuales ya permiten estas operaciones, puedes conservarlas; los recibos de sincronización se escriben dentro de `pos_config`.
5. Cuando Vercel termine, recarga la aplicación. La caché del sitio se actualiza por versión. Conserva los datos del navegador para que los movimientos pendientes puedan sincronizarse.

## En la laptop

Abre la dirección de Vercel normalmente o instala la aplicación desde el navegador. Para ejecutar los archivos localmente usa Node 22, `npm ci`, `npm run build` y `npm run dev`; abre `http://localhost:4175`. Esto permite el guardado local y la PWA. Abrir el HTML con doble clic puede limitar estas funciones del navegador.

## Guardado

Las operaciones se confirman después de guardarse en IndexedDB en el equipo. Firebase se actualiza en segundo plano. Un indicador muestra los cambios pendientes y permite reintentar si hay un problema de conexión. Una operación reenviada conserva su identificador para no repetir el descuento de stock.

La primera carga de un equipo nuevo debe descargar sus datos; su duración depende de la conexión y del historial. Después utiliza los datos locales. Se conservan ventas, consumos, créditos, pagos divididos, marcados, servicios, detalles, envases, almacén, análisis, reporte SUNAT y respaldos.

Se usan Authentication y Firestore. Esta actualización no incorpora Functions, pagos automáticos ni servicios que requieran activar facturación. El uso está sujeto a las cuotas de tu proyecto Firebase.
