# 🏆 Porra Mundial 2026 — Guía completa v2.1

> **Versión actual: 2.1** · Junio 2026

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Backend Google Apps Script |
| `index.html` | Ranking, crónica del día, simulador, gráfico |
| `mis-picks.html` | Predicciones, joker, especiales |
| `bracket.html` | Cuadro del torneo |
| `reglas.html` | Reglas y puntuación |
| `perfil.html` | Perfil público de cada jugador |

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

Copiar la URL resultante:
```
https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec
```

### Paso 5 — Configurar el frontend

En los 4 archivos HTML (`index.html`, `mis-picks.html`, `bracket.html`, `perfil.html`) reemplazar:
```javascript
const SCRIPT_URL = "TU_WEBAPP_URL_AQUI";
// por:
const SCRIPT_URL = "https://script.google.com/macros/s/XXXX/exec";
```

> `reglas.html` no necesita URL (es estático).

### Paso 6 — Subir a cPanel

1. cPanel → Administrador de archivos → `public_html`
2. Crear carpeta `porra2026`
3. Subir los 5 HTML: `index.html`, `mis-picks.html`, `bracket.html`, `reglas.html`, `perfil.html`
4. Acceso: `https://tudominio.com/porra2026/`

### Paso 7 — Activar sincronización automática

En Apps Script ejecutar `setupTriggers()` → sincroniza resultados cada 5 minutos.

---

## MIGRACIÓN DESDE VERSIÓN ANTERIOR

Si ya tenías la porra instalada:

1. **Reemplazar `Code.gs`** en Apps Script → guardar
2. **Ejecutar `setup()`** → crea las hojas nuevas sin borrar las existentes
3. **Redesplegar la webapp** → Implementar → Gestionar implementaciones → Nueva versión
4. **Reemplazar los 5 HTML** en cPanel (añadir el nuevo `perfil.html`)
5. La columna `equipo_estrella` en `Predicciones_Especiales` se añade sola la primera vez que alguien guarda sus especiales

---

## SISTEMA DE PUNTUACIÓN

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

> La prórroga y los penaltis no cuentan para el marcador exacto, solo para determinar el ganador.

### ⭐ Equipo Estrella *(bonus permanente)*

Cada jugador elige un equipo antes del torneo. En cada partido donde juegue y aciertes (ganador o exacto), **+1 punto extra** automático.

### 🎰 Partido Joker *(×2, una vez en toda la porra)*

Activa el joker en cualquier partido antes del cierre. Los puntos de ese partido se **multiplican por 2**. No se puede cambiar ni cancelar.

### 🌟 Predicciones Especiales

| Predicción | Puntos |
|---|---|
| 🏆 Campeón del Mundial | **10 pts** |
| 🥈 Finalista | **5 pts** |
| 🏅 Semifinalista (×2, cada uno) | **4 pts** |
| 👟 Máximo Goleador | **8 pts** |
| 💥 Sorpresa (favorito que cae en grupos) | **6 pts** |

---

## FUNCIONALIDADES NUEVAS v2.0+

| Funcionalidad | Dónde |
|---|---|
| 🎭 Crónica del Día (comentario automático) | index.html |
| 📈 Gráfico evolución del ranking (colapsable) | index.html |
| 🎯 Simulador "¿Puedo alcanzar a...?" | index.html |
| 👤 Perfil público por jugador | perfil.html |
| 🏅 Sistema de logros (8 medallas) | perfil.html |
| 👁️ Ver picks de todos (tras cierre) | mis-picks.html |
| 📊 Consenso local/empate/visitante | mis-picks.html |
| 🎰 Joker (×2 en un partido) | mis-picks.html |
| ⭐ Equipo Estrella (+1 pt bonus) | mis-picks.html |
| ☰ Menú hamburguesa (móvil) | todas las páginas |
| 👋 Sesión compartida (nombre visible en toda la app) | todas las páginas |

---

## LOGROS DESBLOQUEABLES

| Icono | Nombre | Condición |
|---|---|---|
| 🎯 | El Quinielas | Primer exacto |
| 🔮 | Nostradamus con Balón | 5 exactos consecutivos |
| 💀 | Peor que el VAR | 3 partidos seguidos a 0 pts |
| 🐙 | Paul el Pulpo | >75% acierto (mín. 10 partidos) |
| 🏀 | ¿Esto es la NBA? | Exacto en partido con 4+ goles |
| 😴 | Copy-Paste FC | Mismo marcador en 8+ partidos |
| 🔥 | Hat-Trick de Sofá | 3 exactos en el mismo día |
| 🤡 | Seleccionador Nacional | 5 seguidos sin acertar el ganador |

---

## ENDPOINTS DISPONIBLES

| GET | Parámetros | Descripción |
|---|---|---|
| `getRanking` | — | Clasificación |
| `getMatches` | `fase`, `grupo` | Partidos |
| `getBracket` | — | Cuadro eliminatorio |
| `getPredictions` | `pid` | Picks de un jugador |
| `getMatchPredictions` | `mid` | Picks de todos en un partido (bloqueado) |
| `getGroupConsensus` | `grupo` | Consenso grupo completo |
| `getSpecials` | `pid` | Especiales de un jugador |
| `checkUser` | `nombre`, `pin` | Login |
| `getStats` | — | Estadísticas globales |
| `getMatchLockStatus` | — | Estado de bloqueo |
| `getDailyComment` | — | Crónica del día |
| `getHistory` | `pid` (opcional) | Historial ranking |
| `getProfile` | `pid` | Perfil completo |
| `getAchievements` | `pid` | Logros |
| `getJoker` | `pid` | Joker activo |
| `getTopScorers` | — | Goleadores |

| POST `action` | Body | Descripción |
|---|---|---|
| `register` | `{nombre, pin}` | Registro |
| `savePreds` | `{pid, preds}` | Guardar picks |
| `saveSpecials` | `{pid, campeon, finalista, semi1, semi2, goleador, sorpresa, equipo_estrella}` | Guardar especiales |
| `saveJoker` | `{pid, mid}` | Activar joker |

> ⚠️ Todos los POST usan `Content-Type: text/plain;charset=utf-8` para evitar el preflight CORS de Google Apps Script.

---

## NOTAS TÉCNICAS

**CORS en Google Apps Script**
Los POST deben enviarse con `Content-Type: text/plain;charset=utf-8`. Con `application/json` el navegador hace un preflight OPTIONS que Apps Script no responde, causando "Error de conexión".

**Sincronización automática**
`syncResults()` se ejecuta cada 5 minutos. Llama a `updatePartidos()`, `syncScorers()` y `calculateAllPoints()`. El snapshot diario del ranking se guarda una vez por día automáticamente.

**Perfil público**
Accesible en `perfil.html?pid=ID_DEL_JUGADOR`. El ID está en la hoja `Participantes`. Los nombres en el ranking son clicables y llevan al perfil.

---

*Porra Mundial 2026 v2.1 · Resultados via football-data.org (free tier)*
