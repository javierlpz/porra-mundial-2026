# 🏆 Porra Mundial 2026 — Guía completa v3.0

> **Versión actual: 3.0** · Julio 2026 · Fase eliminatoria en curso

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Backend Google Apps Script |
| `index.html` | Ranking, crónica del día, duelo del día, simulador, gráfico |
| `mis-picks.html` | Predicciones, joker, especiales |
| `bracket.html` | Cuadro del torneo |
| `reglas.html` | Reglas y puntuación |
| `perfil.html` | Perfil público de cada jugador (incluye historial de duelos) |
| `admin.html` | Panel de administración: preguntas en vivo + logros manuales (protegido por PIN) |
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

## FLUJO DE TRABAJO (día a día)

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

> `server-dir: /` porque el usuario FTP `javierlopez@soydentaria.com` tiene como raíz directamente la carpeta `porra2026`. Cualquier ruta adicional crearía subcarpetas incorrectas.

---

## INSTALACIÓN DESDE CERO

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
| `Historico_Ranking` | Snapshot diario (para el gráfico) |
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

En los archivos HTML que llaman al backend (`index.html`, `mis-picks.html`, `bracket.html`, `perfil.html`, `admin.html`) reemplazar:
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

En Apps Script ejecutar `setupTriggers()`. Crea dos triggers:
- `syncResults()` cada 5 minutos.
- `generateDailyDuels()` una vez al día (medianoche, hora Madrid) — genera los emparejamientos obligatorios de duelos cuando hay partidos de eliminatoria ese día.

### Paso 8 — Configurar el PIN de administración

El PIN de admin (`admin.html`) está hardcodeado como constante `ADMIN_PIN` en el propio archivo. Protege el lanzamiento de preguntas en vivo y la concesión de logros manuales. Cambiarlo ahí si se quiere rotar.

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

### Fase Eliminatoria

| Acierto | Puntos |
|---|---|
| Resultado exacto (90 min) | **7 pts** |
| Solo el equipo ganador | **4 pts** |

> La prórroga y los penaltis **no** cuentan para el marcador exacto, solo para determinar
> quién avanza. `updatePartidos()` usa `score.regularTime` (no `fullTime`) para guardar el
> marcador que se puntúa, y una columna aparte `ganador_final` guarda quién avanzó realmente
> a la siguiente ronda. Son dos datos independientes: puedes acertar el marcador de 90' y
> fallar quién pasa (si se decidió en penaltis), o viceversa.

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
una pregunta sorpresa con varias opciones, puntos configurables y un temporizador de cierre.
Aparece como pop-up a los jugadores con cuenta atrás; al enviar respuesta se guarda en
`Respuestas_Vivo` y los puntos, si aciertan, fluyen a través de `calculatePoints()` igual que
el resto de puntuaciones. El panel genera automáticamente un mensaje de WhatsApp listo para
copiar y avisar al grupo.

### 🏅 Logros manuales *(admin)*

Además de los 8 logros automáticos, el admin puede conceder a mano desde `admin.html`
(protegido por PIN) dos logros especiales de la "familia López", almacenados en
`Logros_Manuales`:

| Icono | Nombre | Descripción |
|---|---|---|
| 💀 | Extinción López | Ha eliminado a toda la familia. Es una catástrofe natural. |
| 🏰 | El fin de la Dinastía | Los López cayeron uno a uno. Nadie sobrevivió para contarlo. |

---

## FUNCIONALIDADES

| Funcionalidad | Dónde |
|---|---|
| 🎭 Crónica del Día (comentario automático) | index.html |
| 📈 Gráfico evolución del ranking (colapsable) | index.html |
| 🎯 Simulador "¿Puedo alcanzar a...?" | index.html |
| 🥊 Duelo del Día (duelos automáticos, fase eliminatoria) | index.html |
| 👤 Perfil público por jugador (incluye historial de duelos) | perfil.html |
| 🏅 Sistema de logros (8 automáticos + 2 manuales) | perfil.html |
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

### Manuales *(concedidos por admin, ver sección Duelos automáticos / Logros manuales)*

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
| `getHistory` | `pid` (opcional) | Historial ranking |
| `getProfile` | `pid` | Perfil completo |
| `getAchievements` | `pid` | Logros (automáticos + manuales) de un jugador |
| `getRecentAchievements` | — | Logros conseguidos recientemente (popup de novedades) |
| `getJoker` | `pid` | Joker activo |
| `getTopScorers` | — | Goleadores |
| `getRetos` | `pid` | Retos manuales (activos + historial, fase de grupos) |
| `getDuelosJugador` | `pid` | Duelos automáticos (activo + historial) de un jugador |
| `getActiveQuestion` | — | Pregunta en vivo activa (si hay alguna lanzada) |

| POST `action` | Body | Descripción |
|---|---|---|
| `register` | `{nombre, pin}` | Registro |
| `savePreds` | `{pid, preds}` | Guardar picks |
| `saveSpecials` | `{pid, campeon, finalista, semi1, semi2, goleador, sorpresa, equipo_estrella}` | Guardar especiales |
| `saveJoker` | `{pid, mid}` | Activar joker |
| `crearReto` | `{retadorId, retadorNombre, retadoId, retadoNombre, partidoId}` | Crear reto manual (solo fase de grupos) |
| `responderReto` | `{retoId, pid, accion}` | Aceptar/rechazar un reto manual |
| `saveLiveAnswer` | `{qid, pid, respuesta}` | Guardar respuesta a una pregunta en vivo |
| `createQuestion` *(admin)* | `{pregunta, opciones, puntos, minutos}` | Lanzar pregunta en vivo |
| `grantLogro` *(admin)* | `{pid, achievementId, pin}` | Conceder logro manual |

---

## FUNCIONES DE MANTENIMIENTO (Apps Script, ejecución manual)

| Función | Uso |
|---|---|
| `setup()` | Crea/actualiza todas las hojas necesarias |
| `setApiKey(key)` | Guarda el token de football-data.org |
| `testApiConnection()` | Verifica que la API responde |
| `setupTriggers()` | Configura `syncResults` (5 min) y `generateDailyDuels` (medianoche) |
| `generateDailyDuels()` | Genera los emparejamientos del día si hay partidos de eliminatoria |
| `resolveDailyDuels()` | Resuelve los duelos del día cuando terminan todos los partidos |
| `resetDuelos(fecha)` | Resetea los duelos de una fecha a `pendiente` para poder recalcularlos tras una corrección |
| `fixDuelosResueltos()` | Recalcula en bloque todos los duelos ya resueltos tras un fix de marcador |
| `fixMarcadoresEliminatoria()` | Corrección retroactiva de marcadores de eliminatoria (uso puntual, ya ejecutada) |

---

## NOTAS TÉCNICAS IMPORTANTES

**CORS en Google Apps Script**
Todos los POST usan `Content-Type: text/plain;charset=utf-8`. Con `application/json` el navegador hace un preflight OPTIONS que Apps Script no responde, causando "Error de conexión".

**Fechas y zona horaria (Europe/Madrid)**
Google Sheets auto-parsea strings ISO de fecha/hora a objetos `Date` nativos al guardarlos en una celda. `String(date).slice(0,10)` da un resultado poco fiable (`"Sat Jul 04 2026..."`) y nunca coincide con un `"yyyy-MM-dd"`. Usar siempre el helper `fechaMadrid(raw)`, que hace `instanceof Date` primero y aplica `Utilities.formatDate(d, 'Europe/Madrid', 'yyyy-MM-dd')` tanto si `raw` es un `Date` real como si es un string ISO.

**`calculatePoints()` es la fuente de verdad**
Los puntos se recalculan desde cero en cada ejecución a partir de predicciones, especiales, joker, duelos y preguntas en vivo. Nunca escribir puntos directamente en `Puntuaciones`: la siguiente ejecución los sobrescribiría.

**Resolución de duelos: "one-shot"**
Una vez que un duelo tiene `resuelto = true`, queda congelado. Ante una corrección retroactiva de marcador hay que resetear explícitamente el estado a `aceptado` (`resetDuelos()`) antes de recalcular (`resolveDailyDuels()` o `fixDuelosResueltos()`).

**Marcador de 90' vs. resultado final (eliminatorias)**
`updatePartidos()` usa `score.regularTime` (no `fullTime`) para el marcador que se puntúa, evitando incluir prórroga/penaltis. La columna `ganador_final` guarda por separado quién avanzó realmente a la siguiente ronda. El campo `winner` de football-data.org es inestable justo después de acabar el partido; `regularTime` es estable. El plan gratuito no da resultados en directo durante el partido.

**Triggers**
`setupTriggers()` debe volver a ejecutarse manualmente desde el editor de Apps Script cada vez que se despliega un cambio en `Code.gs` que afecte a la configuración de triggers (no se re-aplica solo con el deploy).

**Deployment**
Siempre "Nueva versión" sobre la implementación existente. Nunca "Nueva implementación" (cambiaría la URL y rompería todos los HTML ya desplegados).

**Edición de archivos**
Empezar siempre desde el archivo fuente original. No parchear un archivo ya parcheado — los parches acumulados corrompen el código.

**FTP — IP directa**
El dominio `ftp.soydentaria.com` no resuelve. Usar siempre la IP `185.156.219.32`.

**server-dir en deploy.yml**
El usuario FTP `javierlopez@soydentaria.com` tiene como raíz directamente la carpeta `porra2026`. Por eso `server-dir: /`. Cualquier ruta adicional crea subcarpetas incorrectas.

**Sincronización automática**
`syncResults()` se ejecuta cada 5 minutos. Llama a `updatePartidos()`, `syncScorers()` y `calculateAllPoints()`. El snapshot diario del ranking se guarda una vez por día automáticamente. `generateDailyDuels()` se ejecuta a medianoche (hora Madrid) y solo genera emparejamientos si hay partidos de fase eliminatoria programados ese día.

---

## PENDIENTE / EN EL HORIZONTE

- Verificar que `syncResults` y `getMatches` no filtren accidentalmente los partidos que no son `GROUP_STAGE`.
- Revisar `reglas.html` por si quedan fechas de cierre desactualizadas.
- Simulador de puntos mejorado: contexto de todo el torneo, comentarios con humor, botón "¿Puedo ganar?".
- PWA "añadir a pantalla de inicio" (prompt nativo en Android Chrome, banner manual en iOS Safari) — explorado a nivel de arquitectura, no implementado.
- Player of the Match: descartado por ahora, football-data.org free tier no expone ese dato.

---

*Porra Mundial 2026 v3.0 · Resultados vía football-data.org (free tier)*
