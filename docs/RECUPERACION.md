# Recuperación de Ora

La copia descargada desde **Informes → Copia de seguridad** está cifrada en el navegador con AES-256-GCM. La clave se deriva con PBKDF2-SHA256 y 600.000 iteraciones; cada archivo tiene sal e IV aleatorios. Su contraseña se guarda fuera de Ora. No se envía a Convex y no se puede recuperar desde la aplicación.

La copia incluye empresa, tiendas, empleados, periodos laborales, modificaciones de esos periodos, tramos, rectificaciones, incidencias e informes emitidos. No incluye contraseñas, sesiones, tokens ni el historial técnico de reintentos. Los accesos se crean de nuevo después de restaurar.

## Copia semanal

1. Desde un ordenador de la empresa, generar la copia y elegir una contraseña de al menos 12 caracteres.
2. Confirmar que el archivo se ha descargado y moverlo al destino externo de la empresa. Guardar la contraseña por separado.
3. Conservar también los informes mensuales emitidos y entregar su resumen con la nómina por el canal establecido.

Durante la lectura se bloquean brevemente los cambios para obtener una copia coherente entre tablas; conviene hacerla fuera de las horas de entrada y salida. El bloqueo se libera al terminar o cancelar. Si se cierra el navegador, una tarea de Convex lo libera a los diez minutos. Ora registra que se ha generado la copia; no acredita que el archivo se haya guardado correctamente en el destino externo.

El intervalo semanal implica una posible pérdida de hasta siete días ante una pérdida completa del servicio. Si falla la conexión o Convex durante un fichaje, anotar la hora real y corregir después dejando el motivo.

## Ensayo en un Convex local vacío

El script [restore-drill.mts](../shared/restore-drill.mts) admite exclusivamente HTTP en `127.0.0.1`, `localhost` o `::1`. El backend rechaza restaurar si el destino ya contiene empresa, tiendas, empleados u otros datos funcionales. No borra ni sustituye registros existentes.

Preparar una copia separada del código y un Convex local vacío en `.local/restore-workspace`. Mantener en ejecución su proceso de desarrollo y desplegar allí el mismo esquema y funciones. Esto se hace desde ese directorio aislado; no se cambian las variables del proyecto principal ni su despliegue europeo.

La CLI local guarda su configuración en `.local/restore-workspace/.convex/local/default/config.json`. Contiene `ports.cloud` y `adminKey`; la clave se lee directamente en memoria y nunca se imprime, pega en comandos ni copia a documentación.

Con `ORA_BACKUP_PASSWORD` disponible en el entorno mediante el gestor de credenciales, ejecutar desde la raíz de Ora este ejemplo, ajustando únicamente la ruta del archivo cifrado:

```sh
rtk proxy node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('.local/restore-workspace/.convex/local/default/config.json', 'utf8'));
if (!config.adminKey || !Number.isInteger(config.ports?.cloud)) throw new Error('Configuración local incompleta.');
if (!process.env.ORA_BACKUP_PASSWORD) throw new Error('Falta la contraseña de la copia en el entorno.');
const result = spawnSync(process.execPath, [
  'shared/restore-drill.mts',
  '/ruta/segura/ora-copia.ora.json',
  `http://127.0.0.1:${config.ports.cloud}`,
], {
  stdio: 'inherit',
  env: { ...process.env, ORA_RESTORE_ADMIN_KEY: config.adminKey },
});
process.exit(result.status ?? 1);
NODE
```

El script descifra localmente, valida la versión, restaura por lotes y remapea las relaciones. Los informes se restauran de uno en uno para limitar las lecturas. Después compara todos los documentos, campo a campo, incluidos tramos, correcciones, jornadas e informes históricos. Los identificadores internos y las fechas técnicas de creación se contrastan mediante la tabla de correspondencias; las horas efectivas y el contenido original se conservan.

Si se interrumpe, el script muestra un `restoreId`. Añadirlo como cuarto elemento de la lista de argumentos, después de la URL, permite reanudar a partir del último lote confirmado. Una restauración incompleta mantiene el destino local en mantenimiento y no se debe dar por recuperada. La reanudación exige utilizar exactamente el mismo archivo.

La comprobación concluye con **«Ensayo completo: datos, rectificaciones, jornadas e informes coinciden»**. Un código de salida distinto de cero o una diferencia entre documentos significa que el ensayo ha fallado. Conservar el resultado técnico sin datos laborales ni secretos.

Para volver a dar acceso después de la verificación, la función interna `accounts:recoverAdmin` vincula una contraseña nueva a la ficha de una administradora restaurada. Después se recuperan los demás accesos de forma asistida. No se reutilizan tokens ni sesiones antiguas.

## Recuperación futura del servicio real

Este script es un ensayo local y rechaza direcciones remotas. Una recuperación del servicio real requiere seleccionar expresamente un nuevo despliegue europeo vacío, verificar región y plan gratuito, importar la misma copia con las funciones internas, comparar documentos y totales, recuperar las cuentas y cambiar la configuración de la web. La selección y publicación de ese nuevo destino son una operación separada; este procedimiento no modifica producción.

Las copias y la configuración local contienen información sensible aunque las copias estén cifradas. Mantenerlas fuera de Git, limitar el acceso y eliminar las copias de ensayo cuando termine su comprobación, conservando las copias externas que deban mantenerse.

Referencias técnicas: [exportación de Convex](https://docs.convex.dev/database/import-export/export), [límites por transacción](https://docs.convex.dev/production/state/limits), [derivación de claves Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).
