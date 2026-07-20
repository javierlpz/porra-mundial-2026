// ============================================================
//  PORRA MUNDIAL 2026 — Google Apps Script Backend v2.1
//  Fix: savePredictions ya no bloquea partidos sin kickoff
// ============================================================

const COMPETITION_ID = 2000;
const API_BASE = 'https://api.football-data.org/v4';

const FAVORITES = [
  'Brazil','Argentina','France','England','Spain','Germany',
  'Portugal','Netherlands','Belgium','Uruguay','Croatia',
  'Colombia','USA','United States'
];

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('FOOTBALL_API_KEY');
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`Hoja "${name}" no encontrada. Ejecuta setup() primero.`);
  return sheet;
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a1f35').setFontColor('#ffffff').setFontWeight('bold');
  }
  return sheet;
}

function hashPin(pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(pin));
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function winner(g1, g2) {
  if (g1 > g2) return 'H';
  if (g1 < g2) return 'A';
  return 'D';
}

// Devuelve la fecha actual en Madrid como "YYYY-MM-DD"
function todayMadrid() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}

/**
 * Convierte un valor de fecha/hora (Date real o string ISO, tal y como puede
 * venir de una celda de Sheets) al día de calendario en Madrid, formato
 * yyyy-MM-dd. Nunca usar String(valor).slice(0,10) para esto: si la celda es
 * un Date de verdad, String() da "Sat Jul 04 2026..." y la comparación con
 * un "yyyy-MM-dd" nunca coincide.
 */
function fechaMadrid(raw) {
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Europe/Madrid', 'yyyy-MM-dd');
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  PUNTOS DE ENTRADA HTTP
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  const action = (e.parameter.action || '').trim();
  try {
    switch (action) {
      case 'getRanking':          return jsonResponse(getRanking());
      case 'getMatches':          return jsonResponse(getMatches(e.parameter.fase, e.parameter.grupo));
      case 'getBracket':          return jsonResponse(getBracket());
      case 'getPredictions':      return jsonResponse(getPredictions(e.parameter.pid));
      case 'getMatchPredictions': return jsonResponse(getMatchPredictions(e.parameter.mid));
      case 'getGroupConsensus':   return jsonResponse(getGroupConsensus(e.parameter.grupo));
      case 'getSpecials':         return jsonResponse(getSpecials(e.parameter.pid));
      case 'checkUser':           return jsonResponse(checkUser(e.parameter.nombre, e.parameter.pin));
      case 'getStats':            return jsonResponse(getStats());
      case 'getMatchLockStatus':  return jsonResponse(getMatchLockStatus());
      case 'getDailyComment':     return jsonResponse(getDailyComment());
      case 'getHistory':          return jsonResponse(getHistory(e.parameter.pid));
      case 'getProfile':          return jsonResponse(getProfile(e.parameter.pid));
      case 'getAchievements':        return jsonResponse(getAchievements(e.parameter.pid));
      case 'getRecentAchievements':  return jsonResponse(getRecentAchievements());
      case 'getJoker':               return jsonResponse(getJoker(e.parameter.pid));
      case 'getTopScorers':         return jsonResponse(getTopScorers());
      case 'getActiveLiveQuestion': return jsonResponse(getActiveLiveQuestion(e.parameter.pid));
      case 'getLiveAnswers':        return jsonResponse(getLiveAnswers(e.parameter.qid));
      case 'getDuelos':             return jsonResponse(getDuelos());
      case 'getDuelosJugador':      return jsonResponse(getDuelosJugador(e.parameter.pid));
      case 'getRetos':              return jsonResponse(getRetos(e.parameter.pid));
      case 'getRetosGlobales':      return jsonResponse(getRetosGlobales());
      case 'getLockStatus':         return jsonResponse(getLockStatus());
      default: return jsonResponse({ error: 'Acción desconocida: ' + action });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); }
  catch (_) { return jsonResponse({ error: 'JSON inválido' }); }
  try {
    switch (data.action) {
      case 'register':     return jsonResponse(registerUser(data));
      case 'savePreds':    return jsonResponse(savePredictions(data));
      case 'saveSpecials': return jsonResponse(saveSpecialPredictions(data));
      case 'saveJoker':         return jsonResponse(saveJoker(data));
      case 'saveLiveAnswer':    return jsonResponse(saveLiveAnswer(data));
      case 'createLiveQuestion':return jsonResponse(createLiveQuestion(data));
      case 'resolveLiveQuestion':return jsonResponse(resolveLiveQuestion(data));
      case 'deleteLiveQuestion':return jsonResponse(deleteLiveQuestion(data));
      case 'crearReto':              return jsonResponse(crearReto(data));
      case 'responderReto':          return jsonResponse(responderReto(data));
      case 'grantManualAchievement': return jsonResponse(grantManualAchievement(data));
      case 'pingWaiting':             return jsonResponse(pingWaiting(data));
      case 'setLockStatus':           return jsonResponse(setLockStatus(data));
      case 'retirarCierre':           return jsonResponse(retirarCierre(data));
      default: return jsonResponse({ error: 'Acción desconocida: ' + data.action });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  GESTIÓN DE USUARIOS
// ─────────────────────────────────────────────────────────────

function registerUser(data) {
  const sheet  = getSheet('Participantes');
  const rows   = sheet.getDataRange().getValues();
  const nombre = (data.nombre || '').trim();
  const pin    = (data.pin || '').toString().trim();

  if (!nombre || nombre.length < 2) return { error: 'El nombre debe tener al menos 2 caracteres' };
  if (!/^\d{4}$/.test(pin))         return { error: 'El PIN debe tener exactamente 4 dígitos' };

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] && rows[i][1].toLowerCase() === nombre.toLowerCase()) {
      return { error: 'Ese nombre ya está registrado. Elige otro o inicia sesión.' };
    }
  }

  const id = Utilities.getUuid();
  sheet.appendRow([id, nombre, hashPin(pin), new Date().toISOString(), true]);

  const pSheet = getSheet('Puntuaciones');
  pSheet.appendRow([id, nombre, 0, 0, 0, 0, new Date().toISOString()]);

  return { success: true, id, nombre };
}

function checkUser(nombre, pin) {
  const sheet = getSheet('Participantes');
  const rows  = sheet.getDataRange().getValues();
  const h     = hashPin(pin);

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (rows[i][1].toLowerCase() === (nombre || '').toLowerCase() && rows[i][2] === h) {
      return { success: true, id: rows[i][0], nombre: rows[i][1] };
    }
  }
  return { success: false, error: 'Nombre o PIN incorrecto' };
}

// ─────────────────────────────────────────────────────────────
//  PREDICCIONES DE PARTIDO
// ─────────────────────────────────────────────────────────────

function savePredictions(data) {
  const predSheet  = getSheet('Predicciones');
  const matchSheet = getSheet('Partidos');
  const predRows   = predSheet.getDataRange().getValues();
  const matchRows  = matchSheet.getDataRange().getValues();
  const mHeaders   = matchRows[0];
  const now        = new Date();
  const saved = [], blocked = [], errors = [];

  for (const p of (data.preds || [])) {
    let match = null;
    for (let i = 1; i < matchRows.length; i++) {
      if (String(matchRows[i][mHeaders.indexOf('id')]) === String(p.mid)) {
        match = {};
        mHeaders.forEach((h, j) => match[h] = matchRows[i][j]);
        break;
      }
    }
    if (!match) { errors.push(p.mid); continue; }

    // FIX v2.1: solo bloquear si kickoff existe y ha pasado la hora de cierre.
    // Si kickoff está vacío (partido sin fecha aún), se permite guardar.
    if (match.kickoff) {
      const lockTime = new Date(new Date(match.kickoff).getTime() - 60 * 60 * 1000);
      if (now >= lockTime) { blocked.push(p.mid); continue; }
    }

    let existingRow = -1;
    for (let i = 1; i < predRows.length; i++) {
      if (String(predRows[i][0]) === String(data.pid) && String(predRows[i][1]) === String(p.mid)) {
        existingRow = i + 1; break;
      }
    }

    const row = [data.pid, p.mid, Number(p.gl), Number(p.gv), now.toISOString()];
    if (existingRow > 0) predSheet.getRange(existingRow, 1, 1, 5).setValues([row]);
    else predSheet.appendRow(row);
    saved.push(p.mid);
  }
  return { success: true, saved, blocked, errors };
}

function getPredictions(pid) {
  const sheet   = getSheet('Predicciones');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const preds   = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(pid)) {
      const p = {};
      headers.forEach((h, j) => p[h] = rows[i][j]);
      preds.push(p);
    }
  }
  return { preds };
}

function getMatchPredictions(mid) {
  const matchSheet = getSheet('Partidos');
  const matchRows  = matchSheet.getDataRange().getValues();
  const mHeaders   = matchRows[0];

  let match = null;
  for (let i = 1; i < matchRows.length; i++) {
    if (String(matchRows[i][mHeaders.indexOf('id')]) === String(mid)) {
      match = {};
      mHeaders.forEach((h, j) => match[h] = matchRows[i][j]);
      break;
    }
  }
  if (!match) return { error: 'Partido no encontrado' };

  const now      = new Date();
  const lockTime = match.kickoff
    ? new Date(new Date(match.kickoff).getTime() - 60 * 60 * 1000)
    : new Date(0);
  if (now < lockTime) return { error: 'Las predicciones aún no son visibles' };

  const predSheet = getSheet('Predicciones');
  const predRows  = predSheet.getDataRange().getValues();
  const pHeaders  = predRows[0];

  const partRows = getSheet('Participantes').getDataRange().getValues();
  const nameMap  = {};
  for (let i = 1; i < partRows.length; i++) {
    if (partRows[i][0]) nameMap[String(partRows[i][0])] = partRows[i][1];
  }

  const preds = [];
  let local = 0, draw = 0, away = 0;

  for (let i = 1; i < predRows.length; i++) {
    if (String(predRows[i][pHeaders.indexOf('partido_id')]) !== String(mid)) continue;
    const pid = String(predRows[i][pHeaders.indexOf('participante_id')]);
    const gl  = parseInt(predRows[i][pHeaders.indexOf('goles_local')]);
    const gv  = parseInt(predRows[i][pHeaders.indexOf('goles_visitante')]);
    if (isNaN(gl) || isNaN(gv)) continue;
    preds.push({ nombre: nameMap[pid] || 'Anónimo', gl, gv });
    if (gl > gv) local++;
    else if (gl < gv) away++;
    else draw++;
  }

  const total = preds.length || 1;
  return {
    preds,
    consensus: {
      local: Math.round(local / total * 100),
      draw:  Math.round(draw  / total * 100),
      away:  Math.round(away  / total * 100),
      total: preds.length
    }
  };
}

function getGroupConsensus(grupo) {
  const { matches } = getMatches('GROUP_STAGE', grupo);
  const now    = new Date();
  const result = {};

  for (const m of matches) {
    if (!m.kickoff) continue;
    const lockTime = new Date(new Date(m.kickoff).getTime() - 60 * 60 * 1000);
    if (now < lockTime) continue;
    const data = getMatchPredictions(String(m.id));
    if (!data.error) result[String(m.id)] = { consensus: data.consensus, preds: data.preds };
  }
  return { data: result };
}

// ─────────────────────────────────────────────────────────────
//  PREDICCIONES ESPECIALES
// ─────────────────────────────────────────────────────────────

// Asegura que la columna equipo_estrella existe en la hoja
function ensureEstrellaColunn() {
  const sheet   = getSheet('Predicciones_Especiales');
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.includes('equipo_estrella')) return;

  // Insertar antes de timestamp si existe, si no al final
  const tsIdx = headers.indexOf('timestamp');
  if (tsIdx >= 0) {
    sheet.insertColumnBefore(tsIdx + 1);
    sheet.getRange(1, tsIdx + 1).setValue('equipo_estrella');
  } else {
    sheet.getRange(1, lastCol + 1).setValue('equipo_estrella');
  }
}

function getSpecialsDeadlines() {
  const props = PropertiesService.getScriptProperties();
  // Early: estrella, goleador, sorpresa — cierra 1h antes del primer partido
  const earlyStr = props.getProperty('SPECIALS_DEADLINE_EARLY') || '2026-06-11T18:00:00Z';
  // Late:  campeon, finalista, semi1, semi2 — cierra 1h antes de octavos
  const lateStr  = props.getProperty('SPECIALS_DEADLINE_LATE')  || '2026-06-27T17:00:00Z';
  const now = new Date();
  return {
    early:     earlyStr,
    late:      lateStr,
    earlyOpen: now < new Date(earlyStr),
    lateOpen:  now < new Date(lateStr)
  };
}

function saveSpecialPredictions(data) {
  ensureEstrellaColunn();

  const sheet = getSheet('Predicciones_Especiales');
  const rows  = sheet.getDataRange().getValues();
  const hdr   = rows[0];
  const dl    = getSpecialsDeadlines();
  const now   = new Date();

  if (!dl.earlyOpen && !dl.lateOpen) {
    return { error: 'Todas las predicciones especiales están cerradas' };
  }

  // Función helper para actualizar una celda por nombre de columna
  const setCell = (rowNum, col, val) => {
    const c = hdr.indexOf(col);
    if (c >= 0) sheet.getRange(rowNum, c + 1).setValue(val);
  };

  let existingRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.pid)) { existingRow = i + 1; break; }
  }

  if (existingRow < 0) {
    // Fila nueva — guardar lo que esté abierto, vacío lo que esté cerrado
    const row = [
      data.pid,
      dl.lateOpen  ? (data.campeon          || '') : (rows.find(r => String(r[0]) === String(data.pid))?.[hdr.indexOf('campeon')]   || ''),
      dl.lateOpen  ? (data.finalista         || '') : '',
      dl.lateOpen  ? (data.semi1             || '') : '',
      dl.lateOpen  ? (data.semi2             || '') : '',
      dl.earlyOpen ? (data.goleador          || '') : '',
      dl.earlyOpen ? (data.sorpresa          || '') : '',
      dl.earlyOpen ? (data.equipo_estrella   || '') : '',
      now.toISOString()
    ];
    sheet.appendRow(row);
  } else {
    // Fila existente — solo actualizar el grupo que esté abierto
    if (dl.lateOpen) {
      setCell(existingRow, 'campeon',   data.campeon   || '');
      setCell(existingRow, 'finalista', data.finalista || '');
      setCell(existingRow, 'semi1',     data.semi1     || '');
      setCell(existingRow, 'semi2',     data.semi2     || '');
    }
    if (dl.earlyOpen) {
      setCell(existingRow, 'goleador',        data.goleador        || '');
      setCell(existingRow, 'sorpresa',        data.sorpresa        || '');
      setCell(existingRow, 'equipo_estrella', data.equipo_estrella || '');
    }
    setCell(existingRow, 'timestamp', now.toISOString());
  }

  return { success: true, deadlines: dl };
}

function getSpecials(pid) {
  ensureEstrellaColunn();
  const sheet   = getSheet('Predicciones_Especiales');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const dl      = getSpecialsDeadlines();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(pid)) {
      const p = {};
      headers.forEach((h, j) => p[h] = rows[i][j]);
      return { pred: p, deadlines: dl };
    }
  }
  return { pred: null, deadlines: dl };
}

// ─────────────────────────────────────────────────────────────
//  JOKER — PARTIDO DOBLE (×2, una vez en toda la porra)
// ─────────────────────────────────────────────────────────────

function saveJoker(data) {
  const sheet = getOrCreateSheet('Partido_Doble',
    ['participante_id', 'partido_id', 'timestamp']);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.pid)) {
      return { error: 'Ya has usado tu partido doble en esta porra' };
    }
  }

  const matchSheet = getSheet('Partidos');
  const matchRows  = matchSheet.getDataRange().getValues();
  const mHeaders   = matchRows[0];
  let match = null;
  for (let i = 1; i < matchRows.length; i++) {
    if (String(matchRows[i][mHeaders.indexOf('id')]) === String(data.mid)) {
      match = {};
      mHeaders.forEach((h, j) => match[h] = matchRows[i][j]);
      break;
    }
  }
  if (!match) return { error: 'Partido no encontrado' };

  if (match.kickoff) {
    const now      = new Date();
    const lockTime = new Date(new Date(match.kickoff).getTime() - 60 * 60 * 1000);
    if (now >= lockTime) return { error: 'El partido ya está cerrado para el joker' };
  }

  sheet.appendRow([data.pid, data.mid, new Date().toISOString()]);
  return { success: true, mid: data.mid };
}

function getJoker(pid) {
  try {
    const sheet = getOrCreateSheet('Partido_Doble',
      ['participante_id', 'partido_id', 'timestamp']);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(pid)) {
        return { joker: { pid: rows[i][0], mid: String(rows[i][1]), ts: rows[i][2] } };
      }
    }
  } catch(_) {}
  return { joker: null };
}

function getJokerMatchId(pid) {
  try {
    const { joker } = getJoker(pid);
    return joker ? joker.mid : null;
  } catch(_) { return null; }
}

// ─────────────────────────────────────────────────────────────
//  RANKING
// ─────────────────────────────────────────────────────────────

function getRanking() {
  const sheet   = getSheet('Puntuaciones');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const ranking = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const r = {};
    headers.forEach((h, j) => r[h] = rows[i][j]);
    ranking.push(r);
  }
  ranking.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
  ranking.forEach((r, i) => r.pos = i + 1);
  return { ranking, updated: new Date().toISOString() };
}

function saveRankingSnapshot() {
  const { ranking } = getRanking();
  if (!ranking || ranking.length === 0) return;

  const sheet = getOrCreateSheet('Historico_Ranking', [
    'participante_id', 'nombre', 'posicion', 'total',
    'pts_grupos', 'pts_elim', 'pts_spec', 'timestamp'
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length > 1) {
    const lastDate = String(rows[rows.length - 1][7]).slice(0, 10);
    if (lastDate === today) return;
  }

  const now = new Date().toISOString();
  for (const r of ranking) {
    sheet.appendRow([
      r.participante_id, r.nombre, r.pos, r.total,
      r.pts_grupos || 0, r.pts_eliminatorias || 0, r.pts_especiales || 0,
      now
    ]);
  }
}

function getHistory(pid) {
  const sheet = getOrCreateSheet('Historico_Ranking', [
    'participante_id', 'nombre', 'posicion', 'total',
    'pts_grupos', 'pts_elim', 'pts_spec', 'timestamp'
  ]);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];

  if (pid) {
    const history = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0] || String(rows[i][0]) !== String(pid)) continue;
      const h = {};
      headers.forEach((col, j) => h[col] = rows[i][j]);
      history.push(h);
    }
    return { history };
  } else {
    const byPid = {};
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const id = String(rows[i][0]);
      if (!byPid[id]) byPid[id] = { nombre: rows[i][1], data: [] };
      byPid[id].data.push({ pos: rows[i][2], total: rows[i][3], ts: String(rows[i][7]) });
    }
    return { byPid };
  }
}

// ─────────────────────────────────────────────────────────────
//  PARTIDOS
// ─────────────────────────────────────────────────────────────

function getMatches(fase, grupo) {
  const sheet   = getSheet('Partidos');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const m = {};
    headers.forEach((h, j) => m[h] = rows[i][j]);
    if (fase  && m.fase  !== fase)  continue;
    if (grupo && m.grupo !== grupo) continue;
    matches.push(m);
  }
  return { matches };
}

function getBracket() {
  const { matches } = getMatches();
  const phases = ['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];
  const bracket = {};
  phases.forEach(p => bracket[p] = matches.filter(m => m.fase === p));
  return { bracket };
}

function getMatchLockStatus() {
  const { matches } = getMatches();
  const now    = new Date();
  const status = {};
  matches.forEach(m => {
    if (!m.id || !m.kickoff) return;
    const lockTime = new Date(new Date(m.kickoff).getTime() - 60 * 60 * 1000);
    status[m.id] = now >= lockTime;
  });
  return { status, now: now.toISOString() };
}

// ─────────────────────────────────────────────────────────────
//  ESTADÍSTICAS GLOBALES
// ─────────────────────────────────────────────────────────────

function getStats() {
  const matchRows = getSheet('Partidos').getDataRange().getValues();
  const mHeaders  = matchRows[0];
  let played = 0, upcoming = 0, live = 0;
  for (let i = 1; i < matchRows.length; i++) {
    if (!matchRows[i][0]) continue;
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.estado === 'FINISHED')                                played++;
    else if (m.estado === 'IN_PLAY' || m.estado === 'PAUSED')  live++;
    else                                                        upcoming++;
  }
  const { ranking } = getRanking();
  return {
    played, upcoming, live,
    participants: ranking.length,
    leader: ranking[0] || null,
    updated: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
//  COMENTARIO DIARIO HUMORÍSTICO
// ─────────────────────────────────────────────────────────────

function getDailyComment() {
  const { ranking } = getRanking();
  if (ranking.length < 1) return { lider: null, colista: null };

  const lider   = ranking[0];
  const colista = ranking[ranking.length - 1];

  const liderLines = [
    `${lider.nombre} con ${lider.total} puntos. Ya ha reservado mesa para la cena del campeón. En el Bernabéu. Sin invitaros. 🍽️`,
    `${lider.total} puntos para ${lider.nombre}. Su madre lo tiene enmarcado en el salón. Al lado del diploma de la ESO. 🖼️`,
    `${lider.nombre} lleva ${lider.total} puntos y ya habla de sí mismo en tercera persona. "El líder no falla." 👑`,
    `Con ${lider.total} puntos, ${lider.nombre} ha empezado a cobrar por sus picks en el grupo de WhatsApp. Nadie ha pagado todavía. 💬`,
    `${lider.nombre}: ${lider.total} puntos. Dice que es suerte. Miente. Lo dice con una sonrisa enorme. 😁`,
    `${lider.total} puntos. ${lider.nombre} ya ensaya el discurso de agradecimiento para la cena. Tiene PowerPoint. 📊`,
    `${lider.nombre} con ${lider.total} puntos. Le han propuesto ser comentarista de la Sexta y está considerándolo. 📺`,
  ];

  const colistaLines = [
    `${colista.nombre}: ${colista.total} puntos. Sus picks son tan malos que se usan de control negativo en los estudios. 🧪`,
    `Con ${colista.total} puntos, ${colista.nombre} ha conseguido lo imposible: que hasta él mismo dude de sí mismo. 📉`,
    `${colista.nombre} lleva ${colista.total} puntos. Su estrategia de predicción fue validada por un astrólogo de Instagram. ☆`,
    `${colista.total} puntos. ${colista.nombre} no va último por mala suerte. Va último por méritos propios. Sostenidos. 💀`,
    `${colista.nombre} con ${colista.total} puntos. Si apostara dinero real, ya habría financiado las vacaciones del bookmaker. 💸`,
    `A estas alturas, ${colista.nombre} no predice resultados. Selecciona catástrofes. ${colista.total} puntos. 🤡`,
    `${colista.nombre}: ${colista.total} pts. El grupo de WhatsApp le ha silenciado. Por su propio bien. 📵`,
    `${colista.total} puntos. ${colista.nombre} vio todos los partidos, analizó las estadísticas y acertó menos que tirando una moneda. 🎲`,
  ];

  const seed = lider.total + colista.total + new Date().getDate() + new Date().getMonth();

  // ── La Cagada del Día ──
  // Busca el pick más equivocado del último día con partidos finalizados
  let cagada = null;
  try {
    const mSheet    = getSheet('Partidos');
    const mRows     = mSheet.getDataRange().getValues();
    const mH        = mRows[0];
    const predSheet = getSheet('Predicciones');
    const predRows  = predSheet.getDataRange().getValues();
    const predH     = predRows[0];
    const partSheet = getSheet('Participantes');
    const partRows  = partSheet.getDataRange().getValues();

    // Mapa nombre por id
    const nombreById = {};
    for (let i = 1; i < partRows.length; i++) {
      if (partRows[i][0]) nombreById[String(partRows[i][0])] = String(partRows[i][1]);
    }

    // Encontrar el último día con partidos FINISHED (en hora Madrid)
    const finishedByDay = {};
    for (let i = 1; i < mRows.length; i++) {
      if (!mRows[i][0]) continue;
      const m = {};
      mH.forEach((h, j) => m[h] = mRows[i][j]);
      if (m.estado !== 'FINISHED' || !m.kickoff) continue;
      const ko = m.kickoff instanceof Date ? m.kickoff : new Date(m.kickoff);
      const dia = Utilities.formatDate(ko, 'Europe/Madrid', 'yyyy-MM-dd');
      if (!finishedByDay[dia]) finishedByDay[dia] = [];
      finishedByDay[dia].push(m);
    }

    // Último día con partidos finalizados
    const dias = Object.keys(finishedByDay).sort();
    if (!dias.length) throw new Error('sin días');
    const ultimoDia = dias[dias.length - 1];
    const partidosDelDia = finishedByDay[ultimoDia];
    const matchMap = {};
    partidosDelDia.forEach(m => matchMap[String(m.id)] = m);

    // Buscar el pick con mayor error total
    let maxError = -1;
    for (let i = 1; i < predRows.length; i++) {
      if (!predRows[i][0]) continue;
      const mid   = String(predRows[i][predH.indexOf('partido_id')]);
      const match = matchMap[mid];
      if (!match) continue;
      const predL = Number(predRows[i][predH.indexOf('goles_local')]);
      const predV = Number(predRows[i][predH.indexOf('goles_visitante')]);
      const realL = Number(match.goles_local);
      const realV = Number(match.goles_visitante);
      if (isNaN(predL) || isNaN(predV) || isNaN(realL) || isNaN(realV)) continue;
      const error = Math.abs(predL - realL) + Math.abs(predV - realV);
      if (error > maxError) {
        maxError = error;
        const pid = String(predRows[i][predH.indexOf('participante_id')]);
        cagada = {
          nombre:    nombreById[pid] || 'Alguien',
          predL, predV, realL, realV,
          local:     match.equipo_local     || match.home_team || '?',
          visitante: match.equipo_visitante || match.away_team || '?',
          error,
          dia: ultimoDia
        };
      }
    }

    // Umbral mínimo de 2 goles de diferencia
    if (cagada && cagada.error < 2) cagada = null;

    if (cagada) {
      const cagadaLines = [
        `${cagada.nombre} apostó ${cagada.predL}-${cagada.predV} en el ${cagada.local} vs ${cagada.visitante}. El resultado fue ${cagada.realL}-${cagada.realV}. Hay que tener valor. 💩`,
        `Alguien tenía mucha fe. Ese alguien era ${cagada.nombre}. Predijo ${cagada.predL}-${cagada.predV} en el ${cagada.local} vs ${cagada.visitante}. El universo respondió ${cagada.realL}-${cagada.realV}. 🌍`,
        `${cagada.nombre} veía el partido diferente al resto del mundo. Muy diferente. ${cagada.predL}-${cagada.predV} vs ${cagada.realL}-${cagada.realV} en el ${cagada.local} vs ${cagada.visitante}. 🔭`,
        `La pick del día la firma ${cagada.nombre}: ${cagada.predL}-${cagada.predV} cuando el ${cagada.local} vs ${cagada.visitante} acabó ${cagada.realL}-${cagada.realV}. Ni los comentaristas de TVE la vieron tan mal. 📺`,
        `${cagada.nombre} apostó ${cagada.predL}-${cagada.predV}. El ${cagada.local} vs ${cagada.visitante} acabó ${cagada.realL}-${cagada.realV}. Con ${cagada.error} goles de diferencia, esto ya no es mala suerte. Es un don. 🎁`,
        `Archivo histórico de picks imposibles: ${cagada.nombre}, ${cagada.local} vs ${cagada.visitante}, pronóstico ${cagada.predL}-${cagada.predV}, realidad ${cagada.realL}-${cagada.realV}. Para la posteridad. 🗃️`,
      ];
      cagada.comment = cagadaLines[(seed + 7) % cagadaLines.length];
    }
  } catch(e) {
    Logger.log('Cagada error: ' + e);
    cagada = null;
  }

  return {
    lider:   { nombre: lider.nombre,   total: lider.total,   pos: lider.pos,   comment: liderLines[seed % liderLines.length] },
    colista: { nombre: colista.nombre, total: colista.total, pos: colista.pos, comment: colistaLines[(seed + 4) % colistaLines.length] },
    cagada,
    date: new Date().toISOString().slice(0, 10),
    totalPlayers: ranking.length
  };
}

// ─────────────────────────────────────────────────────────────
//  PERFIL DE JUGADOR
// ─────────────────────────────────────────────────────────────

function getProfile(pid) {
  const matchRows = getSheet('Partidos').getDataRange().getValues();
  const predRows  = getSheet('Predicciones').getDataRange().getValues();
  const specRows  = getSheet('Predicciones_Especiales').getDataRange().getValues();
  const mHeaders  = matchRows[0];
  const pHeaders  = predRows[0];
  const sHeaders  = specRows[0];

  const partRows = getSheet('Participantes').getDataRange().getValues();
  let nombre = 'Usuario';
  for (let i = 1; i < partRows.length; i++) {
    if (String(partRows[i][0]) === String(pid)) { nombre = partRows[i][1]; break; }
  }

  const { ranking } = getRanking();
  const userRank = ranking.find(r => String(r.participante_id) === String(pid)) || {};
  const pos      = userRank.pos || '—';

  // Leer especiales del jugador
  let equipoEstrella = '', campeon = '', finalista = '', semi1 = '', semi2 = '', goleador = '', sorpresa = '';
  for (let i = 1; i < specRows.length; i++) {
    if (String(specRows[i][0]) !== String(pid)) continue;
    campeon        = specRows[i][sHeaders.indexOf('campeon')]        || '';
    finalista      = specRows[i][sHeaders.indexOf('finalista')]      || '';
    semi1          = specRows[i][sHeaders.indexOf('semi1')]          || '';
    semi2          = specRows[i][sHeaders.indexOf('semi2')]          || '';
    goleador       = specRows[i][sHeaders.indexOf('goleador')]       || '';
    sorpresa       = specRows[i][sHeaders.indexOf('sorpresa')]       || '';
    const eeIdx    = sHeaders.indexOf('equipo_estrella');
    equipoEstrella = eeIdx >= 0 ? (specRows[i][eeIdx] || '') : '';
    break;
  }

  // Joker
  const jokerMid = getJokerMatchId(pid);

  const matches = {};
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.id && m.estado === 'FINISHED') matches[String(m.id)] = m;
  }

  let totalPreds = 0, exactos = 0, ganadores = 0;
  let maxError = 0, pickLoco = null;
  const historial = [];

  for (let i = 1; i < predRows.length; i++) {
    if (String(predRows[i][0]) !== String(pid)) continue;
    const p = {};
    pHeaders.forEach((h, j) => p[h] = predRows[i][j]);
    const match = matches[String(p.partido_id)];
    if (!match) continue;
    const glR = parseInt(match.goles_local),  gvR = parseInt(match.goles_visitante);
    const glP = parseInt(p.goles_local),       gvP = parseInt(p.goles_visitante);
    if ([glR, gvR, glP, gvP].some(isNaN)) continue;

    totalPreds++;
    const isExacto  = glP === glR && gvP === gvR;
    const isGanador = winner(glP, gvP) === winner(glR, gvR);
    if (isExacto)  exactos++;
    if (isGanador) ganadores++;

    const err = Math.abs(glP - glR) + Math.abs(gvP - gvR);
    if (err > maxError) {
      maxError = err;
      pickLoco = {
        local: match.equipo_local, visitante: match.equipo_visitante,
        predL: glP, predV: gvP, realL: glR, realV: gvR, kickoff: match.kickoff
      };
    }

    // Calcular puntos con toda la lógica (estrella, joker)
    let ptsBase = 0;
    if (match.fase === 'GROUP_STAGE') {
      if (isExacto)       ptsBase = 4;
      else if (isGanador) ptsBase = 2;
    } else {
      if (isGanador) {
        ptsBase = 4;
        if (isExacto) ptsBase += 3;
      }
    }
    const isJoker    = jokerMid && String(match.id) === jokerMid;
    const hasEstrella = ptsBase > 0 && equipoEstrella &&
      (match.equipo_local === equipoEstrella || match.equipo_visitante === equipoEstrella);
    let ptsEstrella = hasEstrella ? 1 : 0;
    let pts = (ptsBase + ptsEstrella) * (isJoker ? 2 : 1);

    historial.push({
      mid: match.id, local: match.equipo_local, visitante: match.equipo_visitante,
      predL: glP, predV: gvP, realL: glR, realV: gvR,
      kickoff: match.kickoff,
      result: isExacto ? 'exact' : isGanador ? 'winner' : 'miss',
      fase: match.fase,
      pts, ptsBase, ptsEstrella,
      isJoker: !!isJoker
    });
  }

  historial.sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  let rachaActual = 0;
  for (const h of historial) { if (h.result !== 'miss') rachaActual++; else break; }

  let mejorRacha = 0, temp = 0;
  for (const h of [...historial].reverse()) {
    if (h.result !== 'miss') { temp++; if (temp > mejorRacha) mejorRacha = temp; }
    else temp = 0;
  }

  // ── Desglose de especiales ──
  const champion  = getFinalWinner(matchRows, mHeaders);
  const finalist  = getFinalLoser(matchRows, mHeaders);
  const semis     = getSemiFinalists(matchRows, mHeaders);
  const topTeams  = getTopScoringTeams(matchRows, mHeaders);

  // Estado de cada especial: 'hit' | 'miss' | 'pending'
  function specStatus(pred, resolved, match) {
    if (!pred) return 'empty';
    if (!resolved) return 'pending';
    return pred === match ? 'hit' : 'miss';
  }
  function semiStatus(pred) {
    if (!pred) return 'empty';
    if (semis.length === 0) return 'pending';
    return semis.includes(pred) ? 'hit' : 'miss';
  }

  const especiales = [
    { key: 'campeon',   icon: '🏆', label: 'Campeón del Mundial',  pred: campeon,   status: specStatus(campeon,   champion,  champion),  pts_posibles: 10, pts_ganados: champion  && campeon   === champion  ? 10 : 0 },
    { key: 'finalista', icon: '🥈', label: 'Finalista',            pred: finalista, status: specStatus(finalista, finalist,  finalist),  pts_posibles: 5,  pts_ganados: finalist  && finalista === finalist  ? 5  : 0 },
    { key: 'semi1',     icon: '4️⃣', label: 'Semifinalista 1',      pred: semi1,     status: semiStatus(semi1),                           pts_posibles: 4,  pts_ganados: semis.length && semis.includes(semi1) ? 4  : 0 },
    { key: 'semi2',     icon: '4️⃣', label: 'Semifinalista 2',      pred: semi2,     status: semiStatus(semi2),                           pts_posibles: 4,  pts_ganados: semis.length && semis.includes(semi2) ? 4  : 0 },
    { key: 'goleador',  icon: '👟', label: 'Selección Máxima Goleadora', pred: goleador, status: !goleador ? 'empty' : topTeams.length === 0 ? 'pending' : topTeams.includes(goleador) ? 'hit' : 'miss', pts_posibles: 8, pts_ganados: topTeams.length && topTeams.includes(goleador) ? 8 : 0 },
    { key: 'sorpresa',  icon: '💥', label: 'Sorpresa del Torneo',  pred: sorpresa,  status: !sorpresa ? 'empty' : !FAVORITES.includes(sorpresa) ? 'miss' : isEliminatedInGroups(sorpresa, matchRows, mHeaders) ? 'hit' : semis.length > 0 || champion ? 'miss' : 'pending', pts_posibles: 6, pts_ganados: sorpresa && FAVORITES.includes(sorpresa) && isEliminatedInGroups(sorpresa, matchRows, mHeaders) ? 6 : 0 },
    { key: 'estrella',  icon: '⭐', label: 'Equipo Estrella',      pred: equipoEstrella, status: equipoEstrella ? 'active' : 'empty',    pts_posibles: null, pts_ganados: historial.reduce((s, h) => s + (h.ptsEstrella || 0), 0) }
  ];

  // Añadir preguntas en vivo resueltas
  try {
    const qSheet = getOrCreateSheet('Preguntas_Vivo',
      ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
    const qRows = qSheet.getDataRange().getValues();
    const qH    = qRows[0];

    const rSheet = getOrCreateSheet('Respuestas_Vivo',
      ['pregunta_id','participante_id','respuesta','timestamp']);
    const rRows = rSheet.getDataRange().getValues();
    const rH    = rRows[0];

    // Solo preguntas resueltas
    for (let i = 1; i < qRows.length; i++) {
      if (String(qRows[i][qH.indexOf('estado')]) !== 'resuelta') continue;
      const qid      = String(qRows[i][qH.indexOf('id')]);
      const pregunta = String(qRows[i][qH.indexOf('pregunta')]);
      const correcta = String(qRows[i][qH.indexOf('respuesta_correcta')]);
      const puntos   = Number(qRows[i][qH.indexOf('puntos')]) || 1;

      // Buscar respuesta del usuario
      let userResp = null;
      for (let j = 1; j < rRows.length; j++) {
        if (String(rRows[j][rH.indexOf('pregunta_id')])    !== qid)         continue;
        if (String(rRows[j][rH.indexOf('participante_id')]) !== String(pid)) continue;
        userResp = String(rRows[j][rH.indexOf('respuesta')]);
        break;
      }

      const acerto = userResp !== null && userResp === correcta;
      especiales.push({
        key:          'vivo_' + qid,
        icon:         '⚡',
        label:        pregunta,
        pred:         userResp !== null ? userResp + ' (correcta: ' + correcta + ')' : null,
        status:       userResp === null ? 'empty' : acerto ? 'hit' : 'miss',
        pts_posibles: puntos,
        pts_ganados:  acerto ? puntos : 0
      });
    }
  } catch(e) {}

  return {
    pid, nombre, pos,
    total: userRank.total || 0,
    pts_grupos: userRank.pts_grupos || 0,
    pts_elim:   userRank.pts_eliminatorias || 0,
    pts_spec:   userRank.pts_especiales || 0,
    stats: {
      totalPreds, exactos, ganadores, fallos: totalPreds - ganadores,
      pctExacto:  totalPreds ? Math.round(exactos   / totalPreds * 100) : 0,
      pctGanador: totalPreds ? Math.round(ganadores / totalPreds * 100) : 0,
      rachaActual, mejorRacha
    },
    pickLoco,
    historial,
    especiales
  };
}

// ─────────────────────────────────────────────────────────────
//  LOGROS / ACHIEVEMENTS
// ─────────────────────────────────────────────────────────────

function getAchievements(pid) {
  const matchRows = getSheet('Partidos').getDataRange().getValues();
  const predRows  = getSheet('Predicciones').getDataRange().getValues();
  const mHeaders  = matchRows[0];
  const pHeaders  = predRows[0];

  const matches = {};
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.id && m.estado === 'FINISHED') matches[String(m.id)] = m;
  }

  const userPreds = [];
  for (let i = 1; i < predRows.length; i++) {
    if (String(predRows[i][0]) !== String(pid)) continue;
    const p = {};
    pHeaders.forEach((h, j) => p[h] = predRows[i][j]);
    const match = matches[String(p.partido_id)];
    if (!match) continue;
    if (!match.kickoff) continue;
    const glR = parseInt(match.goles_local), gvR = parseInt(match.goles_visitante);
    const glP = parseInt(p.goles_local),     gvP = parseInt(p.goles_visitante);
    if ([glR, gvR, glP, gvP].some(isNaN)) continue;
    userPreds.push({
      kickoff: new Date(match.kickoff),
      isExacto:  glP === glR && gvP === gvR,
      isGanador: winner(glP, gvP) === winner(glR, gvR),
      totalGoals: glR + gvR,
      predL: glP, predV: gvP
    });
  }
  userPreds.sort((a, b) => a.kickoff - b.kickoff);

  const total     = userPreds.length;
  const exactos   = userPreds.filter(p => p.isExacto).length;
  const ganadores = userPreds.filter(p => p.isGanador).length;

  let exactStreak = 0, maxExactStreak = 0;
  let missStreak  = 0, maxMissStreak  = 0;
  let noWinStreak = 0, maxNoWinStreak = 0;
  const scoreCount = {};
  let hasHighGoalExact = false;
  const exactsByDay = {};

  for (const p of userPreds) {
    if (p.isExacto) { exactStreak++; maxExactStreak = Math.max(maxExactStreak, exactStreak); }
    else exactStreak = 0;
    if (!p.isGanador) {
      missStreak++; maxMissStreak = Math.max(maxMissStreak, missStreak);
      noWinStreak++; maxNoWinStreak = Math.max(maxNoWinStreak, noWinStreak);
    } else { missStreak = 0; noWinStreak = 0; }
    const key = `${p.predL}-${p.predV}`;
    scoreCount[key] = (scoreCount[key] || 0) + 1;
    if (p.isExacto && p.totalGoals >= 4) hasHighGoalExact = true;
    if (p.isExacto) {
      const day = p.kickoff.toISOString().slice(0, 10);
      exactsByDay[day] = (exactsByDay[day] || 0) + 1;
    }
  }

  const maxSameScore = Object.values(scoreCount).length
    ? Math.max(...Object.values(scoreCount)) : 0;
  const maxExactsInDay = Object.values(exactsByDay).length
    ? Math.max(...Object.values(exactsByDay)) : 0;

  const earned = [];
  if (exactos >= 1)                                       earned.push('quinielas');
  if (maxExactStreak >= 5)                                earned.push('nostradamus');
  if (maxMissStreak >= 3)                                 earned.push('var');
  if (total >= 10 && ganadores / total >= 0.75)           earned.push('pulpo');
  if (hasHighGoalExact)                                   earned.push('nba');
  if (maxSameScore >= 8)                                  earned.push('copypaste');
  if (maxExactsInDay >= 3)                                earned.push('hattrick');
  if (maxNoWinStreak >= 5)                                earned.push('seleccionador');

  const ALL_ACHIEVEMENTS = [
    { id:'quinielas',        icon:'🎯', name:'El Quinielas',           desc:'Tu primer resultado exacto' },
    { id:'nostradamus',      icon:'🔮', name:'Nostradamus con Balón',   desc:'5 exactos consecutivos' },
    { id:'var',              icon:'💀', name:'Peor que el VAR',         desc:'3 partidos seguidos a 0 puntos' },
    { id:'pulpo',            icon:'🐙', name:'Paul el Pulpo',           desc:'>75% acierto (mín. 10 partidos)' },
    { id:'nba',              icon:'🏀', name:'¿Esto es la NBA?',        desc:'Exacto en un partido con 4+ goles' },
    { id:'copypaste',        icon:'😴', name:'Copy-Paste FC',            desc:'Mismo marcador en 8+ partidos' },
    { id:'hattrick',         icon:'🔥', name:'Hat-Trick de Sofá',       desc:'3 exactos en el mismo día' },
    { id:'seleccionador',    icon:'🤡', name:'Seleccionador Nacional',   desc:'5 partidos seguidos sin acertar el ganador' },
    { id:'extincion_lopez',  icon:'💀', name:'Extinción López',          desc:'Has eliminado a toda la familia. Eres una catástrofe natural.' },
    { id:'fin_dinastia',     icon:'🏰', name:'El fin de la Dinastía',    desc:'Los López cayeron uno a uno. Nadie sobrevivió para contarlo.' },
  ];

  // Logros manuales concedidos por admin
  const manualSheet = getOrCreateSheet('Logros_Manuales',
    ['pid', 'achievement_id', 'earned_at', 'granted_by']);
  const manualRows = manualSheet.getDataRange().getValues();
  const manualH    = manualRows[0];
  for (let i = 1; i < manualRows.length; i++) {
    if (!manualRows[i][0]) continue;
    if (String(manualRows[i][manualH.indexOf('pid')]) === String(pid)) {
      earned.push(String(manualRows[i][manualH.indexOf('achievement_id')]));
    }
  }

  return {
    achievements: ALL_ACHIEVEMENTS.map(a => ({ ...a, locked: !earned.includes(a.id) }))
  };
}

// ─────────────────────────────────────────────────────────────
//  LOGROS RECIENTES (para popup de novedades)
// ─────────────────────────────────────────────────────────────

function getRecentAchievements() {
  const ALL_ACHIEVEMENTS = [
    { id:'quinielas',        icon:'🎯', name:'El Quinielas',           desc:'Tu primer resultado exacto' },
    { id:'nostradamus',      icon:'🔮', name:'Nostradamus con Balón',   desc:'5 exactos consecutivos' },
    { id:'var',              icon:'💀', name:'Peor que el VAR',         desc:'3 partidos seguidos a 0 puntos' },
    { id:'pulpo',            icon:'🐙', name:'Paul el Pulpo',           desc:'>75% acierto (mín. 10 partidos)' },
    { id:'nba',              icon:'🏀', name:'¿Esto es la NBA?',        desc:'Exacto en un partido con 4+ goles' },
    { id:'copypaste',        icon:'😴', name:'Copy-Paste FC',            desc:'Mismo marcador en 8+ partidos' },
    { id:'hattrick',         icon:'🔥', name:'Hat-Trick de Sofá',       desc:'3 exactos en el mismo día' },
    { id:'seleccionador',    icon:'🤡', name:'Seleccionador Nacional',   desc:'5 partidos seguidos sin acertar el ganador' },
    { id:'extincion_lopez',  icon:'💀', name:'Extinción López',          desc:'Has eliminado a toda la familia. Eres una catástrofe natural.' },
    { id:'fin_dinastia',     icon:'🏰', name:'El fin de la Dinastía',    desc:'Los López cayeron uno a uno. Nadie sobrevivió para contarlo.' },
  ];

  const matchRows = getSheet('Partidos').getDataRange().getValues();
  const predRows  = getSheet('Predicciones').getDataRange().getValues();
  const partRows  = getSheet('Participantes').getDataRange().getValues();
  const mHeaders  = matchRows[0];
  const pHeaders  = predRows[0];

  // Mapa de partidos terminados con su kickoff
  const matches = {};
  let latestKickoff = new Date(0);
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.id && m.estado === 'FINISHED') {
      matches[String(m.id)] = m;
      const ko = new Date(m.kickoff);
      if (ko > latestKickoff) latestKickoff = ko;
    }
  }

  // Ventana de tiempo: últimas 48h desde el partido más reciente
  const cutoff = new Date(latestKickoff.getTime() - 48 * 60 * 60 * 1000);

  const results = [];

  for (let pi = 1; pi < partRows.length; pi++) {
    if (!partRows[pi][0]) continue;
    const pid    = String(partRows[pi][0]);
    const nombre = partRows[pi][1];

    // Predicciones del jugador en partidos terminados
    const userPreds = [];
    for (let i = 1; i < predRows.length; i++) {
      if (String(predRows[i][0]) !== pid) continue;
      const p = {};
      pHeaders.forEach((h, j) => p[h] = predRows[i][j]);
      const match = matches[String(p.partido_id)];
      if (!match || !match.kickoff) continue;
      const glR = parseInt(match.goles_local), gvR = parseInt(match.goles_visitante);
      const glP = parseInt(p.goles_local),     gvP = parseInt(p.goles_visitante);
      if ([glR, gvR, glP, gvP].some(isNaN)) continue;
      userPreds.push({
        kickoff:    new Date(match.kickoff),
        isExacto:   glP === glR && gvP === gvR,
        isGanador:  winner(glP, gvP) === winner(glR, gvR),
        totalGoals: glR + gvR,
        predL: glP, predV: gvP
      });
    }
    userPreds.sort((a, b) => a.kickoff - b.kickoff);

    const total     = userPreds.length;
    const exactos   = userPreds.filter(p => p.isExacto).length;
    const ganadores = userPreds.filter(p => p.isGanador).length;

    let exactStreak = 0, maxExactStreak = 0, exactStreakSince = null;
    let missStreak  = 0, maxMissStreak  = 0, missStreakSince  = null;
    let noWinStreak = 0, maxNoWinStreak = 0, noWinStreakSince = null;
    const scoreCount = {};
    let hasHighGoalExact = false, highGoalExactAt = null;
    const exactsByDay = {};

    for (const p of userPreds) {
      if (p.isExacto) {
        exactStreak++;
        if (exactStreak > maxExactStreak) { maxExactStreak = exactStreak; exactStreakSince = p.kickoff; }
      } else exactStreak = 0;

      if (!p.isGanador) {
        missStreak++;
        if (missStreak > maxMissStreak) { maxMissStreak = missStreak; missStreakSince = p.kickoff; }
        noWinStreak++;
        if (noWinStreak > maxNoWinStreak) { maxNoWinStreak = noWinStreak; noWinStreakSince = p.kickoff; }
      } else { missStreak = 0; noWinStreak = 0; }

      const key = `${p.predL}-${p.predV}`;
      scoreCount[key] = (scoreCount[key] || 0) + 1;

      if (p.isExacto && p.totalGoals >= 4 && !hasHighGoalExact) {
        hasHighGoalExact = true; highGoalExactAt = p.kickoff;
      }
      if (p.isExacto) {
        const day = p.kickoff.toISOString().slice(0, 10);
        exactsByDay[day] = (exactsByDay[day] || 0) + 1;
      }
    }

    const maxSameScore    = Object.values(scoreCount).length ? Math.max(...Object.values(scoreCount)) : 0;
    const maxExactsInDay  = Object.values(exactsByDay).length ? Math.max(...Object.values(exactsByDay)) : 0;
    const hattrickDay     = Object.entries(exactsByDay).find(([,v]) => v >= 3);
    const hattrickAt      = hattrickDay ? new Date(hattrickDay[0] + 'T23:59:59Z') : null;

    // Buscar el kickoff aproximado del logro copypaste (cuando llegó a 8 del mismo marcador)
    let copypasteAt = null;
    if (maxSameScore >= 8) {
      const dominantScore = Object.entries(scoreCount).find(([,v]) => v >= 8)?.[0];
      if (dominantScore) {
        let cnt = 0;
        for (const p of userPreds) {
          if (`${p.predL}-${p.predV}` === dominantScore) { cnt++; if (cnt === 8) { copypasteAt = p.kickoff; break; } }
        }
      }
    }

    // Primer exacto
    const firstExactoAt = userPreds.find(p => p.isExacto)?.kickoff || null;

    // Logros ganados con su timestamp aproximado
    const earned = [
      { id:'quinielas',     ok: exactos >= 1,                                      at: firstExactoAt },
      { id:'nostradamus',   ok: maxExactStreak >= 5,                               at: exactStreakSince },
      { id:'var',           ok: maxMissStreak >= 3,                                at: missStreakSince },
      { id:'pulpo',         ok: total >= 10 && ganadores / total >= 0.75,          at: userPreds[userPreds.length - 1]?.kickoff || null },
      { id:'nba',           ok: hasHighGoalExact,                                  at: highGoalExactAt },
      { id:'copypaste',     ok: maxSameScore >= 8,                                 at: copypasteAt },
      { id:'hattrick',      ok: maxExactsInDay >= 3,                               at: hattrickAt },
      { id:'seleccionador', ok: maxNoWinStreak >= 5,                               at: noWinStreakSince },
    ];

    for (const e of earned) {
      if (!e.ok || !e.at) continue;
      if (e.at < cutoff) continue; // solo recientes
      const def = ALL_ACHIEVEMENTS.find(a => a.id === e.id);
      if (!def) continue;
      results.push({
        pid,
        nombre,
        achievement_id:   def.id,
        achievement_icon: def.icon,
        achievement_name: def.name,
        achievement_desc: def.desc,
        earned_at:        e.at.toISOString()
      });
    }
  }

  // Ordenar por más reciente primero
  results.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));

  // ── Logros manuales recientes ──────────────────────────────
  const manualSheet = getOrCreateSheet('Logros_Manuales',
    ['pid', 'achievement_id', 'earned_at', 'granted_by']);
  const manualRows = manualSheet.getDataRange().getValues();
  const manualH    = manualRows[0];
  const partMap    = {};
  for (let pi = 1; pi < partRows.length; pi++) {
    if (partRows[pi][0]) partMap[String(partRows[pi][0])] = partRows[pi][1];
  }
  for (let i = 1; i < manualRows.length; i++) {
    if (!manualRows[i][0]) continue;
    const mPid  = String(manualRows[i][manualH.indexOf('pid')]);
    const mAid  = String(manualRows[i][manualH.indexOf('achievement_id')]);
    const mAt   = manualRows[i][manualH.indexOf('earned_at')];
    const mDate = mAt instanceof Date ? mAt : new Date(mAt);
    if (isNaN(mDate)) continue;
    if (mDate < cutoff) continue;
    const def = ALL_ACHIEVEMENTS.find(a => a.id === mAid);
    if (!def) continue;
    results.push({
      pid:              mPid,
      nombre:           partMap[mPid] || 'Jugador',
      achievement_id:   def.id,
      achievement_icon: def.icon,
      achievement_name: def.name,
      achievement_desc: def.desc,
      earned_at:        mDate.toISOString()
    });
  }
  // Re-ordenar incluyendo manuales
  results.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));

  return { achievements: results, cutoff: cutoff.toISOString() };
}

// ─────────────────────────────────────────────────────────────
//  GOLEADORES (Bota de Oro)
// ─────────────────────────────────────────────────────────────

function syncScorers() {
  const apiKey = getApiKey();
  if (!apiKey) return;
  try {
    const res = UrlFetchApp.fetch(
      `${API_BASE}/competitions/${COMPETITION_ID}/scorers?limit=20`,
      { headers: { 'X-Auth-Token': apiKey }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return;
    const { scorers } = JSON.parse(res.getContentText());
    if (!scorers || !scorers.length) return;

    const sheet = getOrCreateSheet('Goleadores',
      ['jugador','equipo','goles','asistencias','partidos','timestamp']);
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);

    const now = new Date().toISOString();
    for (const s of scorers) {
      sheet.appendRow([
        s.player?.name || '',
        s.team?.shortName || s.team?.name || '',
        s.goals || 0,
        s.assists || 0,
        s.playedMatches || 0,
        now
      ]);
    }
    Logger.log(`✅ Scorers sync OK — ${scorers.length} jugadores`);
  } catch (err) {
    Logger.log('❌ Scorers sync error: ' + err.message);
  }
}

function getTopScorers() {
  try {
    const sheet   = getOrCreateSheet('Goleadores',
      ['jugador','equipo','goles','asistencias','partidos','timestamp']);
    const rows    = sheet.getDataRange().getValues();
    const headers = rows[0];
    const scorers = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const s = {};
      headers.forEach((h, j) => s[h] = rows[i][j]);
      scorers.push(s);
    }
    return { scorers };
  } catch(_) { return { scorers: [] }; }
}

function getTopScorerName() {
  const { scorers } = getTopScorers();
  return scorers.length > 0 ? scorers[0].jugador : null;
}

/**
 * Devuelve la(s) selección(es) con más goles marcados en todo el torneo,
 * sumando goles_local/goles_visitante de todos los partidos FINISHED de
 * la hoja Partidos (grupos + eliminatorias; en eliminatorias ya son goles
 * a los 90', igual que el resto del sistema de puntos).
 * Devuelve un array porque, en teoría, podría haber empate en el primer puesto.
 * Sustituye a getTopScorerName() para la categoría especial "Máximo Goleador",
 * que ahora se juega por selección y no por jugador individual.
 */
function getTopScoringTeams(matchRows, mHeaders) {
  const goals = {};
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.estado !== 'FINISHED') continue;
    const gl = parseInt(m.goles_local), gv = parseInt(m.goles_visitante);
    if (isNaN(gl) || isNaN(gv)) continue;
    if (m.equipo_local)     goals[m.equipo_local]     = (goals[m.equipo_local]     || 0) + gl;
    if (m.equipo_visitante) goals[m.equipo_visitante] = (goals[m.equipo_visitante] || 0) + gv;
  }
  const entries = Object.entries(goals);
  if (!entries.length) return [];
  const maxGoals = Math.max(...entries.map(([, g]) => g));
  return entries.filter(([, g]) => g === maxGoals).map(([team]) => team);
}

// ─────────────────────────────────────────────────────────────
//  HELPERS RESOLUCIÓN DE ESPECIALES
// ─────────────────────────────────────────────────────────────

function getFinalWinner(matchRows, mHeaders) {
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'FINAL' || m.estado !== 'FINISHED') continue;
    if (m.ganador_final) return m.ganador_final;
    const gl = parseInt(m.goles_local), gv = parseInt(m.goles_visitante);
    if (isNaN(gl) || isNaN(gv)) return null;
    return gl > gv ? m.equipo_local : m.equipo_visitante;
  }
  return null;
}

function getFinalLoser(matchRows, mHeaders) {
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'FINAL' || m.estado !== 'FINISHED') continue;
    if (m.ganador_final) {
      return m.ganador_final === m.equipo_local ? m.equipo_visitante : m.equipo_local;
    }
    const gl = parseInt(m.goles_local), gv = parseInt(m.goles_visitante);
    if (isNaN(gl) || isNaN(gv)) return null;
    return gl > gv ? m.equipo_visitante : m.equipo_local;
  }
  return null;
}

function getSemiFinalists(matchRows, mHeaders) {
  const teams = new Set();
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'SEMI_FINALS') continue;
    if (m.equipo_local     && m.equipo_local     !== 'TBD') teams.add(m.equipo_local);
    if (m.equipo_visitante && m.equipo_visitante !== 'TBD') teams.add(m.equipo_visitante);
  }
  return [...teams];
}

function isEliminatedInGroups(teamName, matchRows, mHeaders) {
  let teamGroup = null;
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'GROUP_STAGE') continue;
    if (m.equipo_local === teamName || m.equipo_visitante === teamName) {
      teamGroup = m.grupo; break;
    }
  }
  if (!teamGroup) return false;

  const groupTeams = {};
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'GROUP_STAGE' || m.grupo !== teamGroup) continue;
    if (m.estado !== 'FINISHED') return false;

    const gl = parseInt(m.goles_local), gv = parseInt(m.goles_visitante);
    if (isNaN(gl) || isNaN(gv)) return false;

    [m.equipo_local, m.equipo_visitante].forEach(t => {
      if (t && !groupTeams[t]) groupTeams[t] = { pts: 0, gd: 0, gf: 0 };
    });
    groupTeams[m.equipo_local].gf    += gl;
    groupTeams[m.equipo_local].gd    += gl - gv;
    groupTeams[m.equipo_visitante].gf += gv;
    groupTeams[m.equipo_visitante].gd += gv - gl;

    if      (gl > gv) groupTeams[m.equipo_local].pts += 3;
    else if (gl < gv) groupTeams[m.equipo_visitante].pts += 3;
    else { groupTeams[m.equipo_local].pts++; groupTeams[m.equipo_visitante].pts++; }
  }

  const sorted = Object.entries(groupTeams)
    .sort(([,a], [,b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    .map(([name]) => name);

  return sorted.indexOf(teamName) >= 2;
}

// ─────────────────────────────────────────────────────────────
//  CÁLCULO DE PUNTOS
// ─────────────────────────────────────────────────────────────

function calculateAllPoints() {
  const partRows = getSheet('Participantes').getDataRange().getValues();
  for (let i = 1; i < partRows.length; i++) {
    if (!partRows[i][0]) continue;
    const pts = calculatePoints(partRows[i][0]);
    updatePuntuaciones(partRows[i][0], partRows[i][1], pts);
  }
  saveRankingSnapshot();
}

function calculatePoints(pid) {
  const matchRows = getSheet('Partidos').getDataRange().getValues();
  const predRows  = getSheet('Predicciones').getDataRange().getValues();
  const specRows  = getSheet('Predicciones_Especiales').getDataRange().getValues();
  const mHeaders  = matchRows[0];
  const pHeaders  = predRows[0];
  const sHeaders  = specRows[0];

  const jokerMid = getJokerMatchId(pid);

  let equipoEstrella = '', campeon = '', finalista = '', semi1 = '', semi2 = '', goleador = '', sorpresa = '';
  for (let i = 1; i < specRows.length; i++) {
    if (String(specRows[i][0]) !== String(pid)) continue;
    campeon   = specRows[i][sHeaders.indexOf('campeon')]   || '';
    finalista = specRows[i][sHeaders.indexOf('finalista')] || '';
    semi1     = specRows[i][sHeaders.indexOf('semi1')]     || '';
    semi2     = specRows[i][sHeaders.indexOf('semi2')]     || '';
    goleador  = specRows[i][sHeaders.indexOf('goleador')]  || '';
    sorpresa  = specRows[i][sHeaders.indexOf('sorpresa')]  || '';
    const eeIdx = sHeaders.indexOf('equipo_estrella');
    equipoEstrella = eeIdx >= 0 ? (specRows[i][eeIdx] || '') : '';
    break;
  }

  const matches = {};
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.estado === 'FINISHED' && m.id) matches[String(m.id)] = m;
  }

  let ptsGrupos = 0, ptsElim = 0, ptsSpec = 0;

  for (let i = 1; i < predRows.length; i++) {
    if (String(predRows[i][0]) !== String(pid)) continue;
    const p = {};
    pHeaders.forEach((h, j) => p[h] = predRows[i][j]);

    const match = matches[String(p.partido_id)];
    if (!match) continue;

    const glR = parseInt(match.goles_local),  gvR = parseInt(match.goles_visitante);
    const glP = parseInt(p.goles_local),       gvP = parseInt(p.goles_visitante);
    if ([glR, gvR, glP, gvP].some(isNaN)) continue;

    let pts = 0;
    if (match.fase === 'GROUP_STAGE') {
      if (glP === glR && gvP === gvR)                  pts = 4;
      else if (winner(glP, gvP) === winner(glR, gvR))  pts = 2;
    } else {
      if (winner(glP, gvP) === winner(glR, gvR)) {
        pts = 4;
        if (glP === glR && gvP === gvR) pts += 3;
      }
    }

    if (pts > 0 && equipoEstrella &&
        (match.equipo_local === equipoEstrella || match.equipo_visitante === equipoEstrella)) {
      pts += 1;
    }

    if (jokerMid && String(match.id) === jokerMid) pts *= 2;

    if (match.fase === 'GROUP_STAGE') ptsGrupos += pts;
    else ptsElim += pts;
  }

  const champion = getFinalWinner(matchRows, mHeaders);
  if (champion && campeon === champion)   ptsSpec += 10;

  const finalist = getFinalLoser(matchRows, mHeaders);
  if (finalist && finalista === finalist) ptsSpec += 5;

  const semis = getSemiFinalists(matchRows, mHeaders);
  if (semi1 && semis.includes(semi1))     ptsSpec += 4;
  if (semi2 && semis.includes(semi2))     ptsSpec += 4;

  const topTeams = getTopScoringTeams(matchRows, mHeaders);
  if (goleador && topTeams.includes(goleador)) ptsSpec += 8;

  if (sorpresa && FAVORITES.includes(sorpresa) &&
      isEliminatedInGroups(sorpresa, matchRows, mHeaders)) {
    ptsSpec += 6;
  }

  // Puntos de preguntas en vivo (resueltas y acertadas)
  try {
    const qSheet = getOrCreateSheet('Preguntas_Vivo',
      ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
    const qRows = qSheet.getDataRange().getValues();
    const qH    = qRows[0];

    const rSheet = getOrCreateSheet('Respuestas_Vivo',
      ['pregunta_id','participante_id','respuesta','timestamp']);
    const rRows = rSheet.getDataRange().getValues();
    const rH    = rRows[0];

    // Construir mapa de preguntas resueltas: id → { respuesta_correcta, puntos }
    const resolvedQ = {};
    for (let i = 1; i < qRows.length; i++) {
      if (String(qRows[i][qH.indexOf('estado')]) === 'resuelta') {
        const qid = String(qRows[i][qH.indexOf('id')]);
        resolvedQ[qid] = {
          correcta: String(qRows[i][qH.indexOf('respuesta_correcta')]),
          puntos:   Number(qRows[i][qH.indexOf('puntos')]) || 1
        };
      }
    }

    // Sumar puntos si el usuario acertó
    for (let i = 1; i < rRows.length; i++) {
      if (String(rRows[i][rH.indexOf('participante_id')]) !== String(pid)) continue;
      const qid = String(rRows[i][rH.indexOf('pregunta_id')]);
      const q   = resolvedQ[qid];
      if (!q) continue;
      if (String(rRows[i][rH.indexOf('respuesta')]) === q.correcta) {
        ptsSpec += q.puntos;
      }
    }
  } catch(e) {
    // Si las hojas no existen aún, ignorar
  }

  // Puntos de retos (resueltos)
  try {
    const rSheet = getOrCreateSheet('Retos',
      ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
    const rRows = rSheet.getDataRange().getValues();
    const rH    = rRows[0];
    for (let i = 1; i < rRows.length; i++) {
      if (String(rRows[i][rH.indexOf('estado')]) !== 'resuelto') continue;
      const retadorId = String(rRows[i][rH.indexOf('retador_id')]);
      const retadoId  = String(rRows[i][rH.indexOf('retado_id')]);
      const resultado = String(rRows[i][rH.indexOf('resultado')]);
      if (retadorId !== String(pid) && retadoId !== String(pid)) continue;
      const esRetador = retadorId === String(pid);
      // ganador +1, perdedor -1, empate 0
      if (resultado === 'empate') continue;
      const ganoRetador = resultado === 'retador';
      if (esRetador)  ptsSpec += ganoRetador ? 1 : -1;
      else            ptsSpec += ganoRetador ? -1 : 1;
    }
  } catch(e) {}

  // Puntos de duelos automáticos obligatorios (resueltos) — octavos en adelante
  try {
    const dSheet = getOrCreateSheet('Duelos',
      ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
    const dRows = dSheet.getDataRange().getValues();
    const dH    = dRows[0];
    for (let i = 1; i < dRows.length; i++) {
      if (String(dRows[i][dH.indexOf('resuelto')]) !== 'true') continue;
      const pidA = String(dRows[i][dH.indexOf('pid_a')]);
      const pidB = String(dRows[i][dH.indexOf('pid_b')]);
      if (pidA !== String(pid) && pidB !== String(pid)) continue;
      const esA = pidA === String(pid);
      const resultado = esA
        ? String(dRows[i][dH.indexOf('resultado_a')])
        : String(dRows[i][dH.indexOf('resultado_b')]);
      // ganador +1, perdedor -1, empate 0
      if (resultado === 'W') ptsSpec += 1;
      else if (resultado === 'L') ptsSpec -= 1;
    }
  } catch(e) {}

  return { grupos: ptsGrupos, elim: ptsElim, spec: ptsSpec, total: ptsGrupos + ptsElim + ptsSpec };
}

function updatePuntuaciones(pid, nombre, pts) {
  const sheet = getSheet('Puntuaciones');
  const rows  = sheet.getDataRange().getValues();
  let existingRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(pid)) { existingRow = i + 1; break; }
  }
  const row = [pid, nombre, pts.grupos, pts.elim, pts.spec, pts.total, new Date().toISOString()];
  if (existingRow > 0) sheet.getRange(existingRow, 1, 1, 7).setValues([row]);
  else sheet.appendRow(row);
}

// ─────────────────────────────────────────────────────────────
//  PREGUNTAS EN VIVO
// ─────────────────────────────────────────────────────────────

/**
 * Devuelve la pregunta activa si:
 *  - existe una fila con estado = 'activa' en Preguntas_Vivo
 *  - el partido asociado está en juego (estado IN_PLAY o PAUSED en Partidos)
 *  - el usuario (pid) aún no ha respondido
 * Incluye si el usuario ya respondió (para que el frontend no vuelva a mostrarla).
 */
function getActiveLiveQuestion(pid) {
  const qSheet = getOrCreateSheet('Preguntas_Vivo',
    ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
  const qRows = qSheet.getDataRange().getValues();
  const qH    = qRows[0];

  // Buscar primera pregunta activa
  let question = null;
  for (let i = 1; i < qRows.length; i++) {
    if (String(qRows[i][qH.indexOf('estado')]) === 'activa') {
      question = {};
      qH.forEach((h, j) => question[h] = qRows[i][j]);
      break;
    }
  }
  if (!question) return { question: null };

  // Verificar que el partido está en juego
  const matchSheet = getSheet('Partidos');
  const matchRows  = matchSheet.getDataRange().getValues();
  const mH         = matchRows[0];
  let match = null;
  for (let i = 1; i < matchRows.length; i++) {
    if (String(matchRows[i][mH.indexOf('id')]) === String(question.partido_id)) {
      match = {};
      mH.forEach((h, j) => match[h] = matchRows[i][j]);
      break;
    }
  }
  const liveStates = ['IN_PLAY', 'PAUSED', 'HALFTIME'];
  if (!match || !liveStates.includes(String(match.estado))) return { question: null };

  // Verificar que no ha expirado el tiempo de respuesta
  const cierraEn = question.cierra_en ? new Date(question.cierra_en) : null;
  if (cierraEn && new Date() > cierraEn) return { question: null, expired: true };

  // Verificar si el usuario ya respondió
  let answered = false;
  let userAnswer = null;
  if (pid) {
    const rSheet = getOrCreateSheet('Respuestas_Vivo',
      ['pregunta_id','participante_id','respuesta','timestamp']);
    const rRows = rSheet.getDataRange().getValues();
    const rH    = rRows[0];
    for (let i = 1; i < rRows.length; i++) {
      if (String(rRows[i][rH.indexOf('pregunta_id')])    === String(question.id) &&
          String(rRows[i][rH.indexOf('participante_id')]) === String(pid)) {
        answered   = true;
        userAnswer = rRows[i][rH.indexOf('respuesta')];
        break;
      }
    }
  }

  return {
    question: {
      id:        question.id,
      pregunta:  question.pregunta,
      opciones:  String(question.opciones).split(',').map(o => o.trim()),
      puntos:    Number(question.puntos) || 1,
      cierraEn:  question.cierra_en ? new Date(question.cierra_en).toISOString() : null,
      partido:   { local: match.equipo_local, visitante: match.equipo_visitante }
    },
    answered,
    userAnswer
  };
}

/**
 * Guarda la respuesta de un usuario a la pregunta activa.
 * Rechaza si ya respondió o si la pregunta ya no está activa.
 */
function saveLiveAnswer(data) {
  const qSheet = getOrCreateSheet('Preguntas_Vivo',
    ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
  const qRows = qSheet.getDataRange().getValues();
  const qH    = qRows[0];

  let question = null;
  for (let i = 1; i < qRows.length; i++) {
    if (String(qRows[i][qH.indexOf('id')]) === String(data.qid)) {
      question = {};
      qH.forEach((h, j) => question[h] = qRows[i][j]);
      break;
    }
  }
  if (!question)                              return { error: 'Pregunta no encontrada' };
  if (String(question.estado) !== 'activa')  return { error: 'Esta pregunta ya no está activa' };

  // Verificar que no ha expirado el tiempo
  const cierraEn = question.cierra_en ? new Date(question.cierra_en) : null;
  if (cierraEn && new Date() > cierraEn)     return { error: 'El tiempo para responder ha terminado' };

  const rSheet = getOrCreateSheet('Respuestas_Vivo',
    ['pregunta_id','participante_id','respuesta','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  for (let i = 1; i < rRows.length; i++) {
    if (String(rRows[i][rH.indexOf('pregunta_id')])    === String(data.qid) &&
        String(rRows[i][rH.indexOf('participante_id')]) === String(data.pid)) {
      return { error: 'Ya has respondido esta pregunta' };
    }
  }

  rSheet.appendRow([data.qid, data.pid, data.respuesta, new Date().toISOString()]);
  return { success: true };
}

/**
 * Crea una nueva pregunta en vivo (llamado desde admin.html).
 * Solo puede haber una pregunta activa a la vez.
 */
function createLiveQuestion(data) {
  const qSheet = getOrCreateSheet('Preguntas_Vivo',
    ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
  const qRows = qSheet.getDataRange().getValues();
  const qH    = qRows[0];

  // Verificar que no hay ya una activa
  for (let i = 1; i < qRows.length; i++) {
    if (String(qRows[i][qH.indexOf('estado')]) === 'activa') {
      return { error: 'Ya hay una pregunta activa. Resuélvela antes de crear otra.' };
    }
  }

  const id = Utilities.getUuid();
  const minutos = Number(data.minutos) || 10;
  const cierraEn = new Date(Date.now() + minutos * 60 * 1000).toISOString();
  qSheet.appendRow([
    id,
    data.partido_id  || '',
    data.pregunta    || '',
    data.opciones    || '',
    Number(data.puntos) || 1,
    '',
    'activa',
    new Date().toISOString(),
    cierraEn
  ]);
  return { success: true, id };
}

/**
 * Resuelve una pregunta: marca la correcta, reparte puntos extra y cierra la pregunta.
 */
function resolveLiveQuestion(data) {
  const qSheet = getOrCreateSheet('Preguntas_Vivo',
    ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
  const qRows = qSheet.getDataRange().getValues();
  const qH    = qRows[0];

  let qRowNum = -1;
  let question = null;
  for (let i = 1; i < qRows.length; i++) {
    if (String(qRows[i][qH.indexOf('id')]) === String(data.qid)) {
      qRowNum  = i + 1;
      question = {};
      qH.forEach((h, j) => question[h] = qRows[i][j]);
      break;
    }
  }
  if (!question) return { error: 'Pregunta no encontrada' };

  const puntos = Number(question.puntos) || 1;

  // Guardar respuesta correcta y cerrar
  qSheet.getRange(qRowNum, qH.indexOf('respuesta_correcta') + 1).setValue(data.respuesta_correcta);
  qSheet.getRange(qRowNum, qH.indexOf('estado') + 1).setValue('resuelta');

  // Contar aciertos
  const rSheet = getOrCreateSheet('Respuestas_Vivo',
    ['pregunta_id','participante_id','respuesta','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  let aciertos = 0;
  const acertaron = [];
  for (let i = 1; i < rRows.length; i++) {
    if (String(rRows[i][rH.indexOf('pregunta_id')]) !== String(data.qid)) continue;
    if (String(rRows[i][rH.indexOf('respuesta')]) !== String(data.respuesta_correcta)) continue;
    acertaron.push(String(rRows[i][rH.indexOf('participante_id')]));
    aciertos++;
  }

  // Recalcular puntuaciones de quienes acertaron para que se incluyan los pts de vivo
  const partRows = getSheet('Participantes').getDataRange().getValues();
  for (let i = 1; i < partRows.length; i++) {
    const pid    = String(partRows[i][0]);
    const nombre = String(partRows[i][1]);
    if (!acertaron.includes(pid)) continue;
    const pts = calculatePoints(pid);
    updatePuntuaciones(pid, nombre, pts);
  }

  return { success: true, aciertos, puntos };
}

/**
 * Cancela/elimina una pregunta activa sin resolver (por si hubo error al crearla).
 */
function deleteLiveQuestion(data) {
  const qSheet = getOrCreateSheet('Preguntas_Vivo',
    ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada']);
  const qRows = qSheet.getDataRange().getValues();
  const qH    = qRows[0];

  for (let i = 1; i < qRows.length; i++) {
    if (String(qRows[i][qH.indexOf('id')]) === String(data.qid)) {
      qSheet.getRange(i + 1, qH.indexOf('estado') + 1).setValue('cancelada');
      return { success: true };
    }
  }
  return { error: 'Pregunta no encontrada' };
}

/**
 * Devuelve todas las respuestas de una pregunta (para el panel admin).
 */
function getLiveAnswers(qid) {
  const rSheet = getOrCreateSheet('Respuestas_Vivo',
    ['pregunta_id','participante_id','respuesta','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  const partRows = getSheet('Participantes').getDataRange().getValues();
  const nameMap  = {};
  for (let i = 1; i < partRows.length; i++) {
    if (partRows[i][0]) nameMap[String(partRows[i][0])] = partRows[i][1];
  }

  const answers = [];
  const tally   = {};
  for (let i = 1; i < rRows.length; i++) {
    if (String(rRows[i][rH.indexOf('pregunta_id')]) !== String(qid)) continue;
    const pid      = String(rRows[i][rH.indexOf('participante_id')]);
    const respuesta = String(rRows[i][rH.indexOf('respuesta')]);
    answers.push({ nombre: nameMap[pid] || pid, respuesta });
    tally[respuesta] = (tally[respuesta] || 0) + 1;
  }
  return { answers, tally, total: answers.length };
}

// ─────────────────────────────────────────────────────────────
//  SINCRONIZACIÓN CON football-data.org
// ─────────────────────────────────────────────────────────────

function syncResults() {
  const apiKey = getApiKey();
  if (!apiKey) { Logger.log('❌ No hay API key. Ejecuta setApiKey("tu_key")'); return; }

  try {
    const res = UrlFetchApp.fetch(`${API_BASE}/competitions/${COMPETITION_ID}/matches`, {
      headers: { 'X-Auth-Token': apiKey },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('❌ API Error (' + res.getResponseCode() + '): ' + res.getContentText().substring(0, 200));
      return;
    }
    const { matches } = JSON.parse(res.getContentText());
    updatePartidos(matches);
    syncScorers();
    calculateAllPoints();
    resolverRetos();
    resolveDailyDuels();
    Logger.log(`✅ Sync OK — ${matches.length} partidos — ${new Date().toLocaleString('es-ES')}`);
  } catch (err) {
    Logger.log('❌ Sync error: ' + err.message);
  }
}

function updatePartidos(apiMatches) {
  const sheet   = getSheet('Partidos');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol   = headers.indexOf('id');
  const existingIds = new Set(rows.slice(1).map(r => String(r[idCol])));

  for (const m of apiMatches) {
    const id      = String(m.id);
    const kickoff = m.utcDate;
    const grupo   = m.group ? m.group.replace('GROUP_', '') : '';
    const fase    = m.stage || 'UNKNOWN';
    const localN  = m.homeTeam?.shortName || m.homeTeam?.name || 'TBD';
    const visitN  = m.awayTeam?.shortName || m.awayTeam?.name || 'TBD';
    const localC  = m.homeTeam?.crest || '';
    const visitC  = m.awayTeam?.crest || '';
    // Usamos regularTime (resultado a los 90') cuando existe, ya que fullTime
    // puede incluir prórroga/penaltis en partidos de eliminatoria. Si regularTime
    // no viene informado (partidos sin prórroga), caemos a fullTime como fallback.
    let golesL  = m.score?.regularTime?.home ?? m.score?.fullTime?.home ?? '';
    let golesV  = m.score?.regularTime?.away ?? m.score?.fullTime?.away ?? '';
    let estado  = m.status || 'SCHEDULED';
    const estadio = m.venue || '';

    // ── GUARDA ANTI-CONTAMINACIÓN (bug duelos 11-12/07/2026) ──
    // Justo al acabar un partido de eliminatoria con prórroga/penaltis, la API
    // puede marcar FINISHED con duration !== 'REGULAR' pero SIN regularTime
    // todavía. En esa ventana el fallback a fullTime escribiría el marcador
    // inflado con la prórroga, y resolveDailyDuels congelaría el duelo con
    // puntos erróneos. Si detectamos esa ventana, tratamos el partido como
    // IN_PLAY y no escribimos goles: al siguiente ciclo de 5 min regularTime
    // ya estará estable y todo fluye con el marcador de 90' correcto.
    if (fase !== 'GROUP_STAGE' && estado === 'FINISHED' &&
        m.score?.duration && m.score.duration !== 'REGULAR' &&
        (m.score?.regularTime?.home == null || m.score?.regularTime?.away == null)) {
      estado = 'IN_PLAY';
      golesL = '';
      golesV = '';
      Logger.log('⏳ Partido ' + id + ' (' + localN + ' vs ' + visitN + '): FINISHED con ' +
                 m.score.duration + ' pero sin regularTime aún. Difiriendo al siguiente ciclo.');
    }
    const jornada = m.matchday || '';

    // ganador_final: equipo que realmente avanza en eliminatoria (tras prórroga/penaltis
    // si los hubo). NO usamos m.score.winner porque hemos comprobado que es inestable
    // justo después de terminar el partido (fullTime también lo es). En su lugar,
    // sumamos regularTime + extraTime + penalties manualmente, que es estable.
    let ganadorFinal = '';
    if (fase !== 'GROUP_STAGE' && estado === 'FINISHED') {
      const rtL = m.score?.regularTime?.home, rtV = m.score?.regularTime?.away;
      const etL = m.score?.extraTime?.home || 0, etV = m.score?.extraTime?.away || 0;
      const peL = m.score?.penalties?.home, peV = m.score?.penalties?.away;
      if (rtL != null && rtV != null) {
        const totL = rtL + etL, totV = rtV + etV;
        if (totL > totV) ganadorFinal = localN;
        else if (totV > totL) ganadorFinal = visitN;
        else if (peL != null && peV != null) {
          if (peL > peV) ganadorFinal = localN;
          else if (peV > peL) ganadorFinal = visitN;
        }
      }
    }

    if (existingIds.has(id)) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][idCol]) !== id) continue;
        const set = (col, val) => {
          const c = headers.indexOf(col);
          if (c >= 0) sheet.getRange(i + 1, c + 1).setValue(val);
        };
        set('goles_local',     golesL);
        set('goles_visitante', golesV);
        set('estado',          estado);
        if (kickoff) set('kickoff', kickoff);
        if (localN !== 'TBD') set('equipo_local',     localN);
        if (visitN !== 'TBD') set('equipo_visitante', visitN);
        // ganador_final solo lo escribimos si lo hemos podido calcular, para no
        // borrar un valor ya correcto en caso de que la API venga incompleta
        if (ganadorFinal) set('ganador_final', ganadorFinal);
        break;
      }
    } else {
      sheet.appendRow([id, kickoff, grupo, fase, localN, visitN, localC, visitC,
        golesL, golesV, estado, estadio, jornada, ganadorFinal]);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  FIX RETROACTIVO: marcadores de eliminatoria contaminados con
//  prórroga/penaltis (bug corregido el 30/06/2026). Ejecutar UNA VEZ
//  a mano desde el editor y luego borrar/ignorar esta función.
// ─────────────────────────────────────────────────────────────

function fixMarcadoresEliminatoria() {
  const apiKey = getApiKey();
  if (!apiKey) { Logger.log('❌ No hay API key.'); return; }

  const sheet   = getSheet('Partidos');
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol      = headers.indexOf('id');
  const faseCol    = headers.indexOf('fase');
  const estadoCol  = headers.indexOf('estado');
  const localCol   = headers.indexOf('equipo_local');
  const visitCol   = headers.indexOf('equipo_visitante');

  let corregidos = 0;

  for (let i = 1; i < rows.length; i++) {
    const fase   = rows[i][faseCol];
    const estado = rows[i][estadoCol];
    if (fase === 'GROUP_STAGE' || estado !== 'FINISHED') continue;

    const id = rows[i][idCol];
    if (!id) continue;

    const res = UrlFetchApp.fetch(`${API_BASE}/matches/${id}`, {
      headers: { 'X-Auth-Token': apiKey },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log(`⚠️ Error API partido ${id}: ${res.getResponseCode()}`);
      continue;
    }
    const m = JSON.parse(res.getContentText());

    const rtL = m.score?.regularTime?.home, rtV = m.score?.regularTime?.away;
    const ftL = m.score?.fullTime?.home,    ftV = m.score?.fullTime?.away;
    const golesL = rtL ?? ftL ?? '';
    const golesV = rtV ?? ftV ?? '';

    // Recalcular ganador_final igual que en updatePartidos
    let ganadorFinal = '';
    const etL = m.score?.extraTime?.home || 0, etV = m.score?.extraTime?.away || 0;
    const peL = m.score?.penalties?.home, peV = m.score?.penalties?.away;
    if (rtL != null && rtV != null) {
      const totL = rtL + etL, totV = rtV + etV;
      if (totL > totV) ganadorFinal = rows[i][localCol];
      else if (totV > totL) ganadorFinal = rows[i][visitCol];
      else if (peL != null && peV != null) {
        if (peL > peV) ganadorFinal = rows[i][localCol];
        else if (peV > peL) ganadorFinal = rows[i][visitCol];
      }
    }

    const oldGL = rows[i][headers.indexOf('goles_local')];
    const oldGV = rows[i][headers.indexOf('goles_visitante')];

    if (String(oldGL) !== String(golesL) || String(oldGV) !== String(golesV)) {
      sheet.getRange(i + 1, headers.indexOf('goles_local') + 1).setValue(golesL);
      sheet.getRange(i + 1, headers.indexOf('goles_visitante') + 1).setValue(golesV);
      corregidos++;
      Logger.log(`✏️ Partido ${id} (${rows[i][localCol]} vs ${rows[i][visitCol]}): ${oldGL}-${oldGV} → ${golesL}-${golesV}`);
    }
    if (ganadorFinal) {
      sheet.getRange(i + 1, headers.indexOf('ganador_final') + 1).setValue(ganadorFinal);
    }

    Utilities.sleep(300); // evitar rate limit de la API
  }

  Logger.log(`✅ Fix completado: ${corregidos} partido(s) corregido(s).`);
  Logger.log('Recalculando puntos de todos los participantes...');
  calculateAllPoints();
  Logger.log('✅ Puntos recalculados.');
}
// ─────────────────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const schemas = {
    'Participantes':           ['id','nombre','pin_hash','fecha_registro','activo'],
    'Partidos':                ['id','kickoff','grupo','fase','equipo_local','equipo_visitante',
                                'crest_local','crest_visitante','goles_local','goles_visitante',
                                'estado','estadio','jornada','ganador_final'],
    'Predicciones':            ['participante_id','partido_id','goles_local','goles_visitante','timestamp'],
    'Predicciones_Especiales': ['participante_id','campeon','finalista','semi1','semi2',
                                'goleador','sorpresa','equipo_estrella','timestamp'],
    'Puntuaciones':            ['participante_id','nombre','pts_grupos','pts_eliminatorias',
                                'pts_especiales','total','actualizado'],
    'Historico_Ranking':       ['participante_id','nombre','posicion','total',
                                'pts_grupos','pts_elim','pts_spec','timestamp'],
    'Partido_Doble':           ['participante_id','partido_id','timestamp'],
    'Goleadores':              ['jugador','equipo','goles','asistencias','partidos','timestamp'],
    'Preguntas_Vivo':          ['id','partido_id','pregunta','opciones','puntos','respuesta_correcta','estado','creada','cierra_en'],
    'Respuestas_Vivo':         ['pregunta_id','participante_id','respuesta','timestamp'],
    'Duelos':                  ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto'],
    'Retos':                   ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']
  };

  for (const [name, headers] of Object.entries(schemas)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1a1f35').setFontColor('#ffffff').setFontWeight('bold');
    }
  }
  Logger.log('✅ Setup v2.3 completo! Hojas: ' + Object.keys(schemas).join(', '));
}

function setApiKey(key) {
  PropertiesService.getScriptProperties().setProperty('FOOTBALL_API_KEY', key);
  Logger.log('✅ API Key guardada.');
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncResults').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('generateDailyDuels').timeBased().everyDays(1).atHour(0).nearMinute(5).create();
  ScriptApp.newTrigger('checkAutoLock').timeBased().everyMinutes(5).create();
  Logger.log('✅ Triggers: syncResults() cada 5 min + generateDailyDuels() a medianoche + checkAutoLock() cada 5 min.');
}

// ─────────────────────────────────────────────────────────────
//  BLOQUEO FINAL — pantalla de "cierre" antes de revelar campeón
// ─────────────────────────────────────────────────────────────
//  Usa PropertiesService (no Sheets) porque son solo 3 flags de
//  singleton que se leen en cada carga de página; nada que auditar
//  ni cruzar con otras hojas.
//
//  BLOQUEO_ACTIVO           'true' | 'false'
//  BLOQUEO_HORA_DESBLOQUEO  ISO string — hora objetivo mostrada en el
//                           countdown (informativa; el desbloqueo real
//                           siempre lo dispara el admin a mano)
//  BLOQUEO_AUTO_DONE        'true' una vez que el trigger automático (o el
//                           admin) ha activado el bloqueo una vez, para
//                           que no se reactive solo si luego se desactiva
// ─────────────────────────────────────────────────────────────

const ADMIN_PIN_BLOQUEO = '2901';
const BLOQUEO_HORA_ACTIVACION = '22:10'; // hora Madrid, formato HH:mm

function getLockStatus() {
  const props = PropertiesService.getScriptProperties();
  return {
    activo: props.getProperty('BLOQUEO_ACTIVO') === 'true',
    horaDesbloqueo: props.getProperty('BLOQUEO_HORA_DESBLOQUEO') || null,
    waitingCount: getWaitingCount(),
    porraFinalizada: props.getProperty('PORRA_FINALIZADA') === 'true',
    revealTriggeredAt: props.getProperty('REVEAL_TRIGGERED_AT') || null
  };
}

/**
 * Fija la hora "objetivo" de desbloqueo mostrada en el countdown:
 * las 18:00 (hora Madrid) del día siguiente al momento de activación.
 * Es solo informativa — el desbloqueo real lo hace el admin a mano.
 */
function calcularHoraObjetivoDesbloqueo() {
  const ahora = new Date();
  const mananaMadrid = new Date(ahora.getTime());
  mananaMadrid.setDate(mananaMadrid.getDate() + 1);
  const mananaStr = Utilities.formatDate(mananaMadrid, 'Europe/Madrid', 'yyyy-MM-dd');
  const fecha = Utilities.parseDate(mananaStr + ' 18:00:00', 'Europe/Madrid', 'yyyy-MM-dd HH:mm:ss');
  return fecha.toISOString();
}

/**
 * Activa/desactiva el bloqueo manualmente desde admin.html (requiere PIN).
 * data: { activo: true|false, pin: '2901' }
 *
 * IMPORTANTE: desactivar el bloqueo (activo:false) es también la señal que
 * dispara la revelación del campeón (podio en suspense + popup fijo) para
 * todo el mundo. Se marca con REVEAL_TRIGGERED_AT para que el frontend sepa
 * que es un evento "nuevo" y reproduzca la animación una vez por navegador.
 */
function setLockStatus(data) {
  if (String(data.pin) !== ADMIN_PIN_BLOQUEO) return { error: 'PIN incorrecto' };
  const props = PropertiesService.getScriptProperties();

  if (data.activo) {
    props.setProperty('BLOQUEO_ACTIVO', 'true');
    if (!props.getProperty('BLOQUEO_HORA_DESBLOQUEO')) {
      props.setProperty('BLOQUEO_HORA_DESBLOQUEO', calcularHoraObjetivoDesbloqueo());
    }
    props.setProperty('BLOQUEO_AUTO_DONE', 'true'); // evita que el trigger lo reactive luego
  } else {
    props.setProperty('BLOQUEO_ACTIVO', 'false');
    props.setProperty('PORRA_FINALIZADA', 'true');
    props.setProperty('REVEAL_TRIGGERED_AT', new Date().toISOString());
  }
  return { success: true, activo: data.activo === true };
}

/**
 * Retira del todo la celebración del campeón (popup fijo). A partir de
 * este momento nadie vuelve a verlo, aunque recarguen la página.
 * data: { pin: '2901' }
 */
function retirarCierre(data) {
  if (String(data.pin) !== ADMIN_PIN_BLOQUEO) return { error: 'PIN incorrecto' };
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PORRA_FINALIZADA', 'false');
  return { success: true };
}

/**
 * Trigger horario (cada 5 min, ver setupTriggers). Activa el bloqueo
 * automáticamente una sola vez, a las 22:10 hora de Madrid.
 * Si el admin ya lo activó/desactivó a mano antes, no hace nada
 * (BLOQUEO_AUTO_DONE evita una doble activación).
 */
function checkAutoLock() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('BLOQUEO_AUTO_DONE') === 'true') return;

  const horaActual = Utilities.formatDate(new Date(), 'Europe/Madrid', 'HH:mm');
  if (horaActual >= BLOQUEO_HORA_ACTIVACION) {
    props.setProperty('BLOQUEO_ACTIVO', 'true');
    props.setProperty('BLOQUEO_HORA_DESBLOQUEO', calcularHoraObjetivoDesbloqueo());
    props.setProperty('BLOQUEO_AUTO_DONE', 'true');
    Logger.log('🔒 Bloqueo automático activado a las ' + horaActual + ' (Madrid).');
  }
}

/**
 * Contador de "gente esperando": cada participante manda un ping único
 * cuando le aparece el overlay de bloqueo. Se guarda en CacheService
 * (no en Sheets) porque es un dato efímero de una ventana de ~10 min.
 */
function getWaitingCount() {
  const list = leerListaEspera_();
  return list.length;
}

function pingWaiting(data) {
  const pid = String(data.pid || '').trim();
  if (!pid) return { success: false, waitingCount: getWaitingCount() };

  const cache = CacheService.getScriptCache();
  let list = leerListaEspera_();

  const idx = list.findIndex(it => it.pid === pid);
  const now = Date.now();
  if (idx >= 0) list[idx].ts = now; else list.push({ pid: pid, ts: now });

  cache.put('BLOQUEO_WAITING_LIST', JSON.stringify(list), 1800); // TTL caché 30 min
  return { success: true, waitingCount: list.length };
}

// Lee la lista de pings y descarta los de hace más de 10 minutos.
function leerListaEspera_() {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('BLOQUEO_WAITING_LIST');
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch (e) { return []; }
  const WINDOW_MS = 10 * 60 * 1000;
  const now = Date.now();
  return list.filter(it => (now - it.ts) < WINDOW_MS);
}

/**
 * Resetea todos los flags de bloqueo. Ejecutar a mano desde el editor
 * de Apps Script si hay que repetir la secuencia de cierre (pruebas,
 * o un futuro torneo).
 */
function resetBloqueo() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('BLOQUEO_ACTIVO');
  props.deleteProperty('BLOQUEO_HORA_DESBLOQUEO');
  props.deleteProperty('BLOQUEO_AUTO_DONE');
  props.deleteProperty('PORRA_FINALIZADA');
  props.deleteProperty('REVEAL_TRIGGERED_AT');
  CacheService.getScriptCache().remove('BLOQUEO_WAITING_LIST');
  Logger.log('✅ Bloqueo reseteado.');
}

// ─────────────────────────────────────────────────────────────
//  DUELOS DIARIOS
// ─────────────────────────────────────────────────────────────

/**
 * Genera los emparejamientos OBLIGATORIOS del día si hay partidos de eliminatoria
 * programados (a partir de octavos de final; la fase de grupos usó el sistema
 * de retos manuales y no genera duelos automáticos).
 * Se llama automáticamente a medianoche via trigger.
 * Si ya existen duelos para hoy, no hace nada.
 */
function generateDailyDuels() {
  const today = todayMadrid(); // YYYY-MM-DD hora Madrid

  // Comprobar si hay partidos de ELIMINATORIA hoy (octavos en adelante)
  const mSheet  = getSheet('Partidos');
  const mRows   = mSheet.getDataRange().getValues();
  const mH      = mRows[0];
  let hasMatchesToday = false;
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const fase = String(mRows[i][mH.indexOf('fase')] || '');
    if (fase === 'GROUP_STAGE') continue; // grupos no generan duelos automáticos
    const kickoffRaw = mRows[i][mH.indexOf('kickoff')];
    if (fechaMadrid(kickoffRaw) === today) { hasMatchesToday = true; break; }
  }
  if (!hasMatchesToday) {
    Logger.log('generateDailyDuels: no hay partidos de eliminatoria hoy (' + today + '), sin duelos.');
    return;
  }

  const dSheet = getOrCreateSheet('Duelos',
    ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
  const dRows  = dSheet.getDataRange().getValues();

  // Comprobar que no existen ya duelos para hoy
  for (let i = 1; i < dRows.length; i++) {
    const rawF = dRows[i][0];
    const f = rawF instanceof Date ? Utilities.formatDate(rawF, 'Europe/Madrid', 'yyyy-MM-dd') : String(rawF).slice(0, 10);
    if (f === today) {
      Logger.log('generateDailyDuels: ya hay duelos para hoy.');
      return;
    }
  }

  // Obtener lista de participantes activos
  const pSheet = getSheet('Participantes');
  const pRows  = pSheet.getDataRange().getValues();
  const pH     = pRows[0];
  const players = [];
  for (let i = 1; i < pRows.length; i++) {
    if (!pRows[i][0]) continue;
    if (String(pRows[i][pH.indexOf('activo')]) === 'false') continue;
    players.push({ id: String(pRows[i][0]), nombre: String(pRows[i][1]) });
  }

  // Barajar con Fisher-Yates
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  // Si número impar, un jugador aleatorio descansa hoy (bye) — nadie se
  // empareja dos veces el mismo día.
  let descansa = null;
  if (players.length % 2 !== 0) {
    descansa = players.pop();
  }

  for (let i = 0; i < players.length; i += 2) {
    const a = players[i];
    const b = players[i + 1];
    dSheet.appendRow([today, a.id, a.nombre, b.id, b.nombre, 0, 0, 'pendiente', 'pendiente', false]);
  }

  if (descansa) {
    Logger.log('generateDailyDuels: ' + descansa.nombre + ' descansa hoy (bye).');
  }
  Logger.log('generateDailyDuels: ' + (players.length / 2) + ' duelos generados para ' + today);
}

/**
 * Resuelve los duelos del día calculando puntos obtenidos por cada jugador.
 * Se llama automáticamente desde syncResults (cada 5 min).
 * Solo resuelve duelos donde resuelto === false, la fecha es <= hoy, Y ADEMÁS
 * todos los partidos programados ese día ya están FINISHED — si no, con el
 * trigger cada 5 min se resolvería en falso (0-0) nada más generarse el duelo,
 * antes de que se jueguen los partidos.
 */
function resolveDailyDuels() {
  const dSheet = getOrCreateSheet('Duelos',
    ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
  const dRows  = dSheet.getDataRange().getValues();
  const dH     = dRows[0];

  const today = todayMadrid();

  // Obtener puntos por día para cada participante desde Predicciones + Partidos
  // Calculamos puntos de partidos FINISHED del día para cada jugador
  const mSheet = getSheet('Partidos');
  const mRows  = mSheet.getDataRange().getValues();
  const mH     = mRows[0];

  // Fechas (kickoff) en las que TODOS los partidos ya han terminado.
  // Un duelo de una fecha solo puede resolverse si esa fecha está aquí.
  const finishedDates = {};   // fecha → true (todos FINISHED)
  const seenDates     = {};   // fecha → { total, finished }
  const lastKickoffMs = {};   // fecha → timestamp (ms) del último kickoff del día
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const kickoffRaw = mRows[i][mH.indexOf('kickoff')];
    const fecha = fechaMadrid(kickoffRaw);
    if (!fecha) continue;
    const estado = String(mRows[i][mH.indexOf('estado')]);
    if (!seenDates[fecha]) seenDates[fecha] = { total: 0, finished: 0 };
    seenDates[fecha].total++;
    if (estado === 'FINISHED') seenDates[fecha].finished++;
    const koMs = (kickoffRaw instanceof Date ? kickoffRaw : new Date(kickoffRaw)).getTime();
    if (!isNaN(koMs) && (!lastKickoffMs[fecha] || koMs > lastKickoffMs[fecha])) {
      lastKickoffMs[fecha] = koMs;
    }
  }
  Object.keys(seenDates).forEach(fecha => {
    finishedDates[fecha] = seenDates[fecha].finished === seenDates[fecha].total;
  });

  const predSheet = getSheet('Predicciones');
  const predRows  = predSheet.getDataRange().getValues();
  const predH     = predRows[0];

  // Construir mapa partido_id → partido (solo FINISHED)
  const matchMap = {};
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const m = {};
    mH.forEach((h, j) => m[h] = mRows[i][j]);
    if (m.estado !== 'FINISHED') continue;
    matchMap[String(m.id)] = m;
  }

  // Función: puntos de un pick
  function calcPickPts(pred, match) {
    const gl = Number(pred.goles_local);
    const gv = Number(pred.goles_visitante);
    const rl = Number(match.goles_local);
    const rv = Number(match.goles_visitante);
    const fase = match.fase || 'GROUP_STAGE';
    const isElim = !fase.includes('GROUP');
    if (isNaN(gl) || isNaN(gv) || isNaN(rl) || isNaN(rv)) return 0;
    if (gl === rl && gv === rv) return isElim ? 7 : 4;
    if (winner(gl, gv) === winner(rl, rv)) return isElim ? 4 : 2;
    return 0;
  }

  // Construir mapa pid → { fecha → pts }
  const ptsByPidByDate = {};
  for (let i = 1; i < predRows.length; i++) {
    if (!predRows[i][0]) continue;
    const pred = {};
    predH.forEach((h, j) => pred[h] = predRows[i][j]);
    const mid = String(pred.partido_id);
    const match = matchMap[mid];
    if (!match) continue;
    const koDate = match.kickoff instanceof Date ? match.kickoff : new Date(match.kickoff);
    const fecha = Utilities.formatDate(koDate, 'Europe/Madrid', 'yyyy-MM-dd');
    const pts   = calcPickPts(pred, match);
    const pid   = String(pred.participante_id);
    if (!ptsByPidByDate[pid]) ptsByPidByDate[pid] = {};
    ptsByPidByDate[pid][fecha] = (ptsByPidByDate[pid][fecha] || 0) + pts;
  }

  // Resolver duelos pendientes
  let resolved = 0;
  for (let i = 1; i < dRows.length; i++) {
    if (!dRows[i][0]) continue;
    if (String(dRows[i][dH.indexOf('resuelto')]) === 'true') continue;
    const rawF = dRows[i][0];
    const fecha = rawF instanceof Date ? Utilities.formatDate(rawF, 'Europe/Madrid', 'yyyy-MM-dd') : String(rawF).slice(0, 10);
    if (fecha > today) continue; // futuro, no tocar
    if (!finishedDates[fecha]) continue; // aún quedan partidos de ese día sin terminar

    // ── COLCHÓN DE SEGURIDAD (bug duelos 11-12/07/2026) ──
    // Aunque todos los partidos figuren FINISHED, esperamos a que hayan pasado
    // al menos 4 horas desde el último kickoff del día antes de congelar el
    // duelo. Un partido con prórroga y penaltis dura ~3h; el margen extra da
    // tiempo a que la API estabilice regularTime y syncResults corrija el
    // marcador de 90' si llegó contaminado con fullTime.
    const BUFFER_MS = 4 * 60 * 60 * 1000;
    if (lastKickoffMs[fecha] && (Date.now() - lastKickoffMs[fecha]) < BUFFER_MS) {
      Logger.log('resolveDailyDuels: ' + fecha + ' terminado pero dentro del colchón de 4h. Esperando.');
      continue;
    }

    const pidA  = String(dRows[i][dH.indexOf('pid_a')]);
    const pidB  = String(dRows[i][dH.indexOf('pid_b')]);
    const ptsA  = (ptsByPidByDate[pidA] && ptsByPidByDate[pidA][fecha]) || 0;
    const ptsB  = (ptsByPidByDate[pidB] && ptsByPidByDate[pidB][fecha]) || 0;

    let resA, resB;
    if (ptsA > ptsB)      { resA = 'W'; resB = 'L'; }
    else if (ptsB > ptsA) { resA = 'L'; resB = 'W'; }
    else                  { resA = 'D'; resB = 'D'; }

    const row = i + 1;
    dSheet.getRange(row, dH.indexOf('pts_a') + 1).setValue(ptsA);
    dSheet.getRange(row, dH.indexOf('pts_b') + 1).setValue(ptsB);
    dSheet.getRange(row, dH.indexOf('resultado_a') + 1).setValue(resA);
    dSheet.getRange(row, dH.indexOf('resultado_b') + 1).setValue(resB);
    dSheet.getRange(row, dH.indexOf('resuelto') + 1).setValue(true);
    resolved++;
  }
  Logger.log('resolveDailyDuels: ' + resolved + ' duelos resueltos.');
}

/**
 * Devuelve la tabla de duelos global: victorias/empates/derrotas por jugador,
 * más el duelo de hoy (pendiente o resuelto).
 */
function getDuelos() {
  const dSheet = getOrCreateSheet('Duelos',
    ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
  const dRows  = dSheet.getDataRange().getValues();
  const dH     = dRows[0];
  const today  = todayMadrid();

  const tabla  = {}; // pid → { nombre, W, D, L }
  const hoy    = []; // duelos de hoy

  for (let i = 1; i < dRows.length; i++) {
    if (!dRows[i][0]) continue;
    const rawFecha = dRows[i][0];
    const fecha = rawFecha instanceof Date
      ? Utilities.formatDate(rawFecha, 'Europe/Madrid', 'yyyy-MM-dd')
      : String(rawFecha).slice(0, 10);
    const pidA     = String(dRows[i][dH.indexOf('pid_a')]);
    const nomA     = String(dRows[i][dH.indexOf('nombre_a')]);
    const pidB     = String(dRows[i][dH.indexOf('pid_b')]);
    const nomB     = String(dRows[i][dH.indexOf('nombre_b')]);
    const ptsA     = Number(dRows[i][dH.indexOf('pts_a')]) || 0;
    const ptsB     = Number(dRows[i][dH.indexOf('pts_b')]) || 0;
    const resA     = String(dRows[i][dH.indexOf('resultado_a')]);
    const resB     = String(dRows[i][dH.indexOf('resultado_b')]);
    const resuelto = String(dRows[i][dH.indexOf('resuelto')]) === 'true';

    if (!tabla[pidA]) tabla[pidA] = { nombre: nomA, W: 0, D: 0, L: 0 };
    if (!tabla[pidB]) tabla[pidB] = { nombre: nomB, W: 0, D: 0, L: 0 };

    if (resuelto) {
      if (resA === 'W') tabla[pidA].W++; else if (resA === 'D') tabla[pidA].D++; else tabla[pidA].L++;
      if (resB === 'W') tabla[pidB].W++; else if (resB === 'D') tabla[pidB].D++; else tabla[pidB].L++;
    }

    if (fecha === today) {
      hoy.push({ pidA, nomA, pidB, nomB, ptsA, ptsB, resA, resB, resuelto });
    }
  }

  // Convertir tabla a array ordenado por victorias desc
  const ranking = Object.entries(tabla).map(([pid, d]) => ({
    pid, nombre: d.nombre, W: d.W, D: d.D, L: d.L,
    pts: d.W * 3 + d.D   // puntos estilo liga (W=3, D=1, L=0)
  }));
  ranking.sort((a, b) => b.pts - a.pts || b.W - a.W);

  return { ranking, hoy, updated: new Date().toISOString() };
}

/**
 * Devuelve el historial de duelos de un jugador concreto.
 */
function getDuelosJugador(pid) {
  if (!pid) return { error: 'pid requerido' };
  const dSheet = getOrCreateSheet('Duelos',
    ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
  const dRows  = dSheet.getDataRange().getValues();
  const dH     = dRows[0];

  const historial = [];
  let W = 0, D = 0, L = 0;

  for (let i = 1; i < dRows.length; i++) {
    if (!dRows[i][0]) continue;
    const pidA = String(dRows[i][dH.indexOf('pid_a')]);
    const pidB = String(dRows[i][dH.indexOf('pid_b')]);
    if (pidA !== String(pid) && pidB !== String(pid)) continue;

    const esA      = pidA === String(pid);
    const rawF2    = dRows[i][0];
    const fecha    = rawF2 instanceof Date ? Utilities.formatDate(rawF2, 'Europe/Madrid', 'yyyy-MM-dd') : String(rawF2).slice(0, 10);
    const rival    = esA ? String(dRows[i][dH.indexOf('nombre_b')]) : String(dRows[i][dH.indexOf('nombre_a')]);
    const misPts   = esA ? Number(dRows[i][dH.indexOf('pts_a')]) : Number(dRows[i][dH.indexOf('pts_b')]);
    const susPts   = esA ? Number(dRows[i][dH.indexOf('pts_b')]) : Number(dRows[i][dH.indexOf('pts_a')]);
    const resuelto = String(dRows[i][dH.indexOf('resuelto')]) === 'true';
    const resultado = esA
      ? String(dRows[i][dH.indexOf('resultado_a')])
      : String(dRows[i][dH.indexOf('resultado_b')]);

    if (resuelto) {
      if (resultado === 'W') W++; else if (resultado === 'D') D++; else L++;
    }

    historial.push({ fecha, rival, misPts, susPts, resultado, resuelto });
  }

  historial.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { historial, W, D, L };
}

/**
 * Resetea los duelos de una fecha para que puedan recalcularse.
 * Uso: resetDuelos('2026-06-19')
 * Después ejecuta resolveDailyDuels()
 */
function resetDuelos(fecha) {
  if (!fecha) fecha = todayMadrid();
  const dSheet = getOrCreateSheet('Duelos',
    ['fecha','pid_a','nombre_a','pid_b','nombre_b','pts_a','pts_b','resultado_a','resultado_b','resuelto']);
  const dRows = dSheet.getDataRange().getValues();
  const dH    = dRows[0];
  let count = 0;
  for (let i = 1; i < dRows.length; i++) {
    const rawF = dRows[i][0];
    const f = rawF instanceof Date ? Utilities.formatDate(rawF, 'Europe/Madrid', 'yyyy-MM-dd') : String(rawF).slice(0, 10);
    if (f !== fecha) continue;
    const row = i + 1;
    dSheet.getRange(row, dH.indexOf('pts_a')      + 1).setValue(0);
    dSheet.getRange(row, dH.indexOf('pts_b')      + 1).setValue(0);
    dSheet.getRange(row, dH.indexOf('resultado_a')+ 1).setValue('pendiente');
    dSheet.getRange(row, dH.indexOf('resultado_b')+ 1).setValue('pendiente');
    dSheet.getRange(row, dH.indexOf('resuelto')   + 1).setValue(false);
    count++;
  }
  Logger.log('resetDuelos: ' + count + ' duelos reseteados para ' + fecha);
}

// ─────────────────────────────────────────────────────────────
//  SISTEMA DE RETOS MANUALES
// ─────────────────────────────────────────────────────────────

/**
 * Crea un reto de un jugador a otro sobre un partido concreto.
 * Validaciones: 1 reto activo máximo por jugador, partido no bloqueado, no retarse a sí mismo.
 */
function crearReto(data) {
  const { retadorId, retadorNombre, retadoId, retadoNombre, partidoId } = data;
  if (!retadorId || !retadoId || !partidoId) return { error: 'Faltan datos' };
  if (retadorId === retadoId) return { error: 'No puedes retarte a ti mismo' };

  // Verificar que el partido existe y no está bloqueado
  const mSheet = getSheet('Partidos');
  const mRows  = mSheet.getDataRange().getValues();
  const mH     = mRows[0];
  let match = null;
  for (let i = 1; i < mRows.length; i++) {
    if (String(mRows[i][mH.indexOf('id')]) === String(partidoId)) {
      match = {};
      mH.forEach((h, j) => match[h] = mRows[i][j]);
      break;
    }
  }
  if (!match) return { error: 'Partido no encontrado' };
  if (match.fase && match.fase !== 'GROUP_STAGE') {
    return { error: 'Los duelos ahora son automáticos y obligatorios a partir de octavos de final. Ya no se puede retar manualmente.' };
  }
  if (match.estado === 'FINISHED') return { error: 'Ese partido ya ha terminado' };
  if (match.kickoff) {
    const lockTime = new Date(new Date(match.kickoff).getTime() - 60 * 60 * 1000);
    if (new Date() >= lockTime) return { error: 'Ese partido ya está cerrado para apuestas' };
  }

  const rSheet = getOrCreateSheet('Retos',
    ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  // Verificar que el retador no tiene ya un reto activo
  for (let i = 1; i < rRows.length; i++) {
    const est = String(rRows[i][rH.indexOf('estado')]);
    if (est !== 'pendiente' && est !== 'aceptado') continue;
    const rid = String(rRows[i][rH.indexOf('retador_id')]);
    const tid = String(rRows[i][rH.indexOf('retado_id')]);
    if (rid === String(retadorId) || tid === String(retadorId)) {
      return { error: 'Ya tienes un reto activo. Espera a que se resuelva antes de crear otro.' };
    }
  }

  // Verificar que el retado no tiene ya un reto activo
  for (let i = 1; i < rRows.length; i++) {
    const est = String(rRows[i][rH.indexOf('estado')]);
    if (est !== 'pendiente' && est !== 'aceptado') continue;
    const rid = String(rRows[i][rH.indexOf('retador_id')]);
    const tid = String(rRows[i][rH.indexOf('retado_id')]);
    if (rid === String(retadoId) || tid === String(retadoId)) {
      return { error: retadoNombre + ' ya tiene un reto activo. Inténtalo después.' };
    }
  }

  const id = Utilities.getUuid();
  rSheet.appendRow([
    id, retadorId, retadorNombre, retadoId, retadoNombre,
    partidoId, 'pendiente', 0, 0, '', new Date().toISOString()
  ]);
  return { success: true, id };
}

/**
 * El retado acepta o rechaza el reto.
 */
function responderReto(data) {
  const { retoId, pid, accion } = data; // accion: 'aceptar' | 'rechazar'
  if (!retoId || !pid || !accion) return { error: 'Faltan datos' };

  const rSheet = getOrCreateSheet('Retos',
    ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  for (let i = 1; i < rRows.length; i++) {
    if (String(rRows[i][rH.indexOf('id')]) !== String(retoId)) continue;
    if (String(rRows[i][rH.indexOf('retado_id')]) !== String(pid)) return { error: 'No eres el retado' };
    if (String(rRows[i][rH.indexOf('estado')]) !== 'pendiente') return { error: 'Este reto ya no está pendiente' };

    const nuevoEstado = accion === 'aceptar' ? 'aceptado' : 'rechazado';
    rSheet.getRange(i + 1, rH.indexOf('estado') + 1).setValue(nuevoEstado);
    return { success: true, estado: nuevoEstado };
  }
  return { error: 'Reto no encontrado' };
}

/**
 * Devuelve los retos activos (pendientes/aceptados) y el historial de un jugador.
 */
function getRetos(pid) {
  if (!pid) return { error: 'pid requerido' };

  const rSheet = getOrCreateSheet('Retos',
    ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  // Partidos para mostrar nombre
  const mSheet = getSheet('Partidos');
  const mRows  = mSheet.getDataRange().getValues();
  const mH     = mRows[0];
  const matchMap = {};
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const m = {};
    mH.forEach((h, j) => m[h] = mRows[i][j]);
    matchMap[String(m.id)] = m;
  }

  const activos   = []; // pendiente o aceptado que me afectan
  const historial = []; // resueltos/rechazados/caducados
  let ptsRetos = 0;

  for (let i = 1; i < rRows.length; i++) {
    if (!rRows[i][0]) continue;
    const retadorId = String(rRows[i][rH.indexOf('retador_id')]);
    const retadoId  = String(rRows[i][rH.indexOf('retado_id')]);
    if (retadorId !== String(pid) && retadoId !== String(pid)) continue;

    const esRetador  = retadorId === String(pid);
    const estado     = String(rRows[i][rH.indexOf('estado')]);
    const partidoId  = String(rRows[i][rH.indexOf('partido_id')]);
    const match      = matchMap[partidoId] || {};
    const resultado  = String(rRows[i][rH.indexOf('resultado')]);
    const ptsR       = Number(rRows[i][rH.indexOf('pts_retador')]) || 0;
    const ptsT       = Number(rRows[i][rH.indexOf('pts_retado')])  || 0;

    const reto = {
      id:            String(rRows[i][rH.indexOf('id')]),
      retadorId,
      retadorNombre: String(rRows[i][rH.indexOf('retador_nombre')]),
      retadoId,
      retadoNombre:  String(rRows[i][rH.indexOf('retado_nombre')]),
      rival:         esRetador ? String(rRows[i][rH.indexOf('retado_nombre')]) : String(rRows[i][rH.indexOf('retador_nombre')]),
      esRetador,
      estado,
      partidoId,
      partido:       match.equipo_local ? `${match.equipo_local} vs ${match.equipo_visitante}` : '—',
      kickoff:       match.kickoff || '',
      resultado,
      misPts:        esRetador ? ptsR : ptsT,
      susPts:        esRetador ? ptsT : ptsR,
      timestamp:     String(rRows[i][rH.indexOf('timestamp')])
    };

    // Calcular mi resultado personal
    if (estado === 'resuelto') {
      if (resultado === 'empate') reto.miResultado = 'empate';
      else reto.miResultado = (resultado === 'retador') === esRetador ? 'ganado' : 'perdido';
      const diff = (resultado === 'empate') ? 0 : ((resultado === 'retador') === esRetador ? 1 : -1);
      ptsRetos += diff;
    }

    if (estado === 'pendiente' || estado === 'aceptado') activos.push(reto);
    else historial.push(reto);
  }

  historial.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { activos, historial, ptsRetos };
}

/**
 * Devuelve todos los retos activos (pendientes/aceptados) del grupo.
 * Sin filtrar por jugador — lo usa el index para mostrar duelos de todos.
 */
function getRetosGlobales() {
  const rSheet = getOrCreateSheet('Retos',
    ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  const mSheet = getSheet('Partidos');
  const mRows  = mSheet.getDataRange().getValues();
  const mH     = mRows[0];
  const matchMap = {};
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const m = {};
    mH.forEach((h, j) => m[h] = mRows[i][j]);
    matchMap[String(m.id)] = m;
  }

  const activos = [];
  for (let i = 1; i < rRows.length; i++) {
    if (!rRows[i][0]) continue;
    const estado = String(rRows[i][rH.indexOf('estado')]);
    if (estado !== 'pendiente' && estado !== 'aceptado') continue;

    const partidoId = String(rRows[i][rH.indexOf('partido_id')]);
    const match     = matchMap[partidoId] || {};

    activos.push({
      id:            String(rRows[i][rH.indexOf('id')]),
      retadorId:     String(rRows[i][rH.indexOf('retador_id')]),
      retadorNombre: String(rRows[i][rH.indexOf('retador_nombre')]),
      retadoId:      String(rRows[i][rH.indexOf('retado_id')]),
      retadoNombre:  String(rRows[i][rH.indexOf('retado_nombre')]),
      estado,
      partidoId,
      partido:       match.equipo_local ? `${match.equipo_local} vs ${match.equipo_visitante}` : '—',
      timestamp:     String(rRows[i][rH.indexOf('timestamp')])
    });
  }

  return { activos };
}

/**
 * Resuelve los retos aceptados cuyos partidos ya han terminado.
 * Caduca los retos pendientes cuyo partido ya cerró sin ser aceptados.
 * Se llama desde syncResults.
 */
function resolverRetos() {
  const rSheet = getOrCreateSheet('Retos',
    ['id','retador_id','retador_nombre','retado_id','retado_nombre','partido_id','estado','pts_retador','pts_retado','resultado','timestamp']);
  const rRows = rSheet.getDataRange().getValues();
  const rH    = rRows[0];

  const mSheet = getSheet('Partidos');
  const mRows  = mSheet.getDataRange().getValues();
  const mH     = mRows[0];
  const matchMap = {};
  for (let i = 1; i < mRows.length; i++) {
    if (!mRows[i][0]) continue;
    const m = {};
    mH.forEach((h, j) => m[h] = mRows[i][j]);
    matchMap[String(m.id)] = m;
  }

  const predSheet = getSheet('Predicciones');
  const predRows  = predSheet.getDataRange().getValues();
  const predH     = predRows[0];

  // Mapa pid → { mid → pts }
  const ptsByPidMid = {};
  for (let i = 1; i < predRows.length; i++) {
    if (!predRows[i][0]) continue;
    const pid = String(predRows[i][predH.indexOf('participante_id')]);
    const mid = String(predRows[i][predH.indexOf('partido_id')]);
    const match = matchMap[mid];
    if (!match || match.estado !== 'FINISHED') continue;
    const glP = Number(predRows[i][predH.indexOf('goles_local')]);
    const gvP = Number(predRows[i][predH.indexOf('goles_visitante')]);
    const glR = Number(match.goles_local);
    const gvR = Number(match.goles_visitante);
    if ([glP, gvP, glR, gvR].some(isNaN)) continue;
    let pts = 0;
    const isElim = match.fase && !match.fase.includes('GROUP');
    if (glP === glR && gvP === gvR) pts = isElim ? 7 : 4;
    else if (winner(glP, gvP) === winner(glR, gvR)) pts = isElim ? 4 : 2;
    if (!ptsByPidMid[pid]) ptsByPidMid[pid] = {};
    ptsByPidMid[pid][mid] = pts;
  }

  let resueltos = 0, caducados = 0;
  const now = new Date();

  for (let i = 1; i < rRows.length; i++) {
    if (!rRows[i][0]) continue;
    const estado    = String(rRows[i][rH.indexOf('estado')]);
    const partidoId = String(rRows[i][rH.indexOf('partido_id')]);
    const match     = matchMap[partidoId];
    if (!match) continue;

    // Caducar pendientes cuyo partido ya cerró
    if (estado === 'pendiente') {
      if (match.kickoff) {
        const lockTime = new Date(new Date(match.kickoff).getTime() - 60 * 60 * 1000);
        if (now >= lockTime) {
          rSheet.getRange(i + 1, rH.indexOf('estado') + 1).setValue('caducado');
          caducados++;
        }
      }
      continue;
    }

    if (estado !== 'aceptado') continue;
    if (match.estado !== 'FINISHED') continue;

    const retadorId = String(rRows[i][rH.indexOf('retador_id')]);
    const retadoId  = String(rRows[i][rH.indexOf('retado_id')]);
    const ptsRetador = (ptsByPidMid[retadorId] && ptsByPidMid[retadorId][partidoId]) || 0;
    const ptsRetado  = (ptsByPidMid[retadoId]  && ptsByPidMid[retadoId][partidoId])  || 0;

    let resultado;
    if (ptsRetador > ptsRetado)      resultado = 'retador';
    else if (ptsRetado > ptsRetador) resultado = 'retado';
    else                             resultado = 'empate';

    const row = i + 1;
    rSheet.getRange(row, rH.indexOf('pts_retador') + 1).setValue(ptsRetador);
    rSheet.getRange(row, rH.indexOf('pts_retado')  + 1).setValue(ptsRetado);
    rSheet.getRange(row, rH.indexOf('resultado')   + 1).setValue(resultado);
    rSheet.getRange(row, rH.indexOf('estado')      + 1).setValue('resuelto');
    resueltos++;
  }

  if (resueltos > 0 || caducados > 0) {
    Logger.log(`resolverRetos: ${resueltos} resueltos, ${caducados} caducados.`);
    // Recalcular puntuaciones afectadas
    if (resueltos > 0) calculateAllPoints();
  }
}

// ─────────────────────────────────────────────────────────────
//  LOGROS MANUALES (concedidos por admin)
// ─────────────────────────────────────────────────────────────

const MANUAL_ACHIEVEMENTS = ['extincion_lopez', 'fin_dinastia'];
const ADMIN_PIN_HASH = hashPin('2901');

function grantManualAchievement(data) {
  const { pid, achievement_id, admin_pin } = data;
  if (!pid || !achievement_id || !admin_pin) return { error: 'Faltan parámetros' };
  if (hashPin(String(admin_pin)) !== ADMIN_PIN_HASH) return { error: 'PIN incorrecto' };
  if (!MANUAL_ACHIEVEMENTS.includes(achievement_id)) return { error: 'Logro no válido' };

  // Verificar que el jugador existe
  const partSheet = getSheet('Participantes');
  const partRows  = partSheet.getDataRange().getValues();
  let playerName  = null;
  for (let i = 1; i < partRows.length; i++) {
    if (String(partRows[i][0]) === String(pid)) { playerName = partRows[i][1]; break; }
  }
  if (!playerName) return { error: 'Jugador no encontrado' };

  const sheet = getOrCreateSheet('Logros_Manuales',
    ['pid', 'achievement_id', 'earned_at', 'granted_by']);
  const rows  = sheet.getDataRange().getValues();
  const hdr   = rows[0];

  // Comprobar si ya lo tiene
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][hdr.indexOf('pid')]) === String(pid) &&
        String(rows[i][hdr.indexOf('achievement_id')]) === achievement_id) {
      return { error: playerName + ' ya tiene este logro' };
    }
  }

  sheet.appendRow([pid, achievement_id, new Date().toISOString(), 'admin']);
  return { success: true, player: playerName, achievement_id };
}

function testApiConnection() {
  const apiKey = getApiKey();
  if (!apiKey) { Logger.log('❌ No hay API key'); return; }
  const res = UrlFetchApp.fetch(`${API_BASE}/competitions/${COMPETITION_ID}`, {
    headers: { 'X-Auth-Token': apiKey }, muteHttpExceptions: true
  });
  Logger.log('Status: ' + res.getResponseCode());
  Logger.log('Response: ' + res.getContentText().substring(0, 500));
}
