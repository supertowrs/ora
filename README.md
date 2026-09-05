# Ora

Registro de jornada para una empresa con dos tiendas. Web móvil para fichar y panel de administración para personas, periodos laborales, correcciones, informes y copias.

React + TypeScript + Vite, Convex con datos en Irlanda y alojamiento estático en Vercel. No necesita servidores propios, correo, SMS ni servicios de documentos.

Web: **https://ora-one-rho.vercel.app**. Usa el alias público de Vercel y el despliegue **de desarrollo** de Convex `accurate-bass-175`. Los trabajadores ficticios se eliminaron después de las pruebas iniciales; este backend puede contener ya cuentas y datos reales. Las credenciales de administración están en `.local/acceso-inicial.txt`; no forman parte del repositorio. Estado y pruebas iniciales: [VERIFICACION.md](VERIFICACION.md).

## Desarrollo

Node.js 24 y npm. Las versiones exactas están fijadas en `package-lock.json`.

```sh
npm ci
cp .env.example .env.local
```

Configurar el despliegue personal de **desarrollo** en `.env.local`. La variable `VITE_CONVEX_URL` es la URL pública del backend; las claves privadas de Convex y de autenticación nunca llevan el prefijo `VITE_`.

```sh
npm run setup:dev-auth
npm run dev:backend
```

En otra terminal:

```sh
npm run dev
```

La interfaz se abre en `http://127.0.0.1:5173`. `setup:dev-auth` conserva las claves si ya existen y se niega a actuar sobre un entorno de producción. `ORA_SITE_URL` permite indicar el origen de la interfaz si cambia.

```sh
npm run check
```

Comprueba TypeScript, reglas de horas, permisos y operaciones del backend y compilación. No necesita acceder al despliegue ni credenciales; el backend de estas pruebas es el simulador oficial `convex-test`. La comprobación de navegador contra Convex real se documenta por separado en `VERIFICACION.md`.

## Primera configuración

La primera administradora se crea mediante la función interna `accounts:bootstrap`, accesible con las credenciales técnicas del proyecto. Requiere nombre, usuario y contraseña de al menos 14 caracteres y solo funciona sobre una instalación sin empleados. No hay registro público.

Desde administración:

1. Completar nombre fiscal, NIF y nombres de ambas tiendas.
2. Crear las cuentas individuales y sus periodos de actividad, con jornada pactada y vigencia. Ayudar a cada persona a entrar una vez en su móvil.
3. Añadir un acceso directo a la pantalla de inicio. La sesión se conserva; cerrar sesión exige volver a introducir las credenciales.
4. Al acabar una campaña, cerrar el periodo laboral. La persona conserva acceso a sus horas. Desactivar la cuenta impide también consultar; reservarlo para retirada de acceso.

Las credenciales iniciales de esta instalación, si se ha inicializado mediante la preparación asistida, se entregan en `.local/acceso-inicial.txt`, excluido de Git y del despliegue. Guardarlas en el gestor de contraseñas de la empresa y retirar ese archivo cuando ya no haga falta.

## Uso diario

La persona pulsa **Entrar a trabajar** y elige la tienda. Para terminar pulsa **Salir del trabajo**. En una jornada partida registra ambos tramos. **Cambiar de tienda** conserva la continuidad del trabajo. La aplicación no descuenta pausas automáticamente.

Un fichaje solo queda confirmado cuando responde el servidor. Ante pérdida de conexión, anotar la hora real y avisar a la encargada. No hay fichajes offline. Las correcciones requieren motivo, conservan los datos anteriores y se muestran también al empleado.

La administradora revisa las incidencias y los tramos abiertos, emite el resumen de un mes terminado y comprueba con gestoría el desglose de horas. Los informes emitidos conservan su versión; una rectificación posterior requiere emitir otra. CSV e impresión permiten descargar los documentos sin contratar un servicio. Registrar una entrega exige indicar cuándo y por qué medio se realizó.

En **Registros → Descargar CSV** se descargan los tramos del mes, empleado y tienda seleccionados, también durante el mes en curso. El archivo se abre sin contraseña e incluye entradas y salidas con segundos, duración del tramo, estado y origen. Los tramos abiertos tienen la duración vacía y los anulados se identifican expresamente. Si un tramo cruza de mes, conserva sus fechas y duración completas: esta descarga muestra los registros actuales, no un total mensual ni una versión emitida del informe.

## Copias y recuperación

Cada semana descargar la copia cifrada desde Informes y guardarla fuera de la aplicación, junto con una contraseña de recuperación conservada por separado. El archivo contiene datos laborales, correcciones e informes; no contraseñas ni sesiones. El indicador de última copia acredita su generación, no que el archivo siga disponible en el destino externo.

La restauración se realiza en un despliegue vacío y aislado mediante las funciones internas de `convex/backup.ts`. Después se recupera el acceso administrador con `accounts:recoverAdmin` y se asignan nuevas credenciales al resto. Nunca usar una restauración como método para sobrescribir silenciosamente el registro en funcionamiento. El procedimiento está en [docs/RECUPERACION.md](docs/RECUPERACION.md) y la prueba realizada en [VERIFICACION.md](VERIFICACION.md).

Una copia semanal deja un intervalo de posible pérdida de hasta siete días. Conservar también los informes emitidos y revisar periódicamente que las copias se pueden abrir.

## Alojamiento

El proyecto Vercel `ora` está conectado al repositorio privado `supertowrs/ora`. Cada push a **`main`** inicia automáticamente el despliegue mediante `scripts/deploy-vercel.mjs`:

1. Verifica que la ejecución corresponde a Vercel Production, a `main` y a la clave del backend `dev:accurate-bass-175`.
2. Convex inyecta `VITE_CONVEX_URL` y ejecuta `npm run check`: tipos, pruebas y compilación estática.
3. Si esas comprobaciones pasan, publica las funciones e índices de Convex. Después Vercel publica `dist` en la URL habitual.

`CONVEX_DEPLOY_KEY` es un secreto de Vercel disponible solo en **Production**. No se guarda en Git ni se necesita en GitHub Actions. Las demás ramas no generan despliegues automáticos ni modifican este backend. GitHub Actions ejecuta además su comprobación independiente; la publicación usa las pruebas ejecutadas dentro de Vercel como requisito.

La automatización conserva el backend y sus datos actuales. Sigue etiquetado como desarrollo en Convex; migrar a otro despliegue requiere preparar datos y autenticación, cambiar el secreto y actualizar la comprobación de destino del script. No basta con cambiar la URL de la interfaz.

`vercel.json` también configura rutas de la SPA y cabeceras de seguridad. Para desarrollar o compilar localmente, utiliza los comandos de la sección Desarrollo. No ejecutes el script de despliegue para una comprobación local. La integración sigue el [procedimiento de Convex para Vercel](https://docs.convex.dev/production/hosting/vercel).

Un rollback de Vercel restaura la interfaz, no las funciones ni los datos de Convex. Mantén compatibles los cambios entre frontend y backend; para revertir código de ambos, revierte el commit y publica el resultado en `main`.

No activar planes de pago, cobro por uso, dominios ni complementos. Revisar el consumo en ambos proveedores. El objetivo de cero euros depende de sus límites y condiciones actuales; la decisión y su salvedad de Vercel Hobby están recogidas en `PLAN_IMPLEMENTACION.md`.

## Antes de usarla como registro laboral

Completar datos fiscales, reglas de pausas y clasificación de horas con la gestoría; informar a las personas sobre el procedimiento y el tratamiento de sus datos; revisar el convenio y la normativa vigentes. Conservar registros accesibles durante cuatro años y revisar después qué datos siguen sujetos a conservación. No hay borrado automático ni una promesa de inmutabilidad frente al propietario técnico de la base de datos.

Probar el acceso en los móviles que se usarán y realizar un piloto con la administradora y dos personas antes de dar por aceptado el proceso.
