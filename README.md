# Ora

Aplicación de registro horario para una empresa con dos tiendas. Los empleados fichan desde el móvil y administración gestiona personas, registros e informes desde el escritorio.

Construida con React, TypeScript y Vite, con Convex como backend y base de datos, Convex Auth para acceso con usuario y contraseña y Vercel para alojar la interfaz estática.

## Funcionalidades

- Entradas, salidas y cambios de tienda, con historial individual e incidencias.
- Gestión de empleados, acceso y periodos laborales con horas pactadas.
- Horarios semanales opcionales por empleado, con jornadas partidas y fechas excluidas.
- Correcciones con motivo, autor y valores anteriores, visibles para el trabajador.
- Informes mensuales versionados, impresión y descarga de registros en CSV.
- Copias manuales cifradas y ensayo de restauración en un entorno aislado.

Las horas se muestran en `Europe/Madrid`. La aplicación está diseñada para una sola empresa; no incluye nóminas, geolocalización ni fichajes offline.

## Desarrollo local

Requiere Node.js **24**, npm y un despliegue propio de desarrollo en Convex.

```sh
npm ci
cp .env.example .env.local
```

Copia el archivo de ejemplo solo si no tienes `.env.local`. Configura `CONVEX_DEPLOYMENT` y `VITE_CONVEX_URL` con los valores de tu despliegue. Las variables `VITE_` son públicas en el navegador: nunca deben contener secretos.

Prepara la autenticación y sincroniza el backend:

```sh
npm run setup:dev-auth
npm run dev:backend
```

Estos comandos modifican el despliegue seleccionado. Usa un entorno aislado para desarrollar: un backend etiquetado como desarrollo también puede contener datos reales. `setup:dev-auth` conserva las claves existentes, genera ambas si no existen y configura `SITE_URL`; exige un destino de desarrollo y rechaza una clave de despliegue en el entorno. `ORA_SITE_URL` permite indicar otro origen para la interfaz.

En otra terminal, inicia la interfaz:

```sh
npm run dev
```

Abre `http://127.0.0.1:5173`.

## Comprobaciones

```sh
npm run typecheck  # TypeScript
npm test           # Pruebas automatizadas
npm run build      # Compilación de producción
npm run check      # Tipos, pruebas y compilación
```

La compilación requiere `VITE_CONVEX_URL`. Las pruebas usan `convex-test` y no necesitan acceder al servicio real. CI compila con una URL ficticia. Para validar una instalación, comprueba también los flujos contra su backend y en los navegadores y dispositivos que se utilizarán.

## Primera configuración

La función interna `accounts:bootstrap` crea la primera cuenta administradora, la empresa y dos tiendas iniciales. Requiere acceso técnico al despliegue, nombre, usuario y contraseña de al menos 14 caracteres. Solo funciona si no hay empleados; no existe registro público. Conserva las credenciales en un gestor de contraseñas.

Desde administración:

1. Completa los datos de la empresa y los nombres de las dos tiendas.
2. Crea las cuentas individuales y sus periodos laborales, con jornada pactada y vigencia.
3. Comprueba el acceso de cada persona desde su móvil. Puede añadir la web a la pantalla de inicio.
4. Configura un horario semanal solo para quienes deban tener fichajes automáticos.

Cerrar un periodo laboral conserva el acceso al historial. Desactivar una cuenta revoca también sus sesiones abiertas, sin borrar sus registros.

## Uso

Para fichar, pulsa **Entrar a trabajar** y elige tienda. **Salir del trabajo** cierra el tramo; **Cambiar de tienda** cierra y abre en el mismo instante. Registra por separado los tramos de una jornada partida: no se descuentan pausas automáticamente.

Un fichaje solo queda confirmado cuando responde el servidor. Ante pérdida de conexión, anota la hora real y comunica la incidencia para corregirla con motivo. No hay cola de fichajes offline.

Los horarios semanales se habilitan en **Empleados → ficha de la persona → Fichaje automático**. Admiten hasta seis tramos diarios, salidas al día siguiente y fechas excluidas. Son independientes de las horas pactadas y no rellenan el pasado. El backend procesa los eventos cada minuto con la hora programada; una interrupción puede retrasar su aparición. Editar o desactivar un horario no recalcula registros anteriores y respeta las intervenciones manuales. Los horarios restaurados permanecen en pausa hasta guardarlos expresamente.

Administración revisa incidencias, corrige registros y emite informes de meses terminados. Cada informe conserva su versión; una corrección posterior requiere emitir otra. **Registros → Descargar CSV** exporta los tramos actuales según los filtros, incluidos abiertos y anulados; no sustituye al informe mensual emitido. La entrega de un informe se registra con su fecha y medio reales.

## Copias y recuperación

Descarga periódicamente una copia cifrada desde **Informes** y guárdala fuera de la aplicación, con la contraseña por separado. Incluye datos laborales e informes, pero no contraseñas ni sesiones. El indicador de última copia acredita su generación, no que el archivo siga disponible.

La recuperación requiere un destino vacío y aislado y nuevas credenciales de acceso. Consulta el [procedimiento de recuperación](docs/RECUPERACION.md), incluido el ensayo local que comprueba datos y relaciones. Una copia semanal deja un intervalo de posible pérdida de hasta siete días.

## Despliegue en Vercel

`vercel.json` configura la SPA, las cabeceras de seguridad y el despliegue desde `main`. El script [deploy-vercel.mjs](scripts/deploy-vercel.mjs) publica tanto el backend como la interfaz y comprueba la rama, el entorno de Vercel y el destino de Convex.

Para una instalación propia, adapta el destino permitido en ese script y configura `CONVEX_DEPLOY_KEY` como secreto exclusivo del entorno **Production** de Vercel. Prepara la autenticación del backend y su `SITE_URL` para el origen público de la interfaz. Nunca compartas la clave con previews ni la guardes en Git.

Con la integración de Git activada, un push a `main` inicia la publicación. Convex inyecta `VITE_CONVEX_URL` y ejecuta `npm run check` antes de publicar las funciones; después Vercel publica `dist`. Las demás ramas tienen el despliegue automático deshabilitado. Cambiar únicamente la URL de la interfaz no migra los datos ni la autenticación.

Un rollback de Vercel restaura la interfaz, no el backend ni los datos. Conserva la compatibilidad entre ambos al desplegar cambios. Verifica los límites y condiciones de los planes elegidos antes de operar una instalación.

## Estructura

| Directorio | Contenido                                                               |
| ---------- | ----------------------------------------------------------------------- |
| `src/`     | Interfaz de trabajadores y administración, componentes y estilos.       |
| `convex/`  | Modelo de datos, autenticación, permisos y funciones del backend.       |
| `shared/`  | Cálculo de horas, CSV, cifrado, pruebas y herramientas de recuperación. |
| `scripts/` | Preparación de autenticación y publicación en Vercel.                   |
| `docs/`    | Documentación de recuperación.                                          |

Las instrucciones para trabajar sobre el código están en [AGENTS.md](AGENTS.md). Mantén credenciales, exportaciones y datos laborales fuera del repositorio y de los logs; `.gitignore` y `.vercelignore` excluyen los archivos locales y generados.
