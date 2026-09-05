# Ora — Verificación de la primera versión

Fecha: 5 de septiembre de 2026.

## Estado

Aplicación implementada y publicada para pruebas en **https://ora-one-rho.vercel.app**. El frontend está en el alias de producción de Vercel; el backend y todos los datos corresponden al despliegue **de desarrollo** de Convex `accurate-bass-175`, en Irlanda. No se ha preparado un registro laboral de producción.

Vercel Hobby comprobado mediante su API. No se han contratado planes, dominios ni complementos de pago. El tamaño calculado es orientativo y no acredita el consumo facturado por Convex. Las condiciones y límites del presupuesto están recogidos en [el plan](PLAN_IMPLEMENTACION.md).

La empresa `Ora · Empresa de prueba`, su NIF y las personas usadas durante la validación son ficticios. El 5 de septiembre, tras las pruebas y a petición del propietario, se eliminaron `prueba.ana` y `prueba.api` junto con sus registros e informes. La cuenta administradora sigue disponible. Las credenciales de administración se entregan en `.local/acceso-inicial.txt`, excluido de Git y de Vercel.

## Comprobaciones automatizadas

`npm run check` completado: TypeScript, **35 pruebas en cinco archivos** y compilación de producción. Las pruebas cubren autorización, revocación de sesiones, fichajes simultáneos, reintentos, hora del servidor, cambios de tienda, periodos, correcciones, informes, cambios de mes y horario de Madrid, CSV y copias cifradas.

Los permisos y las transacciones de estas pruebas usan `convex-test`; no sustituyen las verificaciones contra el servicio real. Una ejecución HTTP adicional contra Convex de desarrollo superó **15 comprobaciones**, incluidas identificación real, rechazo del registro público, aislamiento entre trabajadores, peticiones caducadas, idempotencia y revocación inmediata. Evidencia local: `.local/api-verification.json`.

La compilación también se ha comprobado sin `VITE_CONVEX_URL`: se detiene con un error explícito. `npm audit` no detectó vulnerabilidades en las dependencias instaladas durante esta validación.

## Navegador y servicio reales

Probado con Playwright y Chromium, con administración de escritorio y una ventana móvil de 390 × 844. Las acciones se ejecutaron contra Convex real; después se recargaron pantallas y se contrastaron datos directamente por HTTP.

- Acceso administrador local y desde Vercel; conservación de sesión tras recargar.
- Alta asistida de una trabajadora y de su periodo de actividad. Fichaje bloqueado antes de disponer de periodo activo.
- Entrada en dos pulsaciones, cambio de tienda sin interrupción artificial y salida en una pulsación. Administración refleja el estado del trabajador.
- Desconexión: mensaje visible y botón deshabilitado; reconectar no crea un fichaje pendiente.
- Respuesta perdida después de que el servidor guarde la entrada: recuperación de la confirmación y persistencia tras recargar, sin duplicación. Repetido desde Vercel con el reloj del navegador adelantado seis horas; el registro conserva la hora del servidor.
- Corrección de un olvido y rectificación posterior de la hora de salida, ambas con motivo e historial visible al trabajador.
- Emisión del informe de agosto v1 con 4 horas; corrección y emisión de v2 con 4 horas y 30 minutos. La primera versión conserva sus 4 horas. Registro de fecha, hora y medio de entrega de la segunda.
- CSV descargado y valores comprobados. Vista de impresión convertida a un PDF real de una página A4 y revisada visualmente.
- Descarga de copia cifrada desde la interfaz y restauración completa en otro backend.
- Revocación desde administración: una sesión de trabajador que estaba abierta pierde el acceso inmediatamente.

La comprobación HTTP posterior confirma cuatro tramos cerrados de Ana en septiembre, la continuidad del cambio de tienda, ausencia de duplicados y dos correcciones y versiones del informe de agosto. Evidencia local: `.local/ui-verification.json`.

Artefactos locales, excluidos del repositorio y de la publicación:

- [Administración desde Vercel](output/playwright/vercel-administracion.png).
- [Móvil trabajando desde Vercel](output/playwright/vercel-movil-trabajando.png).
- [Móvil sin conexión](output/playwright/movil-sin-conexion.png).
- [Informe PDF](output/playwright/resumen-2026-08-v1.pdf) y [representación de su página](output/playwright/resumen-pdf-real.png).
- [CSV emitido](output/playwright/resumen-2026-08-v1.csv).

## Recuperación probada

Se descargó una copia cifrada desde el navegador, se descifró con su contraseña y se restauró en un backend Convex local vacío y aislado, mediante [el procedimiento de recuperación](docs/RECUPERACION.md). Se compararon todos los campos y las relaciones después de reasignar los identificadores.

| Datos de la copia de prueba | Restaurados y comparados |
| --- | ---: |
| Empresa | 1 |
| Tiendas | 2 |
| Personas | 3 |
| Periodos de actividad | 2 |
| Tramos de trabajo | 5 |
| Correcciones | 2 |
| Informes emitidos | 2 |

La copia se tomó antes de las últimas comprobaciones de pérdida de respuesta. No contenía incidencias ni cambios de periodo; la restauración de esas tablas con datos está cubierta en las pruebas automatizadas.

Se generaron nuevas claves de autenticación en el backend aislado, se recuperó una cuenta administradora y se asignó una nueva contraseña a la trabajadora. Ambas entraron y consultaron los datos restaurados. Los informes conservaron 14.400 y 16.200 segundos. Las contraseñas y sesiones originales no se exportaron ni restauraron.

Evidencias locales: `.local/restore-verification.txt` y `.local/recovery-access-verification.json`. La contraseña de la copia y las credenciales de recuperación permanecen en archivos privados separados.

## Capacidad estimada

`node shared/capacity.mts` genera datos sintéticos en memoria: diez empleados, tres tramos y seis operaciones diarias durante todos los días de cuatro años, con correcciones e informes versionados. No inserta esa carga en Convex.

| Medida del escenario sintético | Resultado |
| --- | ---: |
| Documentos serializados en JSON, incluidas operaciones | 51,24 MB |
| Contenido de la copia funcional antes de cifrar | 29,24 MB |
| Descarga cifrada, incluido base64 | 38,99 MB |
| Mayor documento JSON | 31.958 bytes |

MB decimales. La copia queda por debajo del límite de 64 MiB del cifrado de la aplicación. Estos tamaños **no miden el almacenamiento real de índices, la autenticación, el tráfico de suscripciones ni el consumo del proveedor**. El JSON completo y las hipótesis están en `.local/capacity.json`; revisar los paneles de consumo durante el piloto.

## Pendiente antes del uso laboral

Probar los teléfonos físicos que se utilizarán, incluidos Safari y la persistencia de sesión durante la campaña. La validación móvil realizada corresponde a Chromium de escritorio con dimensiones de móvil; no demuestra el comportamiento de todos los dispositivos.

Preparar un despliegue Convex separado con los datos fiscales y centros reales, cuentas individuales y periodos correctos. Revisar con la gestoría el convenio, descansos, clasificación de horas, entrega de resúmenes y procedimiento de registro, además de la información de privacidad. La implementación y sus pruebas no constituyen una certificación jurídica.

Realizar un piloto con la administradora y dos personas. Guardar la copia semanal fuera de la aplicación y su contraseña por separado; comprobar periódicamente la recuperación. Ese calendario admite una posible pérdida de hasta siete días de datos si falla el servicio antes de la siguiente copia.

# Horario semanal por empleado — 5 de septiembre de 2026

Validación de la rama de horarios con datos ficticios, sin modificar el backend operativo ni publicar en Vercel:

- `npm run check`: TypeScript, 86 pruebas y compilación. Incluye 44 pruebas nuevas de horario: permisos, revisiones concurrentes, jornada partida, solapamientos entre días/tiendas, salidas manuales, correcciones, reintentos, interrupciones, cambios de hora y eventos vencidos al editar.
- Backend Convex real aislado en `127.0.0.1:3320`: primero se publicó la versión anterior y se crearon tres personas ficticias, un registro y un informe congelado de agosto. El esquema y las funciones nuevos se publicaron sobre esos datos, conservándolos.
- Navegador real: creación y guardado de un horario de doce tramos semanales, copia lunes a martes–viernes, tiendas diferentes y exclusión de fechas. Un solapamiento se rechazó en el servidor. Reabrir y recargar conservó todos los valores. Edición y guardado también comprobados a 390 × 844; el formulario no presenta desbordamiento horizontal. No se ha probado Safari ni un teléfono físico.
- Cron nativo, sin invocar manualmente la función de proceso: creó y cerró dos tramos el 5 de septiembre, 14:47–14:48 en Tienda 1 y 14:49–14:50 en Tienda 2 (`Europe/Madrid`). La API devolvió el esquema habitual de sesión y `source: clock`; el historial del trabajador mostró 0:02 h después de recargar, sin marcas adicionales ni errores de consola.
- Una persona sin horario completó entrada y salida mediante la acción HTTP existente. Repetir la entrada con el mismo identificador devolvió la misma sesión.
- Exportación cifrada de ese backend y ejecución real de `shared/restore-drill.mts` sobre otro destino vacío, `127.0.0.1:3330`: once tablas verificadas campo a campo con relaciones remapeadas; cuatro tramos, un informe congelado, un horario y dos ejecuciones. Las configuraciones restauradas quedan en pausa. Las pruebas automatizadas cubren además copias v1 antiguas y reanudación de restauraciones anteriores.

Estos resultados acreditan la implementación y los entornos locales descritos. La publicación del servicio operativo corresponde al proceso de integración en `main`.
