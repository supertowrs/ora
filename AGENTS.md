# Ora — Instrucciones para agentes

## Cómo trabajar

- Actúa como un ingeniero senior: sé conciso, directo y enfocado en terminar la tarea.
- Prefiere la solución más pequeña, explícita y mantenible. Evita abstracciones, capas y dependencias que no resuelvan una necesidad concreta.
- Comunica en español. Conserva los cambios ajenos y limita cada modificación al alcance solicitado.
- Usa `rtk` como prefijo de los comandos de terminal; `rtk proxy` ejecuta sin filtrar la salida.
- No uses OpenSpec. No crees procesos de aprobación adicionales; respeta la autorización del usuario para cada tarea, incluido el destino de los commits.

## Producto y alcance

Registro horario para una empresa con dos tiendas, hasta diez empleados y administración desde escritorio. Los trabajadores fichan desde su móvil, conservan la sesión y pueden alternar tiendas. La interfaz debe ser muy sencilla: texto claro, botones grandes y pocas decisiones.

El presupuesto de alojamiento y base de datos es **0 €**. Mantén Vercel y Convex; no actives planes de pago, cobro por uso, dominios, SMS, correo ni servicios adicionales sin una nueva instrucción explícita. No añadas nóminas, planificación de turnos, geolocalización, biometría o una arquitectura para múltiples empresas al alcance actual.

Lee primero [README.md](README.md) para conocer el producto, ejecutar la aplicación y configurar un despliegue. Para recuperación, consulta [docs/RECUPERACION.md](docs/RECUPERACION.md).

## Arquitectura

React + TypeScript + Vite, CSS propio y Convex Auth con usuario y contraseña. Vercel sirve una SPA estática; Convex ejecuta las funciones y almacena los datos en la región elegida para el despliegue. No hay Next.js ni un servidor propio.

| Ruta                                                                  | Responsabilidad                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`, `src/main.tsx`                                         | Acceso, sesión y selección de interfaz por rol.                                                              |
| `src/Worker.tsx`                                                      | Fichaje móvil, historial propio y avisos.                                                                    |
| `src/Admin.tsx`, `Employees.tsx`, `Records.tsx`, `Reports.tsx`        | Panel administrativo, personas, registros e informes. Los cuatro archivos están en `src/`.                   |
| `src/components/`, `src/styles.css`                                   | Elementos compartidos, documento imprimible y estilos.                                                       |
| `convex/schema.ts`, `convex/lib.ts`                                   | Modelo de datos, autorización y reglas comunes.                                                              |
| `convex/app.ts`, `admin.ts`, `accounts.ts`, `reports.ts`, `backup.ts` | API del trabajador, administración, cuentas, informes y recuperación. Los cinco archivos están en `convex/`. |
| `shared/time.ts`, `reports.ts`, `backup.ts`                           | Horas, CSV y cifrado, compartidos entre interfaz y backend. Los tres archivos están en `shared/`.            |
| `shared/restore-drill.mts`, `shared/capacity.mts`                     | Ensayo de restauración aislada y estimación sintética de capacidad.                                          |

Antes de editar código Convex, lee `convex/_generated/ai/guidelines.md` y las funciones que consumen los datos afectados. Los tipos y referencias de `convex/_generated/` se regeneran con Convex; no los edites manualmente. Mantén los argumentos y retornos validados y los permisos en el backend.

## Preparación y comandos

Node.js **24** y npm; conserva `package-lock.json` como fuente de versiones instaladas. En una copia nueva:

```sh
rtk proxy npm ci
rtk proxy cp .env.example .env.local
```

El segundo comando es solo para una instalación sin `.env.local`; nunca sobrescribas una configuración existente. Completa `CONVEX_DEPLOYMENT` y `VITE_CONVEX_URL` con el despliegue elegido. Las variables `VITE_` se publican en el navegador: nunca contienen secretos. La compilación exige `VITE_CONVEX_URL`.

```sh
rtk proxy npm run dev             # Interfaz en http://127.0.0.1:5173
rtk proxy npm run dev:backend     # Sincroniza funciones con Convex; modifica el despliegue
rtk proxy npm run typecheck
rtk proxy npm test
rtk proxy npm run build
rtk proxy npm run check           # Tipos, pruebas y compilación
```

`npm run setup:dev-auth` prepara autenticación de desarrollo y puede modificar variables remotas. Consúltalo en el README antes de usarlo; no regeneres claves ni cuentas existentes por rutina. Para formatear cambios pequeños, ejecuta Prettier solo sobre los archivos modificados.

## Entornos y datos

- Identifica y anuncia el despliegue efectivo antes de ejecutar `dev`, `deploy`, mutaciones, importaciones o cambios de variables. Contrasta `.env.local`, variables del proceso y opciones de la CLI.
- Verifica qué backend usa cada instalación; el alias de producción de Vercel no determina el entorno de Convex. El destino permitido para la publicación se comprueba en `scripts/deploy-vercel.mjs`.
- Los pushes a `main` del repositorio conectado a Vercel despliegan automáticamente frontend y backend desde Vercel, después de ejecutar `npm run check`. `scripts/deploy-vercel.mjs` verifica rama, entorno y clave; las demás ramas no se despliegan. Un push a `main` es también una operación sobre el backend actual. No añadas un segundo despliegue paralelo en GitHub Actions ni uses la clave de este backend en previews.
- **Un despliegue etiquetado como desarrollo puede contener datos reales.** No lo uses como base desechable, no insertes fixtures ni ejecutes restauraciones sobre él sin que la tarea lo autorice.
- Crea cuentas de prueba solo en entornos aislados y no reutilices credenciales de otras instalaciones.
- Las restauraciones se hacen en un destino vacío y aislado. No sobrescribas el registro operativo ni copies datos reales a previews para probar cambios.
- No incluyas secretos, contraseñas, exportaciones o datos laborales en Git, logs o despliegues. Respeta `.gitignore` y `.vercelignore`; `.local/`, `.env.local`, `.vercel/`, `.playwright-cli/` y `output/` son privados o generados.
- Antes de hacer commit, revisa el diff preparado y el destino del push. No fuerces `main`, no sobrescribas historia ajena y no despliegues por el mero hecho de editar documentación.

## Reglas que deben conservarse

- La identidad procede de la sesión validada por el servidor. Cada trabajador solo consulta sus datos; revocar o desactivar el acceso debe invalidar también las sesiones que ya estaban abiertas.
- Los fichajes manuales usan la hora del servidor, con precisión de segundos enteros. El horario automático usa los instantes programados en `Europe/Madrid`, calculados y ejecutados por el backend. Guarda instantes UTC en milisegundos; reutiliza `shared/time.ts` para cambios de día, mes y horario de verano.
- Solo puede haber un tramo abierto por persona. Evita solapamientos y duplicados; conserva las operaciones idempotentes. Cambiar de tienda cierra y abre en el mismo instante.
- No hay cola de fichajes offline. `app:clock` se llama como acción mediante HTTP para evitar reenvíos automáticos de mutaciones al reconectar. Ante una respuesta incierta se consulta la operación; nunca se da por guardada sin confirmación ni se reenvía como una nueva entrada.
- Las horas pactadas siguen siendo una referencia independiente. Solo un horario semanal habilitado expresamente genera entradas y salidas. Un periodo terminado no impide cerrar un tramo que seguía abierto.
- Los tramos creados por un horario conservan exactamente el esquema y el origen `clock` del fichaje manual. El control del horario, la idempotencia y el vínculo con la salida se guardan en tablas separadas; las pantallas, informes y CSV no añaden una marca de automatización.
- Cambiar o desactivar un horario no recalcula registros anteriores. Una salida pendiente solo puede cerrar su tramo vinculado si sigue intacto; respeta las intervenciones manuales, las correcciones y las anulaciones.
- Una corrección conserva valores anteriores, valores nuevos, autor y motivo, y sigue siendo visible al trabajador, incluso si mueve un registro a otro mes.
- Los informes emitidos son versiones congeladas. Una corrección posterior requiere otra versión; no recalcules el informe antiguo. El desglose de horas se revisa explícitamente y la entrega registra su fecha y medio reales.
- No borres registros laborales por rutina ni al desactivar una cuenta. Conserva el historial y el plazo de conservación de cuatro años previsto para los registros; una limpieza de datos ficticios no es una función de borrado general.
- Las copias manuales son cifradas, se guardan fuera de la app y excluyen contraseñas y sesiones. Poder exportar no demuestra poder recuperar: conserva el ensayo de restauración y la comprobación de relaciones e informes.

## Validación y entrega

Ejecuta las pruebas pertinentes al cambio. `npm run check` es la comprobación conjunta; no necesita acceder a Convex real. En CI se usa una URL ficticia para compilar. Para cambios solo documentales, basta revisar contenido, rutas y diff.

Las pruebas de horas, permisos, concurrencia, correcciones e informes deben comprobar comportamiento significativo. Los cambios de copias requieren verificar cifrado y recuperación. Para cambios de interfaz, prueba el flujo afectado en escritorio y tamaño móvil; una simulación de móvil no acredita Safari ni un teléfono físico. Recarga cuando haya que demostrar persistencia.

Al entregar, distingue revisión de código, pruebas automatizadas, navegador real, CI y despliegue. Indica lo comprobado y cualquier limitación material; no presentes una prueba histórica ni una estimación de capacidad como una verificación actual.
