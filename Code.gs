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
      case 'getAchievements':     return jsonResponse(getAchievements(e.parameter.pid));
      case 'getJoker':            return jsonResponse(getJoker(e.parameter.pid));
      case 'getTopScorers':         return jsonResponse(getTopScorers());
      case 'getActiveLiveQuestion': return jsonResponse(getActiveLiveQuestion(e.parameter.pid));
      case 'getLiveAnswers':        return jsonResponse(getLiveAnswers(e.parameter.qid));
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

  return {
    lider:   { nombre: lider.nombre,   total: lider.total,   pos: lider.pos,   comment: liderLines[seed % liderLines.length] },
    colista: { nombre: colista.nombre, total: colista.total, pos: colista.pos, comment: colistaLines[(seed + 4) % colistaLines.length] },
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
  const topScorer = getTopScorerName();

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
    { key: 'goleador',  icon: '👟', label: 'Máximo Goleador',      pred: goleador,  status: specStatus(goleador,  topScorer, topScorer), pts_posibles: 8,  pts_ganados: topScorer && goleador  === topScorer ? 8  : 0 },
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
    { id:'quinielas',     icon:'🎯', name:'El Quinielas',           desc:'Tu primer resultado exacto' },
    { id:'nostradamus',   icon:'🔮', name:'Nostradamus con Balón',   desc:'5 exactos consecutivos' },
    { id:'var',           icon:'💀', name:'Peor que el VAR',         desc:'3 partidos seguidos a 0 puntos' },
    { id:'pulpo',         icon:'🐙', name:'Paul el Pulpo',           desc:'>75% acierto (mín. 10 partidos)' },
    { id:'nba',           icon:'🏀', name:'¿Esto es la NBA?',        desc:'Exacto en un partido con 4+ goles' },
    { id:'copypaste',     icon:'😴', name:'Copy-Paste FC',            desc:'Mismo marcador en 8+ partidos' },
    { id:'hattrick',      icon:'🔥', name:'Hat-Trick de Sofá',       desc:'3 exactos en el mismo día' },
    { id:'seleccionador', icon:'🤡', name:'Seleccionador Nacional',   desc:'5 partidos seguidos sin acertar el ganador' },
  ];

  return {
    achievements: ALL_ACHIEVEMENTS.map(a => ({ ...a, locked: !earned.includes(a.id) }))
  };
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

// ─────────────────────────────────────────────────────────────
//  HELPERS RESOLUCIÓN DE ESPECIALES
// ─────────────────────────────────────────────────────────────

function getFinalWinner(matchRows, mHeaders) {
  for (let i = 1; i < matchRows.length; i++) {
    const m = {};
    mHeaders.forEach((h, j) => m[h] = matchRows[i][j]);
    if (m.fase !== 'FINAL' || m.estado !== 'FINISHED') continue;
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

  const topScorer = getTopScorerName();
  if (topScorer && goleador === topScorer) ptsSpec += 8;

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
    const golesL  = m.score?.fullTime?.home ?? '';
    const golesV  = m.score?.fullTime?.away ?? '';
    const estado  = m.status || 'SCHEDULED';
    const estadio = m.venue || '';
    const jornada = m.matchday || '';

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
        break;
      }
    } else {
      sheet.appendRow([id, kickoff, grupo, fase, localN, visitN, localC, visitC,
        golesL, golesV, estado, estadio, jornada]);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  SETUP INICIAL
// ─────────────────────────────────────────────────────────────

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const schemas = {
    'Participantes':           ['id','nombre','pin_hash','fecha_registro','activo'],
    'Partidos':                ['id','kickoff','grupo','fase','equipo_local','equipo_visitante',
                                'crest_local','crest_visitante','goles_local','goles_visitante',
                                'estado','estadio','jornada'],
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
    'Respuestas_Vivo':         ['pregunta_id','participante_id','respuesta','timestamp']
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
  Logger.log('✅ Setup v2.2 completo! Hojas: ' + Object.keys(schemas).join(', '));
}

function setApiKey(key) {
  PropertiesService.getScriptProperties().setProperty('FOOTBALL_API_KEY', key);
  Logger.log('✅ API Key guardada.');
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncResults').timeBased().everyMinutes(5).create();
  Logger.log('✅ Trigger: syncResults() cada 5 minutos.');
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
