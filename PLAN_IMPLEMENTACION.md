# Ora — Plan de implementación

Fecha: 5 de septiembre de 2026. Estado: primera versión implementada y publicada para pruebas en Vercel, conectada a Convex de desarrollo en Irlanda y con datos ficticios. Las comprobaciones realizadas y los límites de la validación se recogen en [VERIFICACION.md](VERIFICACION.md).

## 1. Objetivo y decisiones

Aplicación de registro horario para una empresa con dos tiendas de figuras de belén en Sevilla, hasta diez trabajadores durante Navidad y una administradora. Los empleados pueden alternar entre tiendas y tienen jornadas contratadas diferentes.

Decisiones confirmadas por el usuario:

- Coste de servidores, alojamiento y base de datos: 0 €.
- Alojamiento en Vercel y backend/base de datos en Convex. El usuario desarrolla el proyecto personalmente y sin cobrar por ello.
- Administración desde escritorio; trabajadores desde su propio móvil con la sesión guardada.
- Interfaz sencilla para personas con poca experiencia digital.
- Si falla Internet, anotar la incidencia y corregir después con justificación.
- Copia semanal descargada desde un botón y guardada fuera de la aplicación.
- Preparar el plan antes de implementar. No utilizar OpenSpec.

Supuestos para acotar la primera versión:

- Una sola empresa empleadora y dos centros; no es un producto para múltiples empresas.
- Una administradora inicial. Se permite añadir otra cuenta administradora si hace falta recuperación o sustitución.
- Alta y recuperación de acceso asistidas por la administradora; los trabajadores no necesitan correo electrónico.
- Nóminas, contratos y llamamientos se gestionan con la gestoría fuera de Ora.
- El convenio y las reglas de descansos quedan pendientes de concreción. No bloquean el desarrollo del registro real.

## 2. Arquitectura elegida y coste

**React + TypeScript + Vite, Vercel y Convex Free en EU West (Irlanda).** El plan de alojamiento previsto es Hobby, con la salvedad sobre sus condiciones que se recoge a continuación.

| Componente | Elección | Motivo |
| --- | --- | --- |
| Interfaz | React, TypeScript y Vite | Una web privada y adaptable; compilación estática y poca configuración. |
| Alojamiento | Vercel, con Hobby como plan previsto | Publica la compilación estática de Vite y proporciona HTTPS y subdominio vercel.app. |
| Backend y base de datos | Convex Free | Funciones TypeScript, validación y operaciones transaccionales en el mismo servicio. |
| Identificación | Convex Auth, usuario y contraseña | Sesiones persistentes y cuentas individuales sin contratar SMS o correo. |
| Estilos | CSS sencillo con variables y componentes reutilizables pequeños | Tipografía grande, contraste y formularios nativos accesibles. |
| Informes | CSV y vista imprimible para guardar como PDF | Generación en el navegador; sin servicio de documentos. |
| Pruebas | Vitest, convex-test y Playwright | Lógica, permisos, persistencia y flujo real de navegador. |

No se necesita renderizado en servidor, SEO, un servidor Next.js ni un segundo backend. Si se prefiriese Next.js por familiaridad, podría evaluarse exportación estática; no aporta una necesidad funcional a esta versión.

Se adopta Vercel por elección explícita del usuario. Que el desarrollo se haga gratuitamente no confirma por sí solo la elegibilidad para Hobby: Vercel restringe ese plan al uso personal no comercial, y la aplicación se utilizará para gestionar trabajadores de un negocio. No se ha confirmado con Vercel que este caso esté admitido. Esta salvedad no cambia la elección técnica ni bloquea el desarrollo; impide presentar la compatibilidad contractual de Hobby como verificada. No se autoriza contratar Pro ni activar servicios de pago. Los términos de Convex contemplan el uso interno empresarial, sujeto a los límites del plan. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [criterios de uso comercial](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage), [términos de Convex](https://www.convex.dev/legal/tos).

Configurar Vercel con el preset Vite, compilación estática y salida dist. Añadir la reescritura de rutas de la SPA para que abrir o recargar enlaces internos funcione. El navegador accede directamente a Convex; los fichajes, permisos y datos se procesan allí. Separar variables de producción y preview y configurar las cabeceras de seguridad en Vercel. [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite).

### Límites y protección del presupuesto

- Seleccionar **Convex Free**, no Starter. Starter tiene cobro por exceso de consumo; Free tiene límites que pueden interrumpir el servicio.
- Recursos publicados de Convex Free: 0,5 GB de base de datos, 1 millón de llamadas al mes, 1 GB/mes de I/O de base de datos y 1 GB/mes de salida de datos. Incluyen el consumo del equipo de desarrollo, no solo el de producción.
- Vercel Hobby incluye hasta 1 millón de solicitudes Edge y 100 despliegues diarios. Este diseño sirve archivos estáticos; no necesita Vercel Functions para las operaciones de la app. Revisar también la transferencia disponible antes de publicar.
- Utilizar el subdominio gratuito; no comprar dominio, licencias, servicios de email, SMS ni almacenamiento adicional.
- Cuentas dedicadas a Ora para que otro proyecto no consuma sus cuotas. Mantener los planes gratuitos sin activar facturación por consumo.
- Revisar consumo al alcanzar el 50 % y actuar antes del 80 % mediante los paneles del proveedor. No desarrollar un panel propio de facturación.
- Consultas por empleado y periodo, paginadas e indexadas. No descargar cuatro años de registros al abrir la app. Desconectar las suscripciones que la pantalla no utilice.

Como escenario conservador, 10 empleados × 6 fichajes/día × 366 días × 4 años son 87.840 fichajes. A 1 KB por fichaje incluyendo una estimación de índices serían unos 88 MB, antes de informes, correcciones y autenticación. Es una estimación para dimensionar, no una medición del sistema. Se verificará el consumo real y el efecto de las copias con datos sintéticos antes de usar datos laborales.

**El objetivo es 0 € con los planes actuales y esta escala, sujeto a la elegibilidad de Hobby. No existe garantía de gratuidad o disponibilidad perpetuas.** Un límite del plan gratuito puede provocar una interrupción; la app nunca debe convertirla en un cobro automático ni fingir que ha guardado un fichaje. [Límites de Convex](https://docs.convex.dev/production/state/limits), [FAQ de precios](https://www.convex.dev/pricing/faq), [límites de Vercel Hobby](https://vercel.com/docs/plans/hobby).

## 3. Experiencia del trabajador

### Acceso inicial

La administradora crea la cuenta y ayuda al trabajador a entrar una vez con un usuario corto y una contraseña generada, suficientemente robusta. Se guarda la sesión y se añade un acceso directo a la pantalla de inicio del móvil. La instalación es opcional: siempre funciona como web.

No hay registro público, correo obligatorio, códigos SMS ni contraseña compartida entre trabajadores. No utilizar un PIN corto como única credencial de una página pública. La contraseña no vuelve a mostrarse en administración; puede sustituirse y revocar las sesiones del móvil perdido.

Objetivo de sesión del trabajador: cubrir una campaña, con renovación controlada y revocación inmediata desde el servidor. La duración exacta se verificará con la biblioteca de autenticación y Safari móvil. Las acciones administrativas sensibles requieren identificación reciente.

### Pantalla principal

Mostrar únicamente nombre, estado, tienda del tramo abierto y acción principal:

- Sin tramo abierto: **ENTRAR A TRABAJAR**.
- Al pulsar entrar: dos botones grandes con los nombres reales de las tiendas. Elegir una registra la entrada y muestra la hora confirmada.
- Con tramo abierto: **SALIR DEL TRABAJO**. La salida mantiene la tienda del tramo.
- Tras guardar: confirmación persistente y legible, por ejemplo «Entrada guardada · 09:02 · Tienda Centro».
- Accesos secundarios: «Mis horas» y «Hay un error».

La entrada requiere dos pulsaciones; la salida, una. No hay selectores de fecha ni hora en el fichaje normal, menús desplegables para elegir tienda, gestos ocultos o iconos sin texto.

Objetivos de usabilidad: botones de al menos 56 px, texto principal de 18 px o más, contraste suficiente, zoom permitido, manejo con una mano y mensajes breves en español. El color acompaña al texto; no transmite el estado por sí solo.

### Dos tiendas y jornadas partidas

- Se elige tienda en cada entrada para evitar arrastrar una asignación antigua.
- Para mañana y tarde, registrar entrada/salida en cada tramo.
- Si cambia de tienda durante trabajo continuo, ofrecer «Cambiar de tienda» en las acciones secundarias. La operación cierra un tramo y abre el siguiente en el mismo instante, sin introducir un descanso ficticio ni permitir dos tramos abiertos.
- Un desplazamiento que sea tiempo de trabajo no debe descontarse automáticamente. Su tratamiento se documentará con la tienda; la asignación a un centro no cambia el total trabajado.
- La tienda seleccionada es declarada por el empleado; no acredita ubicación física. Esta versión no solicita GPS, fotografía ni permisos de cámara.

### Errores y conexión

- Mientras se envía: «Guardando…» y bloquear pulsaciones repetidas.
- Solo mostrar éxito cuando el servidor confirme la operación.
- Si llega una respuesta incierta, comprobar el identificador de la operación antes de reintentar; no crear un segundo fichaje.
- Sin conexión: indicar que no se ha podido confirmar el fichaje y que avise a la encargada. No almacenar una cola de fichajes offline.
- Controlar el comportamiento de reintentos del SDK: una petición antigua no puede ejecutarse al reconectar como si fuese una entrada puntual nueva. Rechazar las peticiones demoradas y ofrecer corrección.
- «Hay un error» permite señalar el día y un motivo simple: «Olvidé entrar», «Olvidé salir», «No había Internet» u «Otro». La administradora recoge y registra la hora real.

## 4. Administración desde escritorio

Cuatro vistas, con navegación corta:

| Vista | Funciones |
| --- | --- |
| Hoy | Personas trabajando, tienda, última entrada y tramos pendientes de revisar. |
| Registros | Filtro por periodo, persona y tienda; detalle de tramos y correcciones. |
| Empleados | Alta, acceso, periodos de actividad, jornada contratada con vigencia y situación de la cuenta. |
| Informes | Resumen mensual por empleado, CSV, impresión/PDF y exportación de seguridad. |

Las incidencias aparecen dentro de «Hoy» y «Registros». Los nombres y datos de las tiendas se configuran una vez. No se construye un sistema de configuración genérico.

Una corrección exige motivo y conserva lo anterior, autor y fecha. El empleado puede verla en su historial. El fichaje original no depende de aprobación de la administradora: se registra inmediatamente. La revisión se aplica a las rectificaciones.

Al pasar un fijo discontinuo a inactividad se conservan historial e identidad. Puede consultar sus registros; no iniciar nuevos tramos. Permitir resolver un tramo ya abierto aunque haya terminado el periodo previsto. Al volver en otra campaña se reutiliza su ficha.

La jornada contratada es una referencia con fecha de inicio y fin. No completa fichajes por sí sola, ni recorta horas registradas, ni bloquea salidas tardías, ni altera meses anteriores al cambiarla. La ampliación de horario semanal permite activar explícitamente entradas y salidas por empleado, independientes de esa jornada contratada.

### Ampliación: horario semanal automático

Administración configura de lunes a domingo hasta seis tramos diarios con entrada, salida y tienda, vigencia y hasta 31 intervalos de fechas excluidas. Puede copiar el lunes a los otros días laborables y señalar una salida al día siguiente. La opción está desactivada inicialmente. Activarla no completa el pasado; al editar se procesan los eventos vencidos del horario anterior y se aplica la nueva configuración al futuro. Cada entrada exige empleado habilitado, periodo laboral vigente y tienda activa.

El backend procesa los eventos pendientes cada minuto, sin depender de una sesión del móvil. Los registros conservan los campos y el origen `clock` de un fichaje manual; su presentación, historial, informes y CSV son los mismos. El control del horario y de cada ejecución se conserva por separado. El cálculo de horas y la corrección con motivo siguen usando los tramos existentes.

Los cambios no alteran registros ni informes ya emitidos. Un tramo iniciado conserva su salida prevista y solo se cierra si sigue intacto. Los fichajes manuales, cambios de tienda, correcciones y anulaciones tienen prioridad; los conflictos requieren revisión. Se mantienen exclusión de solapamientos, transacciones e idempotencia, incluidos reintentos y ejecuciones simultáneas.

En `Europe/Madrid`, una hora repetida usa su primera aparición; una inexistente omite el tramo y genera incidencia. La recuperación de eventos tras una interrupción está limitada a siete días, con trabajo acotado por ejecución. Durante las copias se pausa la escritura. La restauración conserva configuración y vínculos, pero mantiene los horarios en pausa hasta que administración los guarde expresamente; no reejecuta el histórico restaurado.

## 5. Registro, cálculo e informes

### Reglas de integridad

- Hora de servidor para fichajes ordinarios. Guardar instantes UTC y mostrar fechas y horas en Europe/Madrid.
- Conservar segundos; no redondear al alza o a la baja para ajustar la jornada. Mostrar totales como horas y minutos.
- Para correcciones, separar hora efectiva declarada de fecha de creación de la rectificación.
- Como máximo un tramo abierto por empleado, incluso si usa dos móviles o pestañas.
- Idempotencia por empleado e identificador de operación. Comprobar estado y escribir dentro de la misma transacción.
- No cerrar jornadas automáticamente a medianoche. Detectar tramos sospechosamente largos y pedir revisión.
- Los tramos abiertos se marcan como incompletos; no se convierten en cero horas ni en un total mensual definitivo.
- No descontar pausas mediante una constante arbitraria. Añadir fichaje de pausa solo si la operativa y las reglas aplicables lo necesitan.
- Gestionar cruces de día, mes y año, y cambios de horario de verano/invierno sin perder el instante original.

### Resumen mensual

Incluir empresa, identificador fiscal, empleado, periodo, tienda de cada tramo, entradas/salidas, total diario, total mensual y correcciones/incidencias pendientes.

Si el contrato es parcial, incluir horas ordinarias y complementarias. Si hay horas adicionales sin clasificar, señalar «Pendiente de revisión» y permitir a administración introducir la clasificación validada por gestoría. El sistema valida que el desglose cuadre; no determina que todo exceso sea automáticamente hora extraordinaria o complementaria.

Generar una versión fija del informe emitido. Una corrección posterior produce una nueva versión y mantiene la anterior. El CSV incluye los datos de detalle; la vista imprimible produce el documento legible para el empleado y la gestoría. No se exige una firma digital como requisito general de esta primera versión.

La entrega del resumen junto con la nómina se realiza por el canal de la gestoría. Registrar fecha y medio de entrega de forma manual si se quiere dejar evidencia; descargar o abrir un documento no equivale por sí solo a acreditar su entrega.

## 6. Modelo de datos mínimo

| Entidad | Contenido |
| --- | --- |
| Empresa y tiendas | Nombre fiscal, NIF, zona horaria y los dos centros. |
| Usuarios | Identidad autenticada, rol y estado de acceso; tablas de sesión gestionadas por la biblioteca. |
| Empleados | Nombre, usuario asociado y datos de referencia necesarios. |
| Periodos laborales | Intervalo de actividad, jornada pactada y distribución de referencia con vigencia. |
| Tramos de trabajo | Empleado, tienda, entrada, salida inicialmente vacía, origen e identificadores de operación. |
| Correcciones | Tramo afectado, valores anteriores/nuevos, motivo, autor y fecha. Se añaden, no se sobrescriben. |
| Incidencias | Empleado, día, motivo y estado de revisión. |
| Informes mensuales | Empleado, mes, versión, desglose emitido y datos de entrega si se registran. |

La primera salida completa el tramo abierto. Las modificaciones posteriores se registran como correcciones sin destruir el original. Las anulaciones también son trazables. Esto no necesita un framework de eventos, un motor de workflows ni un sistema de permisos genérico.

Índices por empleado/fecha, tienda/fecha, mes/empleado y operación. Validación de parámetros y comprobación del rol en cada función de backend; ocultar un botón en la interfaz no sustituye la autorización.

## 7. Seguridad, conservación y recuperación

- El empleado solo consulta sus datos y ficha por sí mismo. El backend obtiene su identidad de la sesión, no de un identificador arbitrario del navegador.
- La administradora accede a las dos tiendas. Las cuentas no pueden adjudicarse privilegios enviando parámetros de registro.
- Desactivar el registro público también en el backend. Limitar intentos de acceso y recuperación.
- Convex Auth figura actualmente como beta. Validar al principio alta asistida, renovación y revocación reales, incluido el acceso desde conexiones ya abiertas. Fijar versiones y revisar actualizaciones de seguridad.
- Las sesiones de la SPA usan el almacenamiento que documenta Convex Auth; no afirmar que están protegidas por cookies HttpOnly. Aplicar CSP, no insertar HTML arbitrario ni incorporar scripts de marketing.
- No registrar contraseñas, tokens, documentos completos ni contenido laboral innecesario en logs.
- Datos de trabajo en el despliegue europeo. La elección de región no sustituye el encargo de tratamiento ni el examen de subencargados/transferencias.
- Cuenta de los proveedores bajo control de la empresa, con recuperación y acceso técnico delegable.
- Conservación de registros y resúmenes durante los cuatro años exigidos, manteniéndolos accesibles también entre campañas. No purgar datos para resolver una cuota de almacenamiento.
- Al finalizar el plazo aplicable, revisión y supresión de datos/copias sin obligación de conservación, salvo bloqueo por reclamaciones. No conservarlos indefinidamente por defecto.
- Historial sin modificaciones silenciosas en la aplicación. No prometer inmutabilidad absoluta frente al propietario técnico de la base de datos; las copias externas y los documentos ya entregados aportan evidencia independiente.

### Copias de seguridad

Convex Free permite copias manuales limitadas: hasta dos por despliegue, accesibles durante siete días. Las copias automáticas periódicas gestionadas corresponden a planes superiores. Esas ventanas de recuperación no equivalen a conservar registros cuatro años. [Backup & Restore](https://docs.convex.dev/database/backup-restore).

Decisión confirmada por el usuario: exportación semanal a un archivo desde administración, guardado fuera de Convex. Usar un equipo y, como segunda copia recomendada, un destino de la empresa ya disponible. Guardar también los informes mensuales emitidos. La operación es manual y su intervalo implica una posible pérdida de hasta siete días ante pérdida completa del proveedor; no presentarla como copia diaria automática.

La exportación debe contener datos originales, correcciones, periodos laborales, informes emitidos y versión de formato. No incluir contraseñas ni sesiones en la exportación funcional. La restauración reconstruye datos y relaciones; el acceso se recupera mediante nueva identificación. Código y configuración se conservan por separado, con los secretos en el gestor de credenciales.

Antes de la puesta en marcha: cifrar el archivo de copia con un mecanismo estándar, guardar la clave de recuperación fuera de la app, restaurarlo en un entorno aislado y comparar número de registros, correcciones y totales. Comprobar la integridad detecta corrupción; no demuestra por sí sola autenticidad legal.

Presupuestar las lecturas y descargas de exportación dentro de las cuotas gratuitas. Mostrar a la administradora la fecha de la última exportación y un recordatorio cuando haya pasado una semana. La app puede acreditar que generó la copia, pero no que se guardó correctamente en el destino externo. La automatización de copias queda fuera de esta versión.

## 8. Secuencia de implementación

| Fase | Trabajo | Criterio de finalización |
| --- | --- | --- |
| 1. Base y acceso | Proyecto, entornos de prueba/producción separados, configuración de las dos tiendas y alta asistida. | Abrir desde ordenador y móvil, identificar empleado/administradora, conservar sesión y revocarla realmente. Confirmar región y planes gratuitos. |
| 2. Fichaje completo | Entrada con tienda, salida, cambio de tienda, estado y consulta personal. | Fichar desde móvil y comprobar persistencia después de cerrar, reabrir y recargar; sin duplicados ni dos tramos abiertos. |
| 3. Administración | Empleados, periodos y jornadas con vigencia, filtros, incidencias y correcciones. | Corregir un olvido y verificar que el empleado ve la rectificación y se conserva el original. |
| 4. Informes y copias | Totales, clasificación revisable, documentos versionados, CSV y exportación/restauración. | Un mes de prueba cuadra con un cálculo independiente; restauración reproduce detalle y totales. |
| 5. Validación y lanzamiento | Pruebas de permisos y red, móviles reales, límites de consumo, instrucciones y piloto. | Administradora y dos trabajadores completan el flujo; documentos revisados y procedimiento de contingencia preparado. |

El repositorio está vacío. Crear una aplicación y un backend Convex en el mismo repositorio, con carpetas pequeñas para pantalla de fichaje, administración, informes y funciones de servidor. Utilizar el SDK de Convex para los datos; no duplicarlo con otra capa de consultas ni introducir microservicios.

Construcción y comprobaciones antes de publicar cada versión. Datos ficticios en desarrollo; no conectar previews a datos laborales reales. Cambios de esquema compatibles con la versión anterior y exportación previa a una migración que pueda afectar registros. No activar un despliegue de pago para superar una incidencia.

## 9. Pruebas de aceptación necesarias

1. Un trabajador preparado con acceso directo completa entrada en dos pulsaciones y salida en una, sin ayuda tras una demostración breve.
2. Alternar tiendas en días distintos y dentro de una jornada conserva el centro correcto y el total trabajado.
3. Una jornada partida suma sus tramos, sin contar automáticamente el intervalo entre ellos.
4. Doble pulsación, reintento tras respuesta perdida y dos pestañas simultáneas producen una sola operación coherente.
5. Una desconexión antes/durante/después del envío muestra el estado real. Al reconectar no aparecen fichajes tardíos silenciosos.
6. Cambiar el reloj del móvil no cambia la hora del fichaje normal.
7. Correcciones, anulaciones y entradas tardías conservan original, motivo y autor; se ven desde el historial del trabajador.
8. Un empleado no puede consultar otro empleado, modificar su jornada ni llamar funciones administrativas mediante peticiones directas.
9. Cambiar la jornada contratada a mitad de mes no recalcula la anterior como si se hubiera contratado siempre igual.
10. Cruce de medianoche, fin de mes y cambio de hora producen totales correctos; un tramo abierto sigue marcado como incompleto.
11. Una corrección posterior a la emisión de un informe crea otra versión y conserva la enviada previamente.
12. Cerrar/reabrir Safari en iPhone y Chrome en Android conserva acceso y datos; revocar la cuenta o sesión impide operar desde un móvil ya conectado.
13. Restaurar una copia en un entorno aislado devuelve los mismos registros, rectificaciones e informes sin reutilizar sesiones antiguas.
14. Los datos sintéticos de cuatro años caben en las cuotas gratuitas con margen, incluyendo índices, copias e informes. Medir consultas de las pantallas reales.

Usar pruebas de integración del backend y navegador para permisos, concurrencia y persistencia. No dar por validado el sistema por pruebas que solo comprueben mocks. Realizar una prueba de usabilidad con dos trabajadores y un piloto de varios días, con un único procedimiento claro para cuál es el registro oficial.

## 10. Fuera del alcance inicial

Nóminas, contratación, llamamientos, vacaciones, cuadrantes, cálculo jurídico automático de horas adicionales, GPS, biometría, fotografías, firma digital cualificada, integración con Inspección, avisos por SMS/email, aplicación nativa, sincronización offline, múltiples empresas y cuadros de mando complejos.

## 11. Comprobaciones antes del uso laboral

Estas tareas se pueden resolver durante el desarrollo; no impiden comenzar:

- Confirmar datos fiscales y nombres de ambos centros, administradora y canal de entrega mensual.
- Confirmar con gestoría el convenio, contratación, pausas y reglas de clasificación de horas.
- Documentar cómo fichar, cómo corregir incidencias y quién entrega los resúmenes; consultar a representantes si corresponde.
- Información de privacidad, registro de actividades y encargos de tratamiento de los proveedores.
- Verificar nuevamente la normativa vigente antes del lanzamiento: el proyecto de registro digital puede cambiar el alcance futuro.
- Elegir y probar un destino externo recuperable para las copias; disponer del acceso a los registros durante una inspección.

Fuentes laborales de referencia: [Estatuto, artículos 12, 16, 34 y 35](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430), [guía del Ministerio](https://www.mites.gob.es/itss/ITSS/ITSS_Descargas/Atencion_ciudadano/Normativa_documentacion/Docum_ITSS/GUIA_Registro_Jornada.pdf) y [AEPD, relaciones laborales](https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf).

Referencias técnicas adicionales: [regiones de Convex](https://docs.convex.dev/production/regions), [Convex Auth](https://docs.convex.dev/auth/convex-auth), [acceso con usuario y contraseña](https://labs.convex.dev/auth/config/passwords), [seguridad de sesiones](https://labs.convex.dev/auth/security), [exportación de datos](https://docs.convex.dev/database/import-export/export) y [encargo de tratamiento de Convex](https://www.convex.dev/legal/dpa). Tarifas y capacidades consultadas el 5 de septiembre de 2026; la compatibilidad funcional se verificará durante la implementación.
