# 🏆 Porra Mundial 2026 — Guía completa v4.0 (final)

> **Versión actual: 4.0 · Julio 2026 · Torneo finalizado**
> El campeón ya está revelado y la porra ha cerrado. Esta guía documenta el estado final de la app tal y como quedó desplegada.

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Backend Google Apps Script |
| `index.html` | Ranking, crónica del día, duelo del día, simulador, gráfico, pantalla de cierre y revelación del campeón |
| `mis-picks.html` | Predicciones, joker, especiales |
| `bracket.html` | Cuadro del torneo |
| `reglas.html` | Reglas y puntuación |
| `perfil.html` | Perfil público de cada jugador (incluye historial de duelos) |
| `novela.html` | "Novela del Mundial" — cronología narrativa con comentarios humorísticos de la evolución de cada jugador en el ranking |
| `admin.html` | Panel de administración: preguntas en vivo, logros manuales y control del bloqueo final (protegido por PIN) |
| `.github/workflows/deploy.yml` | Pipeline de despliegue automático |

---

## INFRAESTRUCTURA

| Componente | Detalle |
|---|---|
| Backend | Google Apps Script (gratuito) |
| Base de datos | Google Sheets |
| API de resultados | football-data.org (free tier) |
| Hosting | cPanel — clinicadentalmadrid.net/porra2026 |
| Repositorio | GitHub — javierlpz/porra-mundial-2026 |
| CI/CD | GitHub Actions → FTP a cPanel |

**URL de la app:** `https://clinicadentalmadrid.net/porra2026/`

---

## FLUJO DE TRABAJO (día a día — referencia por si hay que retocar algo)

```
Claude genera archivos → descargar → arrastrar a carpeta local del repo
→ GitHub Desktop: Commit to main → Push
→ GitHub Actions despliega automáticamente a cPanel (~30 segundos)
```

**Backend (`Code.gs`):** los cambios se despliegan desde el editor de Apps Script con
**Implementar → Gestionar implementaciones → ✏️ (editar) → Nueva versión → Implementar**,
sobre la implementación ya existente. **Nunca usar "Nueva implementación"**, porque genera
una URL distinta y rompe todos los HTML que ya apuntan a la URL antigua.

> Si el cambio de `Code.gs` toca la configuración de triggers, hay que volver a ejecutar
> `setupTriggers()` manualmente desde el editor — no se re-ejecuta solo al desplegar.

---

## CONFIGURACIÓN DEL PIPELINE (ya hecho, solo para referencia)

### GitHub Secrets (Settings → Secrets → Actions → Repository secrets)

| Secret | Valor |
|---|---|
| `FTP_SERVER` | `185.156.219.32` |
| `FTP_USERNAME` | `javierlopez@soydentaria.com` |
| `FTP_PASSWORD` | contraseña de la cuenta FTP |

> ⚠️ Usar la IP directa, no `ftp.soydentaria.com` — el dominio no resuelve.

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to cPanel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via FTP
        uses: SamKirkland/FTP-Deploy-Action@v4.3.5
        with:
          server: ${{ secrets.FTP_SERVER }}
          username: ${{ secrets.FTP_USERNAME }}
          password: ${{ secrets.FTP_PASSWORD }}
          local-dir: ./
          server-dir: /
          exclude: |
            **/.git*
            **/.git*/**
            INSTRUCCIONES.md
            Code.gs
            README.md
```

> `server-dir: /` porque el usuario FTP `javierlopez@soydentaria.com` tiene como raíz directamente la carpeta `porra2026`.
> Cualquier ruta adicional crearía subcarpetas incorrectas.

---

## INSTALACIÓN DESDE CERO (por si se reutiliza para un futuro torneo)

### Paso 1 — Google Sheet

1. Ir a [sheets.google.com](https://sheets.google.com) → crear hoja nueva → **"Porra Mundial 2026"**
2. Anotar el ID (en la URL entre `/d/` y `/edit`)

### Paso 2 — Apps Script

1. Dentro de la hoja → **Extensiones → Apps Script**
2. Borrar el código por defecto
3. Pegar el contenido de `Code.gs`
4. Guardar como **"Porra2026"**
5. Seleccionar función **`setup`** → ▶️ Ejecutar → aceptar permisos

Hojas creadas automáticamente:

| Hoja | Uso |
|---|---|
| `Participantes` | Registro de jugadores |
| `Partidos` | Fixture + resultados |
| `Predicciones` | Picks de cada jugador |
| `Predicciones_Especiales` | Campeón, goleador, estrella… |
| `Puntuaciones` | Ranking en tiempo real |
| `Historico_Ranking` | Snapshot diario (para el gráfico y la novela) |
| `Partido_Doble` | Jokers activados |
| `Goleadores` | Clasificación de goleadores |
| `Retos` | Sistema de retos manuales (histórico, solo activo durante fase de grupos) |
| `Duelos` | Duelos automáticos obligatorios (fase eliminatoria, a partir de octavos) |
| `Logros_Manuales` | Logros especiales concedidos a mano por el admin (familia López) |
| `Preguntas_Vivo` | Preguntas sorpresa lanzadas por el admin durante partidos en directo |
| `Respuestas_Vivo` | Respuestas de los jugadores a las preguntas en vivo |

### Paso 3 — API de football-data.org

1. Registrarse gratis en [football-data.org](https://www.football-data.org/client/register)
2. En Apps Script → ejecutar en consola:
```javascript
setApiKey("tu_token_aqui")
```
3. Verificar con `testApiConnection()`

### Paso 4 — Desplegar como API web

Apps Script → **Implementar → Nueva implementación**
- Tipo: **Aplicación web**
- Ejecutar como: **Yo**
- Acceso: **Cualquier usuario**

Copiar la URL:
```
https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec
```

> Esta URL solo se genera una vez, en la primera implementación. Todas las actualizaciones
> posteriores de `Code.gs` se publican con "Nueva versión" sobre esta misma implementación
> (ver sección FLUJO DE TRABAJO), nunca creando una implementación nueva.

### Paso 5 — Configurar el frontend

En los archivos HTML que llaman al backend (`index.html`, `mis-picks.html`, `bracket.html`, `perfil.html`, `novela.html`, `admin.html`) reemplazar:
```javascript
const SCRIPT_URL = "TU_WEBAPP_URL_AQUI";
```

> `reglas.html` no necesita URL (es estático).

### Paso 6 — Configurar GitHub + despliegue automático

1. Crear repo en GitHub (privado)
2. Añadir los 3 Repository secrets (ver tabla arriba)
3. Crear `.github/workflows/deploy.yml` con el contenido de arriba
4. Hacer push → GitHub Actions despliega a cPanel automáticamente

### Paso 7 — Activar sincronización automática

En Apps Script ejecutar `setupTriggers()`. Crea tres triggers:
- `syncResults()` cada 5 minutos.
- `generateDailyDuels()` una vez al día (medianoche, hora Madrid) — genera los emparejamientos obligatorios de duelos cuando hay partidos de eliminatoria ese día.
- `checkAutoLock()` cada 5 minutos — activa automáticamente la pantalla de cierre final a la hora configurada (ver sección "Cierre final y revelación del campeón").

### Paso 8 — Configurar el PIN de administración

El PIN de admin (`ADMIN_PIN` en `admin.html`, `ADMIN_PIN_BLOQUEO` en `Code.gs`) está hardcodeado
como `2901`. Protege el lanzamiento de preguntas en vivo, la concesión de logros manuales y el
control del bloqueo final. Cambiarlo en ambos sitios si se quiere rotar.

---

## MIGRACIÓN DESDE VERSIÓN ANTERIOR

1. **Reemplazar `Code.gs`** en Apps Script → guardar
2. **Ejecutar `setup()`** → crea las hojas nuevas sin borrar las existentes
3. **Redesplegar la webapp** → Implementar → Gestionar implementaciones → **Nueva versión** (nunca "Nueva implementación")
4. Si el cambio afecta a triggers, volver a ejecutar `setupTriggers()` manualmente
5. **Push al repo** → GitHub Actions despliega los HTML automáticamente
6. La columna `equipo_estrella` se añade sola la primera vez que alguien guarda sus especiales

---

## SISTEMA DE PUNTUACIÓN

> `calculatePoints()` es la única fuente de verdad: recalcula los puntos de cada jugador
> desde cero en cada ejecución. Nunca hay que escribir puntos directamente en la hoja
> `Puntuaciones`, porque la siguiente ejecución los sobrescribiría.

### Fase de Grupos

| Acierto | Puntos |
|---|---|
| Resultado exacto | **4 pts** |
| Ganador o empate correcto | **2 pts** |
| Clasificado de grupo correcto | **3 pts** |
| 1º y 2º del grupo exactos (en orden) | **5 pts** |

### Fase Eliminatoria (por partido)

| Acierto | Puntos |
|---|---|
| Aciertas el equipo clasificado | **4 pts** |
| Bonus: resultado exacto en 90 min | **+3 pts** (total 7 pts si aciertas ambos) |

> La prórroga y los penaltis **no** cuentan para el marcador exacto, solo para determinar
> quién avanza. `updatePartidos()` usa `score.regularTime` (no `fullTime`) para guardar el
> marcador que se puntúa, y una columna aparte `ganador_final` guarda quién avanzó realmente
> a la siguiente ronda (calculado comparando `regularTime` + `extraTime` + `penalties`, no el
> campo `winner` de la API, que puede ser inestable justo al terminar el partido). Son dos
> datos independientes: puedes acertar el marcador de 90' y fallar quién pasa (si se decidió
> en penaltis), o viceversa.

### ⭐ Equipo Estrella *(bonus permanente)*

Cada jugador elige un equipo antes del torneo. En cada partido donde juegue y aciertes, **+1 punto extra** automático.

### 🎰 Partido Joker *(×2, una vez en toda la porra)*

Activa el joker en cualquier partido antes del cierre. Los puntos se **multiplican por 2**. No se puede cambiar ni cancelar.

### 🌟 Predicciones Especiales

| Predicción | Puntos |
|---|---|
| 🏆 Campeón del Mundial (gana la final) | **10 pts** |
| 🥈 Finalista perdedor (pierde la final) | **5 pts** |
| 🏅 Semifinalista (×2, cada uno) | **4 pts** |
| 👟 Máximo Goleador | **8 pts** |
| 💥 Sorpresa (favorito que cae en grupos) | **6 pts** |

> **Categorías independientes y acumulables.** Si un jugador predice a un equipo como Semifinalista y ese equipo acaba siendo Campeón, cobra ambos: 4 pts + 10 pts. `getSemiFinalists()` devuelve los 4 equipos que jugaron semifinales sin excluir al futuro campeón/subcampeón. La única incompatibilidad es Campeón vs. Finalista perdedor, porque `getFinalWinner()` y `getFinalLoser()` son resultados opuestos del mismo partido (no se puede acertar ambos a la vez para el mismo equipo).

### 🥊 Duelos automáticos (fase eliminatoria)

A partir de octavos de final, cada día con partidos de eliminatoria el sistema empareja
**automática y obligatoriamente** a todos los jugadores activos (barajados, uno a uno; si
el número es impar alguien descansa ese día sin penalización). Nadie elige rival ni puede
rechazar el duelo.

- El que más puntos saca ese día en los partidos jugados gana el duelo: **+1** al ganador, **−1** al perdedor en el ranking general. Empate: sin cambios.
- Cuentan todos los puntos del día: exacto, ganador, joker y equipo estrella si aplican.
- El duelo se resuelve en cuanto terminan todos los partidos del día (`resolveDailyDuels()`, con guarda para no resolver antes de tiempo).
- **La resolución es "de un solo disparo":** una vez marcado `resuelto = true`, queda congelado. Si hay que corregir un marcador después de resolver, hay que resetear el duelo a `aceptado` (`resetDuelos(fecha)`) antes de volver a `resolveDailyDuels()`.
- El sistema de retar manualmente a quien quisieras (`crearReto` / hoja `Retos`) se usó **solo durante la fase de grupos** y ya no está disponible; su historial se conserva y se fusiona en el perfil del jugador junto con los duelos automáticos.

### ⚡ Preguntas en vivo *(admin)*

Durante un partido en directo, el admin puede lanzar desde `admin.html` (protegido por PIN)
una pregunta sorpresa con varias opciones, puntos configurables y un temporizador de cierre
(`createLiveQuestion`). Aparece como pop-up a los jugadores con cuenta atrás; al enviar
respuesta se guarda en `Respuestas_Vivo` y los puntos, si aciertan, fluyen a través de
`calculatePoints()` igual que el resto de puntuaciones. El panel genera automáticamente un
mensaje de WhatsApp listo para copiar y avisar al grupo. Solo puede haber una pregunta activa
a la vez; se resuelve con `resolveLiveQuestion` o se puede cancelar con `deleteLiveQuestion`.

### 🏅 Logros manuales *(admin)*

Además de los 8 logros automáticos, el admin puede conceder a mano desde `admin.html`
(protegido por PIN) dos logros especiales de la "familia López", almacenados en
`Logros_Manuales`:

| Icono | Nombre | Descripción |
|---|---|---|
| 💀 | Extinción López | Ha eliminado a toda la familia. Es una catástrofe natural. |
| 🏰 | El fin de la Dinastía | Los López cayeron uno a uno. Nadie sobrevivió para contarlo. |

---

## 🔒 CIERRE FINAL Y REVELACIÓN DEL CAMPEÓN

Sistema pensado para dar suspense al último tramo del torneo: bloquea la app la noche antes
de conocerse el resultado de la final y, cuando el admin lo desactiva, dispara la
celebración del campeón para todo el mundo a la vez.

**Estado y flags** (guardados en `PropertiesService`, no en Sheets, porque son solo 3-4 flags
de singleton que se leen en cada carga de página):

| Flag | Significado |
|---|---|
| `BLOQUEO_ACTIVO` | `'true'`/`'false'` — si está activo, todos los usuarios ven la pantalla de cierre |
| `BLOQUEO_HORA_DESBLOQUEO` | Hora objetivo (ISO) mostrada en el countdown — solo informativa, el desbloqueo real siempre lo dispara el admin a mano |
| `BLOQUEO_AUTO_DONE` | `'true'` una vez que el trigger automático (o el admin) ha activado el bloqueo, para que no se reactive solo si luego se desactiva |
| `PORRA_FINALIZADA` | `'true'` tras revelar al campeón — mantiene el banner fijo para cualquiera que entre después |
| `REVEAL_TRIGGERED_AT` | Timestamp de la revelación, para que cada navegador sepa si es un evento "nuevo" y reproduzca la animación una vez |

**Flujo:**

1. `checkAutoLock()` (trigger cada 5 min) activa el bloqueo automáticamente la primera vez que
   la hora en Madrid alcanza `BLOQUEO_HORA_ACTIVACION` (`22:10`), salvo que el admin ya lo haya
   activado o desactivado a mano antes (`BLOQUEO_AUTO_DONE` lo evita).
2. Mientras `BLOQUEO_ACTIVO = true`, `index.html` muestra un overlay de cierre con vídeo,
   countdown hasta `BLOQUEO_HORA_DESBLOQUEO` y un contador de "gente esperando" en vivo
   (`pingWaiting`, guardado en `CacheService` con ventana de 10 minutos, no en Sheets, porque
   es un dato efímero).
3. El admin desactiva el bloqueo desde `admin.html` (`setLockStatus({activo:false, pin})`).
   **Esto dispara automáticamente la revelación**: todos los navegadores en la pantalla de
   cierre pasan a un podio en suspense (top 3 animado) seguido de un banner fijo con el
   nombre del campeón, mensaje generado y confeti. Cada navegador lo reproduce una sola vez
   (se marca en `localStorage`); si recarga después, solo ve el banner fijo.
4. Si hace falta retirar la celebración por completo (p. ej. para corregir algo), el admin
   usa `retirarCierre` — nadie vuelve a ver el popup aunque recargue.
5. `resetBloqueo()` (solo desde el editor de Apps Script) borra todos los flags, útil para
   repetir la secuencia en pruebas o en un futuro torneo.

> El PIN de esta sección es el mismo `2901` (`ADMIN_PIN_BLOQUEO`).

---

## 📖 NOVELA DEL MUNDIAL

`novela.html` construye, a partir de `getHistory` (snapshots diarios de `Historico_Ranking`),
una cronología narrativa por jugador: sube/baja de puestos, entra o sale del podio, pierde o
gana el liderato, toca fondo en el último puesto, etc. Cada movimiento se categoriza por
magnitud (subida/bajada pequeña, grande, "mega") y se le asigna una frase humorística sacada
de un banco de frases por categoría (sin repetir dentro de la misma novela — se consumen de
una cola barajada). Se accede desde un selector de jugador o directamente vía
`novela.html?pid=...`.

Un popup promocional en `index.html` (`checkNovelaPromo()`) anuncia la sección la primera vez
que hay suficiente histórico (al menos 2 días distintos de datos), con enlace directo a "mi
novela" si el usuario tiene sesión iniciada.

---

## FUNCIONALIDADES

| Funcionalidad | Dónde |
|---|---|
| 🎭 Crónica del Día (comentario automático) | index.html |
| 📈 Gráfico evolución del ranking (colapsable) | index.html |
| 🎯 Simulador "¿Puedo alcanzar a...?" | index.html |
| 🥊 Duelo del Día (duelos automáticos, fase eliminatoria) | index.html |
| 🔒 Pantalla de cierre + revelación del campeón (podio + banner) | index.html (jugador) / admin.html (control) |
| 👤 Perfil público por jugador (incluye historial de duelos) | perfil.html |
| 🏅 Sistema de logros (8 automáticos + 2 manuales) | perfil.html |
| 📖 Novela del Mundial (cronología narrativa por jugador) | novela.html |
| 👁️ Ver picks de todos (tras cierre) | mis-picks.html |
| 📊 Consenso local/empate/visitante | mis-picks.html |
| 🎰 Joker (×2 en un partido) | mis-picks.html |
| ⭐ Equipo Estrella (+1 pt bonus) | mis-picks.html |
| ⚡ Preguntas en vivo durante partidos | index.html (jugador) / admin.html (lanzamiento) |
| 🏅 Concesión de logros manuales | admin.html |
| ☰ Menú hamburguesa (móvil) | todas las páginas |
| 👋 Sesión compartida en toda la app | todas las páginas |

---

## LOGROS DESBLOQUEABLES

### Automáticos

| Icono | Nombre | Condición |
|---|---|---|
| 🎯 | El Quinielas | Primer exacto |
| 🔮 | Nostradamus con Balón | 5 exactos consecutivos |
| 💀 | Peor que el VAR | 3 partidos seguidos a 0 pts |
| 🐙 | Paul el Pulpo | >75% acierto (mín. 10 partidos) |
| 🏀 | ¿Esto es la NBA? | Exacto en un partido con 4+ goles |
| 😴 | Copy-Paste FC | Mismo marcador en 8+ partidos |
| 🔥 | Hat-Trick de Sofá | 3 exactos en el mismo día |
| 🤡 | Seleccionador Nacional | 5 partidos seguidos sin acertar el ganador |

### Manuales *(concedidos por admin)*

| Icono | Nombre | Condición |
|---|---|---|
| 💀 | Extinción López | Ha eliminado a toda la familia López. |
| 🏰 | El fin de la Dinastía | Los López cayeron uno a uno. |

---

## ENDPOINTS DISPONIBLES

| GET | Parámetros | Descripción |
|---|---|---|
| `getRanking` | — | Clasificación |
| `getMatches` | `fase`, `grupo` | Partidos |
| `getBracket` | — | Cuadro eliminatorio |
| `getPredictions` | `pid` | Picks de un jugador |
| `getMatchPredictions` | `mid` | Picks de todos (solo partidos bloqueados) |
| `getGroupConsensus` | `grupo` | Consenso de un grupo completo |
| `getSpecials` | `pid` | Especiales de un jugador |
| `checkUser` | `nombre`, `pin` | Login |
| `getStats` | — | Estadísticas globales |
| `getMatchLockStatus` | — | Estado de bloqueo de partidos |
| `getDailyComment` | — | Crónica del día |
| `getHistory` | `pid` (opcional) | Historial ranking (usado por gráfico y novela) |
| `getProfile` | `pid` | Perfil completo |
| `getAchievements` | `pid` | Logros (automáticos + manuales) de un jugador |
| `getRecentAchievements` | — | Logros conseguidos recientemente (popup de novedades) |
| `getJoker` | `pid` | Joker activo |
| `getTopScorers` | — | Goleadores |
| `getActiveLiveQuestion` | `pid` | Pregunta en vivo activa (si hay alguna lanzada) |
| `getLiveAnswers` | `qid` | Respuestas/tally de una pregunta en vivo |
| `getDuelos` | — | Todos los duelos (uso interno/admin) |
| `getDuelosJugador` | `pid` | Duelos automáticos (activo + historial) de un jugador |
| `getRetos` | `pid` | Retos manuales (histórico, fase de grupos) |
| `getRetosGlobales` | — | Todos los retos manuales (uso interno/admin) |
| `getLockStatus` | — | Estado del bloqueo final (activo, hora objetivo, gente esperando, si ya se reveló al campeón) |

| POST `action` | Body | Descripción |
|---|---|---|
| `register` | `{nombre, pin}` | Registro |
| `savePreds` | `{pid, preds}` | Guardar picks |
| `saveSpecials` | `{pid, campeon, finalista, semi1, semi2, goleador, sorpresa, equipo_estrella}` | Guardar especiales |
| `saveJoker` | `{pid, mid}` | Activar joker |
| `saveLiveAnswer` | `{qid, pid, respuesta}` | Guardar respuesta a una pregunta en vivo |
| `createLiveQuestion` *(admin)* | `{partido_id, pregunta, opciones, puntos, minutos}` | Lanzar pregunta en vivo |
| `resolveLiveQuestion` *(admin)* | `{qid, respuesta_correcta}` | Resolver pregunta y repartir puntos |
| `deleteLiveQuestion` *(admin)* | `{qid}` | Cancelar pregunta activa |
| `crearReto` | `{retadorId, retadorNombre, retadoId, retadoNombre, partidoId}` | Crear reto manual (solo se usó en fase de grupos) |
| `responderReto` | `{retoId, pid, accion}` | Aceptar/rechazar un reto manual |
| `grantManualAchievement` *(admin)* | `{pid, achievementId, pin}` | Conceder logro manual |
| `pingWaiting` | `{pid}` | Marca a un jugador como "esperando" en la pantalla de cierre |
| `setLockStatus` *(admin)* | `{activo, pin}` | Activa/desactiva el bloqueo final — desactivarlo dispara la revelación del campeón |
| `retirarCierre` *(admin)* | `{pin}` | Retira la celebración del campeón por completo |

---

## GLOSARIO DE APRENDIZAJES TÉCNICOS

**Puntuación de eliminatorias**
La columna `ganador_final` guarda por separado quién avanzó realmente a la siguiente ronda,
calculada comparando `regularTime` + `extraTime` + `penalties`, no el campo `winner` de la
API (inestable justo al terminar el partido). `regularTime` es el campo estable para el
marcador que se puntúa. El plan gratuito no da resultados en directo durante el partido.

**Triggers**
`setupTriggers()` debe volver a ejecutarse manualmente desde el editor de Apps Script cada vez
que se despliega un cambio en `Code.gs` que afecte a la configuración de triggers (no se
re-aplica solo con el deploy). Son tres: `syncResults()` (5 min), `generateDailyDuels()`
(medianoche) y `checkAutoLock()` (5 min).

**Deployment**
Siempre "Nueva versión" sobre la implementación existente. Nunca "Nueva implementación"
(cambiaría la URL y rompería todos los HTML ya desplegados).

**Edición de archivos**
Empezar siempre desde el archivo fuente original. No parchear un archivo ya parcheado — los
parches acumulados corrompen el código.

**FTP — IP directa**
El dominio `ftp.soydentaria.com` no resuelve. Usar siempre la IP `185.156.219.32`.

**server-dir en deploy.yml**
El usuario FTP `javierlopez@soydentaria.com` tiene como raíz directamente la carpeta
`porra2026`. Por eso `server-dir: /`. Cualquier ruta adicional crea subcarpetas incorrectas.

**Sincronización automática**
`syncResults()` se ejecuta cada 5 minutos. Llama a `updatePartidos()`, `syncScorers()` y
`calculateAllPoints()`. El snapshot diario del ranking se guarda una vez por día
automáticamente (fuente de `getHistory`, usado por el gráfico de evolución y por la novela).
`generateDailyDuels()` se ejecuta a medianoche (hora Madrid) y solo genera emparejamientos si
hay partidos de fase eliminatoria programados ese día.

**Cierre final**
Los flags de `PropertiesService` (`BLOQUEO_ACTIVO`, `BLOQUEO_AUTO_DONE`, `PORRA_FINALIZADA`,
`REVEAL_TRIGGERED_AT`) son deliberadamente independientes de Sheets — son estado efímero de
singleton, no datos que haya que auditar o cruzar con otras hojas. `resetBloqueo()` los borra
todos de golpe si hay que repetir la secuencia.

---

## ESTADO FINAL DEL PROYECTO

El torneo se completó con todas las fases funcionando según lo diseñado: fase de grupos con
predicciones y retos manuales, fase eliminatoria con duelos automáticos obligatorios, preguntas
en vivo durante partidos, logros automáticos y manuales, y el cierre final con revelación del
campeón. No hay desarrollo activo previsto; esta guía queda como referencia por si se reutiliza
la base para un futuro torneo.

Ideas que se llegaron a discutir pero no se implementaron, por si sirven de punto de partida:
- Simulador de puntos mejorado (puntos totales posibles, puntos del día, comentarios con humor).
- PWA "añadir a pantalla de inicio" (prompt nativo en Android Chrome, banner manual en iOS Safari) — explorado a nivel de arquitectura, no implementado.
- Player of the Match: descartado, football-data.org free tier no expone ese dato.

---

*Porra Mundial 2026 v4.0 (final) · Resultados vía football-data.org (free tier)*
