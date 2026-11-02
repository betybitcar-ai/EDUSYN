# Cuadrilla — Horarios escolares

Node.js (≥ 22.5) + Express + SQLite (`node:sqlite`, sin compilar nada).

## Puesta en marcha
```bash
npm install
cp .env.example .env      # completá FIGMA_TOKEN para usar Figma
npm run seed              # datos de demostración (opcional)
npm start                 # http://localhost:3000
npm test                  # prueba de punta a punta (incluye un Figma simulado)
```
Cuentas del seed: `admin@cuadrilla.com / admin123`, `ana@cuadrilla.com / profe123` (también carlos, lucia, martin), `alumno@cuadrilla.com / alumno123`.

## Qué ve cada rol
| Rol | Horario |
|---|---|
| **Admin** | Sección **Por profesor**: elige a cualquier profesor (con o sin cuenta) y ve su horario por horas o por días. Además: grilla semanal a color con **el nombre del profesor en cada clase**; crea/edita/borra clases, asigna profesor y **publica / vuelve a borrador**. |
| **Profesor** | Ve su horario en **“Mi horario”** apenas lo tiene (de su planilla, entregado por el Asistente o asignado), **sin esperar** a que el admin publique. No tiene la sección “Horario” (esa es para armar el de los alumnos). Hasta que entregue su horario solo puede usar el Asistente. |
| **Alumno** | Ve la grilla solo cuando el admin la **publicó**; antes, un aviso de que se está armando. |

**Mapa 3D y Clima:** los tres roles los ven (ver las secciones más abajo).

**Horario vs. profesores:** la sección **Horario** (grilla general) es solo para armar el horario de los alumnos. Los horarios personales de cada profesor (los cargados desde su planilla, como el de Silvio o Saúl) **no aparecen ahí**: el admin los ve únicamente en **Por profesor**, y cada profesor en **Mi horario**.

**Un horario por curso:** cada curso (3°MF, 7°3…) es una pestaña con su propio horario y su propio estado. Al armar un horario, las clases nuevas van siempre al curso elegido (no se mezclan cursos), y para otro curso se cambia de pestaña o se crea con **+ Nuevo curso**. **Publicar** es por curso: los profesores de ese curso ven sus clases en “Mi horario” y los alumnos la grilla de ese curso; mientras está en borrador solo lo ve el admin.

Cada materia tiene siempre el mismo color. El servidor avisa si un profesor o un salón quedan en dos clases a la vez.

## Mapa 3D (todos los roles)
Menú **🧭 Mapa 3D**: plano en 3D de la **Escuela Técnica Maestro Carlos Martín De Vecchi** (UTU Artigas), dibujado a partir del plano oficial con sus 50 espacios numerados como en el original (salones, talleres, otros espacios, cancha, patios, galería y estacionamiento). Hecho con CSS 3D, sin librerías ni internet. Lo ven **admin, profesor y alumno**.
- **Colores del plano:** amarillo = salones, azul = talleres, naranja = otros espacios, verde = cancha, gris = espacios abiertos.
- **Mover la vista:** arrastrar con el mouse o el dedo para girar, rueda o pellizco para acercar, botones ＋ / － y **↺ Reiniciar vista**. Con el teclado: flechas, `+` / `-` y `Esc`.
- **Plantas:** *Planta baja* (vista inicial), *Planta alta* o *Ambas plantas*. El plano oficial dibuja la planta alta aparte, así que su posición sobre la baja es **aproximada**; se ajusta con `PLANTA_ALTA_DESPLAZAMIENTO` en `public/mapa3d.js`.
- **Tocar un espacio** (o elegirlo en la lista, ordenada por el número del plano): muestra su nombre, planta, tipo y **las clases de la semana** que tiene asignadas (materia, curso, profesor).
- **Ver ocupación:** pinta cada salón y taller de 🟢 libre o 🔴 ocupado en el día y la hora elegidos (por defecto, ahora), usando el campo **Salón** de las clases del horario. Un salón de la grilla se reconoce por su nombre: `Salón 7`, `Aula 7` y `7` son lo mismo; `Sala Informática 2`, `UTUlab`, `Laboratorio`… también (ver `alias` en `SALONES_MAPA`). Si todavía no hay clases con salón asignado, lo avisa en lugar de mostrar todo "libre". Los salones de la grilla que no figuran en el plano se listan abajo del panel.
- **Aspecto del edificio / Colores por tipo:** el mapa abre con el aspecto del edificio real (paredes blancas con zócalo de ladrillo y techos de teja). El botón **🎨 Colores por tipo** lo cambia a los colores del plano; con **Ver ocupación** activada siempre se ven verde y rojo.
- **Fachada y entorno (según la foto):** en la entrada real del plano, sobre calle Bernabé Rivera, están el pórtico de ladrillo con arco, el muro bajo con reja, el cartel “Juntos diseñamos el cambio”, la palmera y el mástil con la bandera. Alrededor del terreno se dibujan las calles Bernabé Rivera, Río Branco y Gral. Rivera. El frontón de la foto no se dibujó porque en el plano no se sabe sobre qué parte queda la planta alta.
- **Corregir o agregar espacios:** editá `SALONES_MAPA` al principio de `public/mapa3d.js` (posición y tamaño en píxeles del plano, tipo y alias). Código: `public/mapa3d.js`.
- Un profesor que todavía no entregó su horario semanal sigue bloqueado (solo Asistente), como el resto del menú.

## Clima en Artigas (todos los roles)
Menú **🌦️ Clima** y un mini widget con la temperatura actual en la barra lateral (al tocarlo abre la pantalla completa). Lo ven **admin, profesor y alumno**.
- Muestra temperatura, sensación térmica, humedad, viento, lluvia, un consejo breve (paraguas, abrigo, calor…) y el **pronóstico de 5 días**.
- Los datos vienen de [Open-Meteo](https://open-meteo.com) (gratis, **sin clave**) para Artigas (−30.40, −56.4667). El servidor los pide **una vez cada 10 minutos** para todos los usuarios (caché) y, si no hay conexión, muestra el último dato guardado avisando que está desactualizado. El navegador se actualiza solo cada 10 minutos.
- API: `GET /api/clima` (cualquier usuario con sesión). Código: `routes/clima.js`, `public/clima.js`. El servidor necesita salida a internet hacia `api.open-meteo.com`.

## Horario de Silvio Fagundez y vista por horas
El horario de Silvio (transcrito de su planilla) está en `lib/horarioSilvio.js`. Se carga solo la primera vez que arranca el servidor y queda asignado a su cuenta; para corregirlo, editá ese archivo y corré `npm run cargar-silvio`.
En **Mi horario** los profesores ven una tabla por franjas horarias con bloques de color (amarillo = liceo, azul = UTU, verde = coordinación) y pueden cambiar a la vista “Por días”.

## Horario de Saúl Pereira
Está en `lib/horarioSaul.js` (transcrito de su planilla), se carga solo la primera vez y queda en su cuenta; para corregirlo editá ese archivo y corré `npm run cargar-saul`. Las líneas marcadas `REVISAR` estaban escritas a mano y poco legibles.

## Horario de Valentina Rodríguez
Está en `lib/horarioValentina.js` (transcrito de su planilla), se carga solo la primera vez y queda en su cuenta; para corregirlo editá el archivo y corré `npm run cargar-valentina`. El admin lo ve en **Por profesor**. Las líneas `REVISAR` estaban escritas a mano o sin lugar indicado.

## Entrega obligatoria del horario semanal
Todo profesor **debe entregar su horario semanal** por el **Asistente**. Mientras no lo haga, al entrar solo puede usar el Asistente (el resto del menú queda bloqueado), no puede tomar clases libres y el asistente no le gestiona intercambios ni reemplazos.
- **Cómo se entrega:** escribe o pega el horario en el chat, una clase por línea: `Lunes 07:30-09:00 3°MA liceo`, `Lunes 09:05-10:35 3°DF utu`, `Miércoles 10:40-11:25 Coordinación` (también sirve `7.30 a 9`; el lugar es liceo = amarillo, UTU = azul, coordinación = verde). Se acepta todo junto en un solo mensaje (Shift+Enter baja de línea).
- **Formatos sueltos:** también entiende `los lunes y miércoles de 8 a 10 con 3°MA en el liceo` o el curso antes del día (`3°MA lunes de 8 a 10 utu`).
- **Foto de la planilla (📷):** el profesor sube una foto (con el 📷, **pegándola con Ctrl+V** o arrastrándola al chat). **La foto siempre le llega al admin**, que la ve en **Por profesor** (miniatura, clic para agrandar) con aviso en Mensajes e Historial, y **el profesor queda con el horario entregado: ya puede usar todo el sistema**, aunque la lectura no haya sido perfecta.
  - **Con `GEMINI_API_KEY`:** la IA transcribe la foto. Si la lectura es limpia (sin líneas dudosas ni errores) **se pasa sola a clases** y aparece armada en Por profesor. Si hay líneas dudosas (`?`), la foto igual llega al admin y el texto queda en el cuadro del chat para revisarlo y enviarlo.
  - **Sin clave (sin IA):** la foto llega igual al admin; además el navegador intenta leerla con OCR (Tesseract.js, necesita internet) y deja el texto como borrador en el cuadro. El admin puede pasarla a clases con el botón **✍️ Cargar sus clases en el asistente** de Por profesor.
  - API: `POST /api/chatbot/foto` (`{ imagen, profesor? }`; `profesor` solo lo usa el admin) y `GET /api/horarios/entrega/foto/:id` (admin, o el propio profesor). Si el profesor borra todo su horario (`confirmo borrar todo`) también se borra su foto.
- **Foto del horario de un profesor (admin):** el admin también ve el 📷, con un selector para elegir de qué profesor es la foto (debe tener cuenta). La foto queda guardada en su ficha de Por profesor; si la IA la lee limpia se carga sola, y si no, el texto queda en el cuadro como `Cargar horario de Ana Pérez:` + una clase por línea para revisarlo y enviarlo (reemplaza solo los días que incluya; con líneas dudosas no guarda clases).
- **Qué hace el asistente:** interpreta las clases; si alguna línea no se entiende (falta el curso, horas al revés, clases que se pisan) **no guarda nada** y lista los errores. Si está bien, lo guarda como horario personal (origen `carga-profesor`, no aparece en la grilla de los alumnos) y **lo mueve a la sección *Por profesor* del admin**, avisa a los admin (mensaje + Historial) y desbloquea al profesor.
- **Ver y corregir (profesor):** `ver mi horario entregado`; para corregir basta mandar solo el día mal (**reemplaza solo los días que incluya el mensaje**); `borrar mi horario del lunes` quita un día; `borrar mi horario` pide escribir `confirmo borrar todo` y deja al profesor otra vez pendiente.
- **Resumen en el chat (admin):** `¿quién falta entregar el horario?` y `horario de Ana Pérez` (si hay varias coincidencias pide el nombre completo).
- **Admin → Por profesor:** cada profesor muestra ✅ (entregó) o ⏳ (falta); arriba se lista quién falta y el botón **🔔 Recordarles** les manda un aviso. Los horarios ya cargados desde planilla (Silvio, Saúl, Valentina) cuentan como entregados.
- API: `GET /api/horarios/entrega` (profesor: su estado · admin: todos), `POST /api/horarios/entrega/recordar` (admin).

## Detector de choques (admin)
Compara lo que **entregó cada profesor** (su horario personal, origen `carga-…`) con las clases que **el admin le asignó en la grilla**. Solo lo ve el admin y solo revisa a quien ya entregó algo (si no entregó, no hay con qué comparar y se indica aparte).
- **En dos lugares a la vez:** la grilla dice una cosa y lo entregado otra, a la misma hora (incluye *Coordinación*).
- **Hora distinta:** mismo curso y día, pero la hora no coincide.
- **Le falta una clase:** el admin le cargó una clase que no figura en lo que entregó.
- **Dónde se ve:** en **Por profesor** hay un resumen arriba con un botón por profesor (lleva a su detalle) y un contador rojo en el menú; el mensaje al admin cuando alguien entrega ya avisa si no coincide con la grilla; y al crear o editar una clase el aviso aparece al guardar (no bloquea).
- Las clases de la grilla se comparan por día, horas y **curso** (`7°3` = `7º 3`). Lo que coincide exacto no genera aviso.
- API: `GET /api/horarios/choques` (admin). Código: `lib/choquesLib.js`.

## Avisos dirigidos (admin)
En **Avisos**, el admin elige **Dirigido a**: *Todos* (como siempre), *Uno o más cursos*, *Un turno* o *Un grupo de profesores*.
- **Cursos:** lo ven los profesores con alguna clase en ese curso (de la grilla o de lo que entregaron). **Turno:** según la plantilla de profesores. **Grupo:** los profesores elegidos (con o sin cuenta; si se registran después, lo ven).
- Los **alumnos solo ven los avisos para todos** (las cuentas de alumno no están ligadas a un curso). El admin ve todos, con una etiqueta 🎯 de a quién van; el profesor solo ve los que le tocan.
- Al publicar, el sistema dice a cuántos profesores con cuenta les llega y lo anota en el **Historial** (acción *Aviso dirigido*). Las **noticias** siguen siendo siempre para todos.
- Los avisos que ya estaban publicados quedan para todos. API: `GET /api/avisos/destinos` (admin) y `POST /api/avisos` con `destino_tipo` (`todos|cursos|turno|profesores`) y `destino` (lista). Código: `lib/avisosLib.js`.

## Profesores en el selector del admin
Al crear o editar una clase, el selector **Profesor** muestra a los 18 profesores de la institución (lista en `lib/profesoresPlantilla.js`, agrupados por turno) más cualquier otra cuenta de profesor. Si uno todavía no tiene cuenta, la clase queda a su nombre y le aparece en “Mi horario” apenas se registre.

## Cuentas de los profesores
Al arrancar, el servidor crea una cuenta de profesor para cada nombre de `lib/profesoresPlantilla.js` (18, ya con el selector del admin apuntando a esas cuentas). Correo: `nombre.apellido@gmail.com` sin tildes (ej. `silvio.fagundez@gmail.com`, `ana.li.rodriguez@gmail.com`). Contraseña: **`PROFE-2026`** para todos (o `PROFE_PASSWORD_INICIAL` del `.env`). Una sola vez, a todas las cuentas de profesores que ya existían también se les cambia el correo a @gmail.com y se les pone esa contraseña; después no se vuelven a tocar. También se pueden crear a mano con `npm run cargar-profesores`.
El horario de Silvio queda en su cuenta; el admin lo ve siempre en **Por profesor**, y Silvio lo ve en **Mi horario** cuando el admin publica.

## Curso de cada clase
Al crear o editar una clase el admin **debe indicar el curso** (ej. `7°3`, `3°CAD`); se muestra en las tarjetas, en las tablas y en el historial. Las clases ya cargadas de Silvio y Saúl reciben su curso automáticamente.

## Contraseña
Todos los usuarios tienen el botón **🔑 Cambiar contraseña** en el menú (pide la actual; la nueva necesita 8 caracteres o más y no puede ser la inicial). Si un profesor la olvida, el admin entra a **Por profesor**, lo elige y toca **🔑 Restablecer contraseña**: vuelve a `PROFE-2026` y el profesor recibe un aviso para cambiarla. Ambas acciones quedan en el **Historial**. API: `POST /api/auth/password`, `POST /api/auth/restablecer` (admin).

## Descargas (Excel y PDF)
- **Admin → Horario**: elegí *Todos los cursos* o un curso y tocá **⬇️ Excel** o **🖨️ PDF**. El Excel de un curso trae una grilla semanal y una lista; el de *Todos* trae la lista completa. El PDF de *Todos* sale con una hoja por curso.
- **Alumno → Horario** (cuando el admin lo publicó): elige *Todos los cursos* o su curso y toca **⬇️ Excel** o **🖨️ PDF**. Solo recibe el horario general (nunca los horarios personales de los profesores). API: `GET /api/exportar/excel?alcance=todo|curso`.
- **Admin → Por profesor** y **Profesor → Mi horario**: botón **⬇️ Excel** (grilla + lista). El profesor solo puede bajar el suyo, y solo cuando el horario fue publicado.
- El PDF usa el diálogo de impresión del navegador (elegí “Guardar como PDF”). El Excel se genera en el servidor sin librerías extra. API: `GET /api/exportar/excel?alcance=todo|curso|profesor|mio`.

## Cambios de horario
- **Aviso al profesor**: si el admin crea, mueve, cambia de salón/materia/profesor o borra una clase **ya publicada**, el profesor afectado recibe un mensaje automático (en borrador no se avisa nada).
- **Intercambios con aprobación**: cuando el asistente empareja a dos profesores (`cambiar horario`), el pedido queda **pendiente** y se avisa a los admin. En **Cambios** el admin lo aprueba o rechaza; al aprobar, las dos clases se intercambian solas (se verifica que no genere choques) y ambos profesores reciben aviso. API: `GET /api/cambios`, `POST /api/cambios/:id/aprobar|rechazar` (solo admin).

## Vista por salón (admin)
Sección **Por salón**: elegí un aula y mirá la tabla por horas con la clase y el profesor de cada franja (las celdas vacías son horas libres). Arriba, **¿Qué salones están libres?**: elegís día y hora y ves cuáles están libres y cuáles ocupados (con materia y profesor). Los salones salen de los que se escriben en las clases ("Aula 101" y "aula 101" cuentan como el mismo). El asistente también responde: `¿qué salones están libres el lunes a las 9?` o `¿está libre el aula 101 el lunes a las 10?`. API: `GET /api/horarios/salones[?dia=&hora=]` (solo admin).

## Historial de cambios (admin)
Sección **Historial**: quién hizo qué y cuándo (clases creadas, editadas con el detalle de lo que cambió, eliminadas, liberadas o tomadas; publicaciones; intercambios aprobados o rechazados; importaciones de Figma; backups). Se puede buscar por persona o detalle y filtrar por tipo de acción; se conservan los últimos 5000 registros. API: `GET /api/historial?q=&accion=` (solo admin).

## Reemplazos ordenados
Cuando alguien avisa que falta, el asistente lista a los profesores libres a esa hora ordenados por **menos horas semanales** primero (el primero va con ⭐ como sugerido). Quienes están **cerca del límite de faltas** (desde el 80 % de `LIMITE_FALTAS`) o ya en la lista negra van al final, marcados con ⚠️ / 🚫. Cada nombre muestra sus horas semanales.

## Seguridad para publicar la app
- `npm run generar-claves` imprime un `SESSION_SECRET` y claves `PROFE_CODE` / `ADMIN_CODE` aleatorias para tu `.env`.
- Con `NODE_ENV=production` el servidor **no arranca** si el secreto o las claves son los de ejemplo, cortos o repetidos; y sin esas variables nadie puede registrarse como profesor/admin.
- Límite de intentos: 5 contraseñas erróneas por correo+IP y 10 claves de autorización erróneas por IP cada 15 minutos (después responde 429). Detrás de un proxy usá `TRUST_PROXY=1`.
- `npm run seed` (cuentas `admin123` / `profe123`) se niega a correr en producción.

## Imprimir / PDF
Botón **🖨️ Imprimir / PDF** en “Mi horario” (profesor) y en “Por profesor” (admin), más **Todos los profesores** (una hoja A4 apaisada por profesor). En el diálogo de impresión elegí “Guardar como PDF”.

## Traslado liceo ↔ UTU
Cada clase tiene un **Lugar** (liceo = amarillo, UTU = azul, coordinación = verde). Si un profesor tiene dos clases seguidas en liceo y UTU con menos de 30 min entre ambas (`TRASLADO_MINUTOS`), el admin ve un aviso al guardar la clase, en “Por profesor” y antes de publicar. Es solo un aviso: no bloquea.

## Lista negra
Un profesor entra a la lista negra al llegar a **30 faltas** (configurable con `LIMITE_FALTAS`).

## Asistente (chatbot)
Disponible para **profesores y administradores**. Funciona **sin IA** con comandos en lenguaje natural: `ver tabla`, `disponibilidad`, `generar imagen del horario`, `mi horario` (te lleva directo a la sección **Mi horario**), `cambiar horario` (empareja a dos profesores que piden cambio), `no puedo dar clase el lunes` (muestra quién está libre y avisa a los admin), `mis mensajes`. En los reemplazos también indica quién está **en otro lugar** a esa hora. Los admin además: `lista negra`, `reemplazo para el lunes`, `hacer backup` / `ver backups`.
Con `GEMINI_API_KEY` en `.env` responde también preguntas libres usando el horario real como contexto (`GEMINI_MODEL` opcional).

## Backup (solo administrador)
Sección **Backup** del menú (y por chat): crear, descargar (`.db` de SQLite), **descargar en PDF**, restaurar y eliminar copias. El PDF (`GET /api/backup/:nombre/pdf`) es un informe legible con el resumen, la grilla, el horario de cada profesor y los usuarios (sin contraseñas); sirve para leer o archivar, no para restaurar. Restaurar reemplaza todos los datos y antes guarda una copia de seguridad automática. Además se crea **un backup diario automático** (se conservan los últimos 14) en `backups/` (o `BACKUP_DIR`). Los backups incluyen contraseñas cifradas y datos personales: guardalos con cuidado.

## Figma → Cuadrilla
> El botón y el panel de Figma ya no aparecen en la interfaz del admin. La API (`/api/figma/*`) sigue en el servidor, por si se quiere volver a usar.

La API de Figma solo permite **leer** archivos, así que el flujo es: el admin diseña el horario en Figma, lo importa a la app, lo revisa y lo publica.

1. Creá un token en Figma (*Settings → Security → Personal access tokens*, permiso de lectura de archivos) y ponelo en `.env` como `FIGMA_TOKEN`.
2. En la app (admin) → **Figma**: pegá el enlace del archivo (o de un frame con `node-id`) → **Vista previa** → **Importar horario**.
3. Revisá la grilla del curso y tocá **Publicar** (cada curso se publica por separado).

**Cómo armar el archivo en Figma**
- Un frame por día, llamado `Lunes`, `Martes`, `Miércoles`… (sirve también `Lunes - Mañana`).
- Dentro, una tarjeta por clase con textos: materia, `08:00 - 09:30`, `Aula 101` y el profesor (`Prof. Ana Pérez`; si sobra una línea sin etiqueta se toma como profesor).
- Si el nombre coincide con una cuenta de profesor, la clase queda asignada y le aparece en “Mi horario”; si todavía no tiene cuenta, se vincula sola cuando se registre.
- “Reemplazar” borra solo lo importado antes desde Figma; lo creado a mano se conserva.

## API principal
`GET /api/horarios` · `GET /api/horarios/mios` · `GET /api/horarios/choques` (admin) · `POST/PUT/DELETE /api/horarios[/:id]` (admin) · `POST /api/horarios/publicar { curso, publicado }` (admin) · `GET/POST /api/horarios/cursos` · `DELETE /api/horarios/cursos/:curso` (admin) ·
`GET/POST /api/figma/config`, `POST /api/figma/preview`, `POST /api/figma/importar` (admin) · `/api/auth/*` · `/api/avisos` · `/api/ausencias` · `/api/lista-negra` (admin) · `/api/chatbot` (profesor/admin) · `/api/backup` (**solo admin**)

## Seguridad
El registro de profesor y admin exige las claves `PROFE_CODE` / `ADMIN_CODE` **en el servidor**. Cambiá `SESSION_SECRET` y las claves antes de publicar, y usá `NODE_ENV=production` con HTTPS.
