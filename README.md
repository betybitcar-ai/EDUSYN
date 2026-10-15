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
| **Profesor** | Ve su horario solo cuando el admin lo **publicó** (recibe un aviso al publicar). “Mi horario”: sus clases a color, lo que tiene hoy y sus horas semanales. También ve la grilla general y puede tomar o liberar clases libres. |
| **Alumno** | Ve la grilla solo cuando el admin la **publicó**; antes, un aviso de que se está armando. |

**Horario vs. profesores:** la sección **Horario** (grilla general) es solo para armar el horario de los alumnos. Los horarios personales de cada profesor (los cargados desde su planilla, como el de Silvio o Saúl) **no aparecen ahí**: el admin los ve únicamente en **Por profesor**, y cada profesor en **Mi horario**.

**Publicar** hace que cada profesor vea su propio horario en “Mi horario” y los alumnos la grilla; en borrador solo lo ve el admin.

Cada materia tiene siempre el mismo color. El servidor avisa si un profesor o un salón quedan en dos clases a la vez.

## Horario de Silvio Fagundez y vista por horas
El horario de Silvio (transcrito de su planilla) está en `lib/horarioSilvio.js`. Se carga solo la primera vez que arranca el servidor y queda asignado a su cuenta; para corregirlo, editá ese archivo y corré `npm run cargar-silvio`.
En **Mi horario** los profesores ven una tabla por franjas horarias con bloques de color (amarillo = liceo, azul = UTU, verde = coordinación) y pueden cambiar a la vista “Por días”.

## Horario de Saúl Pereira
Está en `lib/horarioSaul.js` (transcrito de su planilla), se carga solo la primera vez y queda en su cuenta; para corregirlo editá ese archivo y corré `npm run cargar-saul`. Las líneas marcadas `REVISAR` estaban escritas a mano y poco legibles.

## Profesores en el selector del admin
Al crear o editar una clase, el selector **Profesor** muestra a los 17 profesores de la institución (lista en `lib/profesoresPlantilla.js`, agrupados por turno) más cualquier otra cuenta de profesor. Si uno todavía no tiene cuenta, la clase queda a su nombre y le aparece en “Mi horario” apenas se registre.

## Cuentas de los profesores
Al arrancar, el servidor crea una cuenta de profesor para cada nombre de `lib/profesoresPlantilla.js` (17, ya con el selector del admin apuntando a esas cuentas). Correo: `nombre.apellido@cuadrilla.com` sin tildes (ej. `silvio.fagundez@cuadrilla.com`, `ana.li.rodriguez@cuadrilla.com`). Contraseña inicial: `PROFE_PASSWORD_INICIAL` del `.env` (por defecto `profe123`; en producción es obligatoria). No se tocan cuentas que ya existan. También se pueden crear a mano con `npm run cargar-profesores`.
El horario de Silvio queda en su cuenta; el admin lo ve siempre en **Por profesor**, y Silvio lo ve en **Mi horario** cuando el admin publica.

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
Disponible para **profesores y administradores**. Funciona **sin IA** con comandos en lenguaje natural: `ver tabla`, `disponibilidad`, `generar imagen del horario`, `mi horario`, `cambiar horario` (empareja a dos profesores que piden cambio), `no puedo dar clase el lunes` (muestra quién está libre y avisa a los admin), `mis mensajes`, `¿dónde está Silvio el lunes a las 9?` (dice si a esa hora está en otro lugar —con la clase y el salón— o libre). En los reemplazos también indica quién está **en otro lugar** a esa hora. Los admin además: `lista negra`, `reemplazo para el lunes`, `hacer backup` / `ver backups`.
Con `GEMINI_API_KEY` en `.env` responde también preguntas libres usando el horario real como contexto (`GEMINI_MODEL` opcional).

## Backup (solo administrador)
Sección **Backup** del menú (y por chat): crear, descargar (`.db` de SQLite), restaurar y eliminar copias. Restaurar reemplaza todos los datos y antes guarda una copia de seguridad automática. Además se crea **un backup diario automático** (se conservan los últimos 14) en `backups/` (o `BACKUP_DIR`). Los backups incluyen contraseñas cifradas y datos personales: guardalos con cuidado.

## Figma → Cuadrilla
> El botón y el panel de Figma ya no aparecen en la interfaz del admin. La API (`/api/figma/*`) sigue en el servidor, por si se quiere volver a usar.

La API de Figma solo permite **leer** archivos, así que el flujo es: el admin diseña el horario en Figma, lo importa a la app, lo revisa y lo publica.

1. Creá un token en Figma (*Settings → Security → Personal access tokens*, permiso de lectura de archivos) y ponelo en `.env` como `FIGMA_TOKEN`.
2. En la app (admin) → **Figma**: pegá el enlace del archivo (o de un frame con `node-id`) → **Vista previa** → **Importar horario**.
3. Revisá la grilla y tocá **Publicar a alumnos**.

**Cómo armar el archivo en Figma**
- Un frame por día, llamado `Lunes`, `Martes`, `Miércoles`… (sirve también `Lunes - Mañana`).
- Dentro, una tarjeta por clase con textos: materia, `08:00 - 09:30`, `Aula 101` y el profesor (`Prof. Ana Pérez`; si sobra una línea sin etiqueta se toma como profesor).
- Si el nombre coincide con una cuenta de profesor, la clase queda asignada y le aparece en “Mi horario”; si todavía no tiene cuenta, se vincula sola cuando se registre.
- “Reemplazar” borra solo lo importado antes desde Figma; lo creado a mano se conserva.

## API principal
`GET /api/horarios` · `GET /api/horarios/mios` · `POST/PUT/DELETE /api/horarios[/:id]` (admin) · `POST /api/horarios/publicar` (admin) ·
`GET/POST /api/figma/config`, `POST /api/figma/preview`, `POST /api/figma/importar` (admin) · `/api/auth/*` · `/api/avisos` · `/api/ausencias` · `/api/lista-negra` (admin) · `/api/chatbot` (profesor/admin) · `/api/backup` (**solo admin**)

## Seguridad
El registro de profesor y admin exige las claves `PROFE_CODE` / `ADMIN_CODE` **en el servidor**. Cambiá `SESSION_SECRET` y las claves antes de publicar, y usá `NODE_ENV=production` con HTTPS.
