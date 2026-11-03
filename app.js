'use strict';

/* =========================================================
   Pacto de hábitos para dos
   - Todo el estado vive en un solo objeto JSON compartido.
   - Las rachas y los regalos se calculan a partir de los días marcados.
   ========================================================= */

const API = '/api/state';
const K = { state: 'pacto:state', me: 'pacto:me', pin: 'pacto:pin', seen: 'pacto:seen' };
const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const weekday = (s) => parse(s).getDay();
const today = () => ymd(new Date());
const fmtNum = (n) => (Math.round(n * 10) / 10).toLocaleString('es-CL');
const fmtDate = (s) => parse(s).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
const other = (p) => (p === 'a' ? 'b' : 'a');
const plural = (n, one, many) => (n === 1 ? one : many);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

function daysLabel(d) {
  if (d % 365 === 0) return d === 365 ? '1 año' : `${d / 365} años`;
  if (d % 30 === 0) return d === 30 ? '1 mes' : `${d / 30} meses`;
  if (d === 7) return '1 semana';
  if (d === 14) return '2 semanas';
  return `${d} días`;
}
const shortLabel = (d) => (d < 30 ? `${d} días` : daysLabel(d));

/* ---------- estado inicial ---------- */
function defaultState() {
  return {
    setupDone: true,
    title: 'Nuestro pacto',
    people: { a: { name: 'Valukis' }, b: { name: 'Tomilin' } },
    settings: {
      milestones: [
        { days: 7, name: 'Detallito', idea: 'Un chocolate, una carta o su snack favorito' },
        { days: 15, name: 'Gustito', idea: 'Salir por un helado, un café o un completo' },
        { days: 30, name: 'Regalo chico', idea: 'Algo de hasta $15.000' },
        { days: 90, name: 'Regalo mediano', idea: 'Algo de hasta $40.000' },
        { days: 180, name: 'Regalo bueno', idea: 'Una cita especial o algo de hasta $80.000' },
        { days: 365, name: 'Regalo grande', idea: 'Una escapada o eso que viene queriendo hace tiempo' },
      ],
      repeatEvery: 365,
      bonusPerExtraHabit: 0.25,
      maxMultiplier: 1.75,
      minDaysToComplete: 30,
      punishments: [
        'Cocinarle la cena que elija',
        'Masaje de 20 minutos',
        'Lavar la loza durante una semana',
        'Que elija la película o serie por dos semanas',
        'Pagar la próxima salida',
        'Un día de “sí a todo” (dentro de lo razonable)',
      ],
    },
    habits: [],
    rewards: {},
    debts: [],
    log: [],
  };
}

function migrate(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  if (!s.setupDone) { s = { ...s, setupDone: true, people: d.people }; }
  const settings = { ...d.settings, ...(s.settings || {}) };
  if (!Array.isArray(settings.milestones) || !settings.milestones.length) settings.milestones = d.settings.milestones;
  if (!Array.isArray(settings.punishments)) settings.punishments = d.settings.punishments;
  return {
    ...d,
    ...s,
    people: { a: { ...d.people.a, ...(s.people?.a || {}) }, b: { ...d.people.b, ...(s.people?.b || {}) } },
    settings,
    habits: Array.isArray(s.habits) ? s.habits : [],
    rewards: s.rewards && typeof s.rewards === 'object' ? s.rewards : {},
    debts: Array.isArray(s.debts) ? s.debts : [],
    log: Array.isArray(s.log) ? s.log : [],
  };
}

let state = null;
let version = 0;
let mode = 'remote';
let me = null;
let queue = Promise.resolve();
let saving = 0;
let rewardsBusy = false;
let lastDay = today();

/* ---------- reglas: hitos y multiplicador ---------- */
function sortedMilestones() {
  return [...state.settings.milestones].sort((x, y) => x.days - y.days);
}
function milestone(i) {
  const ms = sortedMilestones();
  if (i < ms.length) return { ...ms[i], i };
  const last = ms[ms.length - 1];
  const k = i - ms.length + 1;
  return { days: last.days + k * (Number(state.settings.repeatEvery) || 365), name: last.name, idea: last.idea, i };
}
function tierIndexForDays(days) {
  let idx = -1;
  for (let i = 0; i < 500 && milestone(i).days <= days; i++) idx = i;
  return idx;
}
function mult(n) {
  if (n <= 0) return 0;
  const s = state.settings;
  return Math.min(Number(s.maxMultiplier) || 1, 1 + (Number(s.bonusPerExtraHabit) || 0) * (n - 1));
}
const rewardKey = (p, days) => `${p}:${days}`;

/* ---------- racha de un hábito ----------
   Día hecho -> reinicia el contador de fallos.
   Día libre fijo -> no cuenta como fallo.
   Día sin hacer -> suma un fallo; si se pasa del margen, la racha se corta.
   El día de hoy nunca corta la racha: todavía queda tiempo para hacerlo. */
function timeline(h, t = today()) {
  const end = h.status !== 'active' && h.endedAt ? (h.endedAt < t ? h.endedAt : t) : t;
  const rest = new Set(h.restDays || []);
  const maxMiss = Math.max(0, Number(h.maxMiss) || 0);
  const checks = h.checks || {};
  let alive = true;
  let misses = 0;
  let streakStart = h.start;
  let atRisk = false;
  let lastBreak = null;
  const contrib = new Set();
  const breaks = new Set();
  const dayState = {};

  for (let d = h.start; d <= end; d = addDays(d, 1)) {
    if (checks[d]) {
      if (!alive) { alive = true; streakStart = d; }
      misses = 0;
      contrib.add(d);
      dayState[d] = 'done';
    } else if (rest.has(weekday(d))) {
      dayState[d] = 'rest';
      if (alive) contrib.add(d);
    } else if (d === end) {
      dayState[d] = 'pending';
      if (alive && misses + 1 > maxMiss) atRisk = true;
    } else if (alive) {
      misses++;
      if (misses > maxMiss) {
        alive = false;
        streakStart = null;
        breaks.add(d);
        lastBreak = d;
        dayState[d] = 'break';
      } else {
        contrib.add(d);
        dayState[d] = 'miss';
      }
    } else {
      dayState[d] = 'off';
    }
  }

  const streak = alive && streakStart ? Math.max(0, diffDays(streakStart, end) + 1) : 0;
  return {
    alive, misses, maxMiss, streak, atRisk, lastBreak, contrib, breaks, dayState,
    doneToday: !!checks[t],
    restToday: rest.has(weekday(t)),
    margin: Math.max(0, maxMiss - misses),
  };
}

/* ---------- progreso de una persona ----------
   Cada día con hábitos en racha suma "días de progreso":
   1 hábito = 1 día; cada hábito extra suma un bono (con tope).
   Si una racha se corta, vuelves al último regalo alcanzado. */
function progress(p, t = today()) {
  const habits = state.habits.filter((h) => h.owner === p);
  const tls = habits.map((h) => timeline(h, t));
  let points = 0;
  let base = 0;
  let next = 0;
  const reached = [];

  if (habits.length) {
    let d = habits.map((h) => h.start).sort()[0];
    for (; d <= t; d = addDays(d, 1)) {
      let n = 0;
      let broke = false;
      for (const tl of tls) {
        if (tl.contrib.has(d)) n++;
        if (tl.breaks.has(d)) broke = true;
      }
      if (broke) points = base;
      points += mult(n);
      while (points >= milestone(next).days - 1e-9) {
        const m = milestone(next);
        reached.push({ days: m.days, name: m.name, idea: m.idea, date: d });
        base = m.days;
        next++;
      }
    }
  }

  const activeNow = tls.filter((tl, i) => habits[i].status === 'active' && tl.alive).length;
  return { points, next, reached, rate: mult(activeNow), activeNow, habits, tls };
}

/* ---------- guardado y sincronización ---------- */
function pinHeaders() {
  const pin = lsGet(K.pin);
  return pin ? { 'x-pin': pin } : {};
}

function setSync(s) {
  const el = $('#sync');
  const text = { ok: 'Sincronizado', saving: 'Guardando…', error: 'Sin guardar', offline: 'Sin conexión', }[s] || '';
  el.textContent = text;
  el.classList.toggle('is-error', s === 'error' || s === 'offline');
}

async function load() {
  try {
    const r = await fetch(API, { headers: pinHeaders(), cache: 'no-store' });
    if (r.status === 401) { askPin(); return false; }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).message || ''; } catch { /* no era JSON */ }
      if (!msg && r.status === 404) msg = 'No se encontró la API. Revisa que el archivo state.js esté dentro de una carpeta llamada api en GitHub, y que estés abriendo el link de Vercel.';
      throw new Error(msg || `La API respondió ${r.status}.`);
    }
    const data = await r.json();
    mode = 'remote';
    state = migrate(data.state);
    version = Number(data.version) || 0;
    setSync('ok');
  } catch (e) {
    showOffline(location.protocol === 'file:'
      ? 'Estás abriendo el archivo directo desde el computador. Abre la página desde tu link de Vercel.'
      : e?.message === 'Failed to fetch' || e?.name === 'TypeError'
        ? 'No hay conexión con el servidor. Revisa el internet o que estés usando el link de Vercel.'
        : e?.message || 'Error desconocido.');
    return false;
  }
  return true;
}

function showOffline(reason) {
  $('#offline-reason').textContent = reason;
  $('#offline').hidden = false;
  $('#app').hidden = true;
}

async function refresh(force = false) {
  if (mode !== 'remote' || (!force && (saving || document.hidden))) return;
  try {
    const r = await fetch(API, { headers: pinHeaders(), cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    if (Number(d.version) !== version || force) {
      state = migrate(d.state);
      version = Number(d.version) || 0;
      render();
    }
    setSync('ok');
  } catch {
    setSync('offline');
  }
}

// Aplica un cambio. Si el otro teléfono guardó antes, se trae su versión y se vuelve a aplicar el cambio encima.
function mutate(fn) {
  const run = async () => {
    saving++;
    setSync('saving');
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const draft = structuredClone(state);
        fn(draft);
        state = draft;
        render();
        const r = await fetch(API, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...pinHeaders() },
          body: JSON.stringify({ state: draft, baseVersion: version }),
        });
        if (r.ok) {
          version = Number((await r.json()).version) || version + 1;
          setSync('ok');
          return true;
        }
        if (r.status === 409) {
          const d = await r.json();
          state = migrate(d.state);
          version = Number(d.version) || 0;
          continue;
        }
        if (r.status === 401) { askPin(); return false; }
        throw new Error(`HTTP ${r.status}`);
      }
      throw new Error('conflicto');
    } catch {
      setSync('error');
      toast('No se pudo guardar. Revisa la conexión e inténtalo otra vez.');
      saving--;
      await refresh(true);
      saving++;
      return false;
    } finally {
      saving--;
    }
  };
  queue = queue.then(run, run);
  return queue;
}

function addLog(s, text) {
  s.log.unshift({ at: new Date().toISOString(), text });
  s.log = s.log.slice(0, 100);
}

/* ---------- regalos nuevos ---------- */
function checkNewRewards() {
  if (rewardsBusy || !state?.setupDone) return;
  const fresh = [];
  for (const p of ['a', 'b']) {
    for (const r of progress(p).reached) {
      if (!state.rewards[rewardKey(p, r.days)]) fresh.push({ p, ...r });
    }
  }
  if (!fresh.length) return;
  rewardsBusy = true;
  mutate((s) => {
    for (const f of fresh) {
      const key = rewardKey(f.p, f.days);
      if (s.rewards[key]) continue;
      s.rewards[key] = { person: f.p, days: f.days, name: f.name, idea: f.idea, earnedAt: f.date, deliveredAt: null, note: '' };
      addLog(s, `${s.people[f.p].name} desbloqueó «${f.name}» (${daysLabel(f.days)}).`);
    }
  }).finally(() => { rewardsBusy = false; render(); });
}

function celebrateUnseen() {
  if (!state?.setupDone || !me || dlg.open) return;
  const keys = Object.keys(state.rewards);
  let seen = null;
  try { seen = JSON.parse(lsGet(K.seen) || 'null'); } catch { seen = null; }
  if (!Array.isArray(seen)) { lsSet(K.seen, JSON.stringify(keys)); return; }
  const fresh = keys.filter((k) => !seen.includes(k));
  if (!fresh.length) return;
  lsSet(K.seen, JSON.stringify([...seen, ...fresh]));
  const r = state.rewards[fresh[0]];
  const p = r.person;
  const mine = p === me;
  const giver = state.people[other(p)].name;
  const extra = fresh.length > 1 ? `<p>Y ${fresh.length - 1} ${plural(fresh.length - 1, 'regalo más', 'regalos más')} esperando en «Por entregar».</p>` : '';
  openDialog(`
    <div class="celebrate p-${p}">
      <div class="big-gift" aria-hidden="true"><span class="base"></span><span class="lid"></span></div>
      <h2>${mine ? `¡Desbloqueaste «${esc(r.name)}»!` : `¡${esc(state.people[p].name)} desbloqueó «${esc(r.name)}»!`}</h2>
      <p>${esc(daysLabel(r.days))} de progreso. ${mine ? `${esc(giver)} te debe un regalo.` : 'Te toca regalarle algo.'}</p>
      ${r.idea ? `<p class="hint">Idea: ${esc(r.idea)}</p>` : ''}
      ${extra}
      <div class="dlg-actions" style="justify-content:center"><button class="btn primary" data-action="close" autofocus>Genial</button></div>
    </div>`);
}

/* ---------- render ---------- */
const order = () => (me ? [me, other(me)] : ['a', 'b']);
const nameOf = (p) => state.people[p].name;

function render() {
  if (!state) return;
  lastDay = today();
  document.title = state.title;
  $('#title').textContent = state.title;
  $('#couple').textContent = `${nameOf('a')} y ${nameOf('b')}`;
  renderMe();
  renderPaths();
  renderHabits();
  renderPending();
  renderHistory();
  setTimeout(() => { checkNewRewards(); celebrateUnseen(); }, 0);
}

function renderMe() {
  const el = $('#profile');
  if (!me) { el.innerHTML = ''; return; }
  el.className = `profile p-${me}`;
  el.innerHTML = `<span class="profile-dot" aria-hidden="true">${esc(nameOf(me).trim().charAt(0).toUpperCase())}</span>
    <span>Perfil de <strong>${esc(nameOf(me))}</strong> en este teléfono</span>
    <button class="link-btn" data-action="who">Cambiar</button>`;
}

function renderPaths() {
  const t = today();
  $('#paths-body').innerHTML = order().map((p) => pathHTML(p, progress(p, t))).join('');
}

function pathHTML(p, pr) {
  const mine = p === me;
  const name = nameOf(p);
  const reachedDays = new Set(pr.reached.map((r) => r.days));
  const N = Math.max(state.settings.milestones.length, pr.next + 1);
  const ms = Array.from({ length: N }, (_, i) => milestone(i));
  // Cada regalo queda un poco más lejos que el anterior.
  const w = ms.map((_, i) => Math.pow(1.15, i));
  const total = w.reduce((s, x) => s + x, 0);
  let acc = 0;
  const pos = w.map((x) => ((acc += x) / total) * 100);

  let mpos = 100;
  if (pr.next < N) {
    const k = pr.next;
    const p0 = k ? pos[k - 1] : 0;
    const d0 = k ? ms[k - 1].days : 0;
    const frac = Math.max(0, Math.min(1, (pr.points - d0) / (ms[k].days - d0)));
    mpos = p0 + frac * (pos[k] - p0);
  }

  const gifts = ms.map((m, i) => {
    const rec = state.rewards[rewardKey(p, m.days)];
    const st = rec ? (rec.deliveredAt ? 'delivered' : 'reached') : reachedDays.has(m.days) ? 'reached' : i === pr.next ? 'next' : 'future';
    const size = Math.min(46, 20 + i * 5);
    const status = st === 'delivered' ? ', entregado' : st === 'reached' ? ', por entregar' : '';
    return `<div class="gift s-${st}" style="left:${pos[i].toFixed(2)}%;--s:${size}px" title="${esc(`${m.name} a los ${daysLabel(m.days)}${status}`)}">
      <span class="box"></span><span class="lbl">${esc(shortLabel(m.days))}</span></div>`;
  }).join('');

  const nm = milestone(pr.next);
  let nextText;
  if (!pr.habits.length) nextText = mine ? 'Agrega un hábito para empezar a avanzar.' : `${esc(name)} todavía no tiene hábitos.`;
  else if (pr.rate === 0) nextText = 'Ningún hábito tiene la racha activa. Marca uno para volver a avanzar.';
  else {
    const days = Math.max(1, Math.ceil((nm.days - pr.points) / pr.rate));
    nextText = `${days === 1 ? 'Falta 1 día' : `Faltan ${days} días`} para «${esc(nm.name)}», el regalo de ${esc(daysLabel(nm.days))}.`;
  }
  const rateText = pr.activeNow > 1 ? `, avanza ×${fmtNum(pr.rate)} por día con ${pr.activeNow} hábitos` : '';

  return `<div class="path p-${p}">
    <div class="path-head"><h3>${esc(name)}</h3><p>${fmtNum(pr.points)} ${pr.points === 1 ? 'día' : 'días'} de progreso${rateText}</p></div>
    <div class="track" role="img" aria-label="${esc(`${name}: ${fmtNum(pr.points)} días de progreso`)}">
      <div class="rail"><div class="fill" style="width:${mpos.toFixed(2)}%"></div></div>
      ${gifts}
      <div class="you" style="left:${mpos.toFixed(2)}%"><span>${esc(name.trim().charAt(0).toUpperCase() || '?')}</span></div>
    </div>
    <p class="path-next">${nextText}</p>
  </div>`;
}

function rulesText(h) {
  const parts = [];
  const rest = WEEK_ORDER.filter((d) => (h.restDays || []).includes(d)).map((d) => DAY_SHORT[d]);
  if (rest.length) parts.push(`Libres: ${rest.join(', ')}`);
  const m = Number(h.maxMiss) || 0;
  parts.push(m ? `puede saltarse hasta ${m} ${plural(m, 'día seguido', 'días seguidos')}` : 'sin días de margen');
  parts.push(`desde el ${fmtDate(h.start)}`);
  const s = parts.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

function statusText(h, tl, mine) {
  const you = mine ? 'te' : 'le';
  const d = `${tl.streak} ${plural(tl.streak, 'día', 'días')}`;
  if (!tl.alive) {
    return tl.lastBreak
      ? `La racha se cortó el ${fmtDate(tl.lastBreak)}. ${mine ? 'Márcalo hoy' : 'Si lo marca hoy'} para empezar una nueva.`
      : 'Sin racha activa.';
  }
  if (tl.doneToday) return `Hecho hoy. Racha de ${d}.`;
  if (tl.restToday) return `Hoy es día libre. Racha de ${d}.`;
  if (tl.atRisk) return `Hoy es el último día para no perder la racha de ${d}.`;
  if (tl.maxMiss > 0) return `Racha de ${d}. Hoy ${you} ${plural(tl.margin, 'queda', 'quedan')} ${tl.margin} ${plural(tl.margin, 'día', 'días')} de margen.`;
  return `Racha de ${d}. Hoy toca.`;
}

function habitHTML(h, t) {
  const tl = timeline(h, t);
  const mine = h.owner === me;
  const cls = ['habit', `p-${h.owner}`];
  if (!mine) cls.push('is-theirs');
  if (tl.alive && tl.atRisk && !tl.doneToday) cls.push('is-risk');
  if (!tl.alive) cls.push('is-broken');

  let dots = '';
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    const st = d < h.start ? 'none' : tl.dayState[d] || 'none';
    const label = { done: 'hecho', rest: 'día libre', miss: 'saltado, dentro del margen', break: 'se cortó la racha', pending: 'pendiente', off: 'sin racha', none: 'antes de empezar' }[st];
    const title = `${DAY_SHORT[weekday(d)]} ${fmtDate(d)}: ${label}`;
    const inner = `<i></i>${DAY_LETTER[weekday(d)]}`;
    const today_ = i === 0 ? ' is-today' : '';
    if (mine && i <= 7 && d >= h.start) {
      dots += `<button class="day s-${st}${today_}" data-action="dot" data-id="${h.id}" data-date="${d}" title="${esc(title)}" aria-label="${esc(title)}. Cambiar">${inner}</button>`;
    } else {
      dots += `<span class="day s-${st}${today_}" title="${esc(title)}">${inner}</span>`;
    }
  }

  return `<article class="${cls.join(' ')}">
    <button class="check" data-action="check" data-id="${h.id}" aria-pressed="${tl.doneToday}" aria-label="${esc(`${h.name}: ${tl.doneToday ? 'hecho hoy' : 'marcar como hecho hoy'}`)}" ${mine ? '' : 'disabled'}>✓</button>
    <div>
      <div class="habit-title"><span aria-hidden="true">${esc(h.emoji || '✨')}</span><span>${esc(h.name)}</span></div>
      <p class="habit-status">${esc(statusText(h, tl, mine))}</p>
      <p class="habit-rules">${esc(rulesText(h))}</p>
    </div>
    <button class="icon-btn" data-action="manage" data-id="${h.id}" aria-label="${esc(`Opciones de ${h.name}`)}">⋯</button>
    <div class="dots" aria-label="Últimos 14 días">${dots}</div>
  </article>`;
}

function renderHabits() {
  const t = today();
  const label = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#today-h').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  let html = '';
  for (const p of order()) {
    const mine = p === me;
    const active = state.habits.filter((h) => h.owner === p && h.status === 'active');
    html += `<h3 class="group-title">${mine ? 'Tus hábitos' : `Hábitos de ${esc(nameOf(p))}`}</h3>`;
    html += active.length
      ? active.map((h) => habitHTML(h, t)).join('')
      : `<p class="empty">${mine ? 'Todavía no tienes hábitos. Agrega el primero para empezar a sumar días.' : `${esc(nameOf(p))} todavía no agrega hábitos.`}</p>`;
  }

  const ended = state.habits.filter((h) => h.status !== 'active');
  if (ended.length) {
    html += `<details class="ended"><summary>Hábitos terminados (${ended.length})</summary><ul>${ended
      .map((h) => {
        const days = diffDays(h.start, h.endedAt) + 1;
        const how = h.status === 'done' ? 'lo logró' : 'lo dejó';
        return `<li>${esc(h.emoji || '')} ${esc(h.name)}: ${esc(nameOf(h.owner))} ${how} el ${fmtDate(h.endedAt)}, después de ${days} ${plural(days, 'día', 'días')}.</li>`;
      })
      .join('')}</ul></details>`;
  }
  $('#habits-body').innerHTML = html;
}

function renderPending() {
  const items = [];
  for (const [key, r] of Object.entries(state.rewards)) {
    items.push({
      kind: 'reward', key, to: r.person, from: other(r.person), date: r.earnedAt, delivered: r.deliveredAt, note: r.note,
      title: `${r.name} (${daysLabel(r.days)})`, detail: r.idea, penalty: false,
    });
  }
  for (const d of state.debts) {
    items.push({
      kind: 'debt', key: d.id, to: d.to, from: d.from, date: d.createdAt, delivered: d.deliveredAt, note: d.note,
      title: d.title, detail: d.detail, penalty: d.kind === 'castigo',
    });
  }
  const open = items.filter((i) => !i.delivered).sort((x, y) => (x.date < y.date ? -1 : 1));
  const done = items.filter((i) => i.delivered).sort((x, y) => (x.delivered < y.delivered ? 1 : -1));

  let html = open.length
    ? open.map((i) => `<div class="due p-${i.to}${i.penalty ? ' is-penalty' : ''}">
        <span class="due-who">${i.penalty ? 'Castigo' : 'Regalo'} de ${esc(nameOf(i.from))} para ${esc(nameOf(i.to))}</span>
        <strong>${esc(i.title)}</strong>
        ${i.detail ? `<p>${esc(i.detail)}</p>` : ''}
        <button class="btn small" data-action="deliver" data-kind="${i.kind}" data-key="${esc(i.key)}">Marcar entregado</button>
      </div>`).join('')
    : '<p class="empty">Nada pendiente por ahora. El primer regalo llega a los 7 días de racha.</p>';

  if (done.length) {
    html += `<details class="delivered"><summary>Entregados (${done.length})</summary><ul>${done
      .map((i) => `<li>${esc(i.title)}, de ${esc(nameOf(i.from))} para ${esc(nameOf(i.to))}, el ${fmtDate(i.delivered)}${i.note ? `: ${esc(i.note)}` : ''}.</li>`)
      .join('')}</ul></details>`;
  }
  $('#pending-body').innerHTML = html;
}

function renderHistory() {
  $('#history-body').innerHTML = state.log.length
    ? `<ol>${state.log.map((l) => {
        const d = new Date(l.at);
        return `<li><time datetime="${esc(l.at)}">${d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</time>${esc(l.text)}</li>`;
      }).join('')}</ol>`
    : '<p class="empty">Aquí van a aparecer los hábitos nuevos, los regalos y los castigos.</p>';
}

/* ---------- diálogos ---------- */
const dlg = $('#dlg');
function openDialog(html) {
  dlg.innerHTML = `<div class="dlg-inner">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('[autofocus]')?.focus();
}
function closeDialog() {
  if (dlg.open) dlg.close();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg && !dlg.dataset.locked) closeDialog(); });
dlg.addEventListener('cancel', (e) => { if (dlg.dataset.locked) e.preventDefault(); });
dlg.addEventListener('close', () => { delete dlg.dataset.locked; setTimeout(() => { if (state) celebrateUnseen(); }, 50); });

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function openWhoAmI() {
  const first = !me;
  if (first) dlg.dataset.locked = '1';
  openDialog(`
    <h2>${first ? '¿De quién es este teléfono?' : 'Cambiar de perfil'}</h2>
    <p class="dlg-lead">Queda guardado en este teléfono: vas a ver tus hábitos primero y solo vas a poder marcar los tuyos. Cada uno elige su nombre en su propio celular.</p>
    <div class="manage-actions">
      ${['a', 'b'].map((p) => `<button class="btn p-${p}" data-action="set-me" data-p="${p}" data-close="1">Soy ${esc(nameOf(p))}</button>`).join('')}
    </div>
    ${first ? '' : '<div class="dlg-actions"><button class="btn" data-action="close">Cancelar</button></div>'}`);
}

function askPin() {
  dlg.dataset.locked = '1';
  openDialog(`
    <form data-form="pin">
      <h2>Código del pacto</h2>
      <p class="dlg-lead">Esta página está protegida. Escribe el código que configuraron en Vercel.</p>
      <label class="field"><span>Código</span><input type="password" name="pin" required autofocus autocomplete="current-password"></label>
      <div class="dlg-actions"><button class="btn primary" type="submit">Entrar</button></div>
    </form>`);
}

function weekdayChips(selected) {
  return WEEK_ORDER.map((d) => `<label class="chip"><input type="checkbox" name="rest" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${DAY_SHORT[d]}</span></label>`).join('');
}

function openHabitForm(id) {
  const h = id ? state.habits.find((x) => x.id === id) : null;
  const t = today();
  const owner = h?.owner || me || 'a';
  openDialog(`
    <form data-form="habit">
      <h2>${h ? 'Editar hábito' : 'Nuevo hábito'}</h2>
      <input type="hidden" name="id" value="${esc(h?.id || '')}">
      <div class="row">
        <label class="field narrow"><span>Emoji</span><input type="text" name="emoji" maxlength="8" value="${esc(h?.emoji || '📚')}"></label>
        <label class="field"><span>¿Qué hábito?</span><input type="text" name="name" required maxlength="60" placeholder="Leer 20 minutos" value="${esc(h?.name || '')}" ${h ? '' : 'autofocus'}></label>
      </div>
      <fieldset class="field"><legend>¿De quién es?</legend>
        ${['a', 'b'].map((p) => `<label class="radio"><input type="radio" name="owner" value="${p}" ${owner === p ? 'checked' : ''}><span>${esc(nameOf(p))}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span>Empieza el</span><input type="date" name="start" required max="${t}" value="${esc(h?.start || t)}"></label>
      <fieldset class="field"><legend>Días libres fijos</legend>
        <div class="chips">${weekdayChips(h?.restDays || [])}</div>
        <small>Esos días no hace falta hacerlo y no cuentan como fallo.</small>
      </fieldset>
      <label class="field"><span>Días seguidos que se puede saltar sin perder la racha</span>
        <input type="number" name="maxMiss" min="0" max="14" step="1" value="${esc(h?.maxMiss ?? 1)}" inputmode="numeric"></label>
      <p class="hint">Por ejemplo, para leer sin presión el fin de semana: marca sáb y dom como libres, o deja 2 días de margen para que se pueda saltar cualquier par de días.</p>
      <div class="dlg-actions">
        <button class="btn" type="button" data-action="close">Cancelar</button>
        <button class="btn primary" type="submit">Guardar hábito</button>
      </div>
    </form>`);
}

function openManage(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const tl = timeline(h);
  const mine = h.owner === me;
  openDialog(`
    <h2>${esc(h.emoji || '')} ${esc(h.name)}</h2>
    <p class="dlg-lead">De ${esc(nameOf(h.owner))}. ${esc(rulesText(h))} ${tl.alive ? `Racha actual: ${tl.streak} ${plural(tl.streak, 'día', 'días')}.` : 'La racha está cortada.'}</p>
    <div class="manage-actions">
      <button class="btn" data-action="edit-habit" data-id="${h.id}">Editar hábito</button>
      ${h.status === 'active' ? `<button class="btn" data-action="finish" data-id="${h.id}" ${mine ? '' : 'disabled'}>Terminar hábito</button>` : ''}
      <button class="btn" data-action="delete-habit" data-id="${h.id}">Borrar hábito</button>
      ${!mine && h.status === 'active' ? `<p class="hint">Solo ${esc(nameOf(h.owner))} puede terminar este hábito.</p>` : ''}
    </div>
    <div class="dlg-actions"><button class="btn" data-action="close">Cerrar</button></div>`);
}

function finishInfo(h) {
  const tl = timeline(h);
  const t = today();
  const sinceStart = diffDays(h.start, t) + 1;
  const min = Number(state.settings.minDaysToComplete) || 0;
  const finalTier = milestone(Math.max(0, tierIndexForDays(tl.streak)));
  const quitTier = milestone(Math.max(0, tierIndexForDays(sinceStart)));
  return { tl, sinceStart, min, canComplete: tl.alive && tl.streak >= min, finalTier, quitTier };
}

function openFinish(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const f = finishInfo(h);
  const partner = nameOf(other(h.owner));
  const why = !f.tl.alive
    ? 'Para darlo por logrado, la racha tiene que estar activa.'
    : `Se puede desde los ${f.min} días de racha (vas en ${f.tl.streak}).`;
  openDialog(`
    <h2>Terminar «${esc(h.name)}»</h2>
    <p class="dlg-lead">Llevas ${f.sinceStart} ${plural(f.sinceStart, 'día', 'días')} con este hábito${f.tl.alive ? ` y una racha de ${f.tl.streak}` : ''}.</p>

    <div class="choice">
      <h3>Lo logré</h3>
      <p>El hábito ya es parte de tu vida. Recibes un último regalo de ${esc(partner)}: «${esc(f.finalTier.name)}», del nivel de tu racha.</p>
      <button class="btn primary" data-action="finish-done" data-id="${h.id}" ${f.canComplete ? '' : 'disabled'}>Terminar: lo logré</button>
      ${f.canComplete ? '' : `<small class="hint">${esc(why)}</small>`}
    </div>

    <div class="choice">
      <h3>Me rindo</h3>
      <p>Dejas el hábito y pagas un castigo a ${esc(partner)}. Elige cuál:</p>
      <label class="radio"><input type="radio" name="quit" value="gift" checked><span>Hacerle un regalo: «${esc(f.quitTier.name)}»${f.quitTier.idea ? ` (${esc(f.quitTier.idea)})` : ''}</span></label>
      <label class="radio"><input type="radio" name="quit" value="spin"><span>Girar la ruleta de castigos</span></label>
      <div id="spin-area" hidden>
        <div class="spin-box" id="spin-box" aria-live="polite">Toca «Girar» para ver tu castigo.</div>
        <button class="btn small" data-action="spin" style="margin-top:8px">Girar</button>
      </div>
      <button class="btn danger" data-action="finish-quit" data-id="${h.id}">Terminar: me rindo</button>
    </div>
    <div class="dlg-actions"><button class="btn" data-action="close">Cancelar</button></div>`);
  dlg.dataset.punishment = '';
}

function openDeliver(kind, key) {
  const item = kind === 'reward' ? state.rewards[key] : state.debts.find((d) => d.id === key);
  if (!item) return;
  const title = kind === 'reward' ? item.name : item.title;
  openDialog(`
    <form data-form="deliver">
      <h2>Marcar como entregado</h2>
      <p class="dlg-lead">${esc(title)}</p>
      <input type="hidden" name="kind" value="${esc(kind)}"><input type="hidden" name="key" value="${esc(key)}">
      <label class="field"><span>¿Qué fue? (opcional)</span><input type="text" name="note" maxlength="120" placeholder="Una salida al cine" autofocus></label>
      <div class="dlg-actions">
        <button class="btn" type="button" data-action="close">Cancelar</button>
        <button class="btn primary" type="submit">Marcar entregado</button>
      </div>
    </form>`);
}

function multHelp(bonusPct, max) {
  const s = { bonusPerExtraHabit: bonusPct / 100, maxMultiplier: max };
  const m = (n) => Math.min(s.maxMultiplier, 1 + s.bonusPerExtraHabit * (n - 1));
  return `Con 1 hábito se suma 1 día de progreso por día. Con 2 hábitos, ${fmtNum(m(2))}; con 3, ${fmtNum(m(3))}; con 4, ${fmtNum(m(4))}. Así quien tiene más hábitos recibe regalos un poco antes, pero no el doble ni el triple.`;
}

function msRow(m = { days: '', name: '', idea: '' }) {
  return `<div class="ms-row">
    <input type="number" name="ms_days" min="1" step="1" required value="${esc(m.days)}" aria-label="Días" placeholder="Días" inputmode="numeric">
    <input type="text" name="ms_name" maxlength="40" required value="${esc(m.name)}" aria-label="Nombre del regalo" placeholder="Nombre">
    <button class="icon-btn" type="button" data-action="del-ms" aria-label="Quitar hito">✕</button>
    <input class="ms-idea" type="text" name="ms_idea" maxlength="120" value="${esc(m.idea)}" aria-label="Idea o presupuesto" placeholder="Idea o presupuesto">
  </div>`;
}

function openSettings() {
  const s = state.settings;
  openDialog(`
    <form data-form="settings">
      <h2>Ajustes del pacto</h2>
      <label class="field"><span>Nombre del pacto</span><input type="text" name="title" maxlength="40" value="${esc(state.title)}"></label>
      <div class="row">
        <label class="field"><span>Persona 1</span><input type="text" name="a" required maxlength="24" value="${esc(nameOf('a'))}"></label>
        <label class="field"><span>Persona 2</span><input type="text" name="b" required maxlength="24" value="${esc(nameOf('b'))}"></label>
      </div>

      <fieldset class="field"><legend>Regalos según días de progreso</legend>
        <small>Mientras más lejos, mejor el regalo. Valen para los dos.</small>
        <div id="ms-list">${sortedMilestones().map(msRow).join('')}</div>
        <button class="btn small" type="button" data-action="add-ms" style="margin-top:10px">Agregar regalo</button>
      </fieldset>
      <label class="field"><span>Después del último, repetir cada (días)</span><input type="number" name="repeatEvery" min="1" value="${esc(s.repeatEvery)}"></label>

      <fieldset class="field"><legend>Bono por tener más hábitos</legend>
        <div class="row">
          <label class="field" style="margin-top:0"><span>Bono por hábito extra (%)</span><input type="number" name="bonus" min="0" max="100" step="5" value="${Math.round((Number(s.bonusPerExtraHabit) || 0) * 100)}"></label>
          <label class="field" style="margin-top:0"><span>Tope de ritmo</span><input type="number" name="maxMult" min="1" max="5" step="0.05" value="${esc(s.maxMultiplier)}"></label>
        </div>
        <small id="mult-help">${esc(multHelp((Number(s.bonusPerExtraHabit) || 0) * 100, Number(s.maxMultiplier) || 1))}</small>
      </fieldset>

      <label class="field"><span>Días de racha para poder decir «lo logré»</span><input type="number" name="minDays" min="0" value="${esc(s.minDaysToComplete)}"></label>
      <label class="field"><span>Ruleta de castigos (uno por línea)</span><textarea name="punishments">${esc(s.punishments.join('\n'))}</textarea></label>

      <fieldset class="field"><legend>Respaldo</legend>
        <div class="row">
          <button class="btn small" type="button" data-action="export">Descargar respaldo</button>
          <label class="btn small" style="text-align:center">Cargar respaldo<input type="file" accept="application/json" id="import-file" hidden></label>
        </div>
      </fieldset>

      <div class="dlg-actions">
        <button class="btn" type="button" data-action="close">Cancelar</button>
        <button class="btn primary" type="submit">Guardar ajustes</button>
      </div>
    </form>`);
}

dlg.addEventListener('input', (e) => {
  if (e.target.name === 'bonus' || e.target.name === 'maxMult') {
    const f = e.target.form;
    $('#mult-help').textContent = multHelp(Number(f.bonus.value) || 0, Number(f.maxMult.value) || 1);
  }
});
dlg.addEventListener('change', (e) => {
  if (e.target.name === 'quit') $('#spin-area').hidden = e.target.value !== 'spin';
  if (e.target.id === 'import-file') importBackup(e.target.files[0]);
});

/* ---------- acciones ---------- */
function setDay(id, date) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || h.status !== 'active') return;
  if (h.owner !== me) return toast(`Solo ${nameOf(h.owner)} puede marcar este hábito.`);
  const value = !h.checks?.[date];
  mutate((s) => {
    const x = s.habits.find((y) => y.id === id);
    if (!x) return;
    x.checks = x.checks || {};
    if (value) x.checks[date] = true;
    else delete x.checks[date];
  });
}

function spin() {
  const list = state.settings.punishments.filter(Boolean);
  const box = $('#spin-box');
  if (!list.length) { box.textContent = 'La ruleta está vacía. Agrega castigos en Ajustes.'; return; }
  const pick = list[Math.floor(Math.random() * list.length)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  dlg.dataset.punishment = '';
  if (reduce) { box.textContent = pick; dlg.dataset.punishment = pick; return; }
  let i = 0;
  const steps = 14 + Math.floor(Math.random() * 6);
  const tick = () => {
    if (i < steps) {
      box.textContent = list[(Math.floor(Math.random() * list.length))];
      i++;
      setTimeout(tick, 50 + i * 12);
    } else {
      box.textContent = pick;
      dlg.dataset.punishment = pick;
    }
  };
  tick();
}

function finishDone(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || h.owner !== me) return;
  const f = finishInfo(h);
  if (!f.canComplete) return;
  const t = today();
  const debtId = uid();
  mutate((s) => {
    const x = s.habits.find((y) => y.id === id);
    if (!x || x.status !== 'active') return;
    x.status = 'done';
    x.endedAt = t;
    s.debts.push({
      id: debtId, kind: 'final', from: other(x.owner), to: x.owner,
      title: `Regalo final por «${x.name}»: ${f.finalTier.name}`, detail: f.finalTier.idea || '',
      createdAt: t, deliveredAt: null, note: '',
    });
    addLog(s, `${s.people[x.owner].name} logró «${x.name}» después de ${f.tl.streak} días de racha. 🎉`);
  });
  closeDialog();
  toast('¡Felicitaciones! El regalo final quedó en «Por entregar».');
}

function finishQuit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h || h.owner !== me) return;
  const f = finishInfo(h);
  const choice = dlg.querySelector('input[name="quit"]:checked')?.value || 'gift';
  let title;
  let detail;
  if (choice === 'spin') {
    const p = dlg.dataset.punishment;
    if (!p) return toast('Primero gira la ruleta.');
    title = `Castigo por dejar «${h.name}»`;
    detail = p;
  } else {
    title = `Castigo por dejar «${h.name}»: ${f.quitTier.name}`;
    detail = f.quitTier.idea || '';
  }
  const t = today();
  const debtId = uid();
  mutate((s) => {
    const x = s.habits.find((y) => y.id === id);
    if (!x || x.status !== 'active') return;
    x.status = 'quit';
    x.endedAt = t;
    s.debts.push({ id: debtId, kind: 'castigo', from: x.owner, to: other(x.owner), title, detail, createdAt: t, deliveredAt: null, note: '' });
    addLog(s, `${s.people[x.owner].name} dejó «${x.name}». Castigo: ${detail || title}.`);
  });
  closeDialog();
  toast('Hábito terminado. El castigo quedó en «Por entregar».');
}

function deleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  if (!confirm(`¿Borrar «${h.name}» y todo su historial? Los regalos ya ganados se mantienen.`)) return;
  mutate((s) => {
    s.habits = s.habits.filter((x) => x.id !== id);
    addLog(s, `Se borró el hábito «${h.name}».`);
  });
  closeDialog();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pacto-respaldo-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = migrate(JSON.parse(await file.text()));
    if (!confirm('Esto reemplaza todos los datos actuales por los del respaldo. ¿Seguir?')) return;
    await mutate((s) => {
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, data);
    });
    closeDialog();
    toast('Respaldo cargado.');
  } catch {
    toast('Ese archivo no es un respaldo válido.');
  }
}

const actions = {
  close: () => closeDialog(),
  settings: () => openSettings(),
  'new-habit': () => openHabitForm(),
  'edit-habit': (d) => openHabitForm(d.id),
  manage: (d) => openManage(d.id),
  check: (d) => setDay(d.id, today()),
  dot: (d) => setDay(d.id, d.date),
  finish: (d) => openFinish(d.id),
  'finish-done': (d) => finishDone(d.id),
  'finish-quit': (d) => finishQuit(d.id),
  'delete-habit': (d) => deleteHabit(d.id),
  deliver: (d) => openDeliver(d.kind, d.key),
  spin: () => spin(),
  export: () => exportBackup(),
  'add-ms': () => $('#ms-list').insertAdjacentHTML('beforeend', msRow()),
  'del-ms': (d, el) => {
    if (dlg.querySelectorAll('.ms-row').length <= 1) return toast('Deja al menos un regalo.');
    el.closest('.ms-row').remove();
  },
  who: () => openWhoAmI(),
  retry: () => location.reload(),
  'set-me': (d) => {
    me = d.p;
    lsSet(K.me, me);
    if (d.close) { delete dlg.dataset.locked; closeDialog(); }
    render();
  },
};

const forms = {
  pin(fd) {
    lsSet(K.pin, String(fd.get('pin')));
    location.reload();
  },
  habit(fd) {
    const id = String(fd.get('id') || '');
    const t = today();
    let start = String(fd.get('start') || t);
    if (start > t) start = t;
    const data = {
      name: String(fd.get('name')).trim().slice(0, 60),
      emoji: String(fd.get('emoji') || '').trim() || '✨',
      owner: fd.get('owner') === 'b' ? 'b' : 'a',
      start,
      restDays: fd.getAll('rest').map(Number),
      maxMiss: Math.max(0, Math.min(14, Math.round(Number(fd.get('maxMiss')) || 0))),
    };
    if (!data.name) return;
    if (data.restDays.length >= 7) return toast('Deja al menos un día en que toque hacerlo.');
    const newId = uid();
    mutate((s) => {
      const x = id && s.habits.find((y) => y.id === id);
      if (x) {
        Object.assign(x, data);
      } else {
        s.habits.push({ id: newId, ...data, checks: {}, status: 'active', createdAt: new Date().toISOString() });
        addLog(s, `${s.people[data.owner].name} empezó «${data.name}».`);
      }
    });
    closeDialog();
  },
  deliver(fd) {
    const kind = fd.get('kind');
    const key = fd.get('key');
    const note = String(fd.get('note') || '').trim();
    const t = today();
    mutate((s) => {
      const item = kind === 'reward' ? s.rewards[key] : s.debts.find((d) => d.id === key);
      if (!item || item.deliveredAt) return;
      item.deliveredAt = t;
      item.note = note;
      const title = kind === 'reward' ? item.name : item.title;
      addLog(s, `Entregado: ${title}${note ? ` (${note})` : ''}.`);
    });
    closeDialog();
  },
  settings(fd) {
    const days = fd.getAll('ms_days').map((x) => Math.round(Number(x)));
    const names = fd.getAll('ms_name');
    const ideas = fd.getAll('ms_idea');
    const seen = new Set();
    const milestones = days
      .map((d, i) => ({ days: d, name: String(names[i] || '').trim() || `Regalo ${i + 1}`, idea: String(ideas[i] || '').trim() }))
      .filter((m) => m.days > 0 && !seen.has(m.days) && seen.add(m.days))
      .sort((x, y) => x.days - y.days);
    if (!milestones.length) return toast('Deja al menos un regalo.');
    const a = String(fd.get('a')).trim() || 'Persona 1';
    const b = String(fd.get('b')).trim() || 'Persona 2';
    const settings = {
      milestones,
      repeatEvery: Math.max(1, Math.round(Number(fd.get('repeatEvery')) || 365)),
      bonusPerExtraHabit: Math.max(0, Math.min(1, (Number(fd.get('bonus')) || 0) / 100)),
      maxMultiplier: Math.max(1, Math.min(5, Number(fd.get('maxMult')) || 1)),
      minDaysToComplete: Math.max(0, Math.round(Number(fd.get('minDays')) || 0)),
      punishments: String(fd.get('punishments') || '').split('\n').map((x) => x.trim()).filter(Boolean),
    };
    const title = String(fd.get('title')).trim() || 'Nuestro pacto';
    mutate((s) => {
      s.title = title;
      s.people.a.name = a;
      s.people.b.name = b;
      s.settings = { ...s.settings, ...settings };
      addLog(s, 'Se actualizaron los ajustes.');
    });
    closeDialog();
    toast('Ajustes guardados.');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(new FormData(f), f);
});

/* ---------- arranque ---------- */
async function start() {
  me = lsGet(K.me);
  if (me !== 'a' && me !== 'b') me = null;
  const ok = await load();
  if (!ok) return;
  render();
  if (!me) openWhoAmI();

  setInterval(() => {
    if (today() !== lastDay) render();
    refresh();
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); if (today() !== lastDay) render(); } });
}

start();
