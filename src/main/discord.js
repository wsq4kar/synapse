// Discord Rich Presence: «Играет в Synapse» в профиле Discord.
// Протокол IPC Discord без сторонних библиотек: локальный канал discord-ipc-N,
// кадр = opcode (int32 LE) + длина (int32 LE) + JSON. Сеть и прокси не нужны.
const net = require('net');
const path = require('path');
const { t } = require('./i18n');

const CLIENT_ID = '1565387122653929502';
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const REPO = 'https://github.com/wsq4kar/synapse';
const LOGO = 'https://raw.githubusercontent.com/wsq4kar/synapse/main/build/icon.png';
const FAV = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;
const ICONS = {
  claude: FAV('claude.ai'), codex: FAV('openai.com'), antigravity: FAV('antigravity.google'), opencode: FAV('opencode.ai'),
  gemini: FAV('gemini.google.com'), openrouter: FAV('openrouter.ai'),
};

let sock = null, ready = false, connecting = false, retryTimer = null;
let enabled = false, opts = { showModel: true, showProject: false }, version = '';
let ui = { view: 'home' };            // что открыто в окне
const tasks = new Map();              // запущенные задачи: taskId → { route, executor, label, project, started }
const appStarted = Date.now();
let lastSent = '';

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base.replace(/\/$/, ''), `discord-ipc-${i}`);
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryPipe(i) {
  return new Promise((resolve) => {
    const s = net.createConnection(pipePath(i));
    const fail = () => { s.removeAllListeners(); s.destroy(); resolve(null); };
    s.once('connect', () => { s.removeListener('error', fail); resolve(s); });
    s.once('error', fail);
    setTimeout(() => { if (!s.connecting) return; fail(); }, 1500);
  });
}

async function connect() {
  if (!enabled || sock || connecting) return;
  connecting = true;
  try {
    for (let i = 0; i < 10 && !sock; i++) {
      const s = await tryPipe(i);
      if (s) attach(s);
    }
  } finally { connecting = false; }
  if (!sock) scheduleRetry();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (enabled) retryTimer = setTimeout(connect, 15000); // Discord могут запустить позже Synapse
}

function attach(s) {
  sock = s; ready = false;
  let buf = Buffer.alloc(0);
  s.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* битый кадр */ }
      buf = buf.slice(8 + len);
      if (op === OP.PING) { try { s.write(encode(OP.PONG, msg)); } catch { /* закрыт */ } }
      else if (op === OP.CLOSE) { drop(); return; }
      else if (op === OP.FRAME && msg?.evt === 'READY') { ready = true; lastSent = ''; push(); }
    }
  });
  const onEnd = () => { if (sock === s) drop(); };
  s.on('error', onEnd);
  s.on('close', onEnd);
  s.write(encode(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
}

function drop() {
  const s = sock;
  sock = null; ready = false;
  if (s) { s.removeAllListeners(); s.on('error', () => {}); s.destroy(); }
  scheduleRetry();
}

const clip = (s, n = 120) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const pad = (s) => (s.length < 2 ? s + '  ' : s); // Discord не принимает строки короче 2 символов

// Текст статуса из того, что открыто и что сейчас делается
function activity() {
  const run = [...tasks.values()].sort((a, b) => b.started - a.started)[0];
  const a = { timestamps: { start: Math.floor((run ? run.started : appStarted) / 1000) },
    assets: { large_image: LOGO, large_text: `Synapse ${version}`.trim() },
    buttons: [{ label: t('Synapse на GitHub'), url: REPO }], instance: false };
  const project = (p) => (opts.showProject && p ? path.basename(p) : '');
  if (run) {
    const who = run.label && opts.showModel ? run.label : (run.name || run.label || '');
    const proj = project(run.project);
    switch (run.route) {
      case 'arena': a.details = t('Арена: большие модели соревнуются'); a.state = proj ? t('Проект {p}', { p: proj }) : t('Лучший вариант победит'); break;
      case 'team': a.details = t('Команда нейросетей собирает проект'); a.state = proj ? t('Проект {p}', { p: proj }) : (run.members ? t('Участников: {n}', { n: run.members }) : t('Работают вместе')); break;
      case 'image': a.details = t('Рисует изображение'); a.state = who; break;
      case 'video': a.details = t('Снимает видео'); a.state = who; break;
      case 'chat': a.details = t('Общается с ИИ'); a.state = who; break;
      default: a.details = proj ? t('Пишет код в {p}', { p: proj }) : t('Пишет код'); a.state = who ? t('Агент: {w}', { w: who }) : t('Агент думает…');
    }
    const ic = ICONS[run.executor];
    if (ic) { a.assets.small_image = ic; a.assets.small_text = clip(run.name || run.label, 60); }
  } else {
    const proj = project(ui.project);
    if (ui.view === 'code') { a.details = t('Вайбкодит'); a.state = proj ? t('Проект {p}', { p: proj }) : t('Ждёт следующую задачу'); }
    else if (ui.view === 'chat') { a.details = t('В чате'); a.state = t('Ждёт следующую задачу'); }
    else if (ui.view === 'extensions') a.details = t('Настраивает расширения');
    else if (ui.view === 'stats') a.details = t('Смотрит статистику');
    else a.details = t('В главном меню');
  }
  if (a.details) a.details = pad(clip(a.details));
  if (a.state) a.state = pad(clip(a.state)); else delete a.state;
  return a;
}

let pushTimer = null;
function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!sock || !ready) return;
    const act = enabled ? activity() : null;
    const key = JSON.stringify(act);
    if (key === lastSent) return;
    lastSent = key;
    try { sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: `${Date.now()}${Math.random().toString(36).slice(2, 8)}` })); }
    catch { drop(); }
  }, 250);
}

// Настройки: { on, showModel, showProject }
function configure(cfg = {}, appVersion) {
  if (appVersion) version = appVersion;
  opts = { showModel: cfg.showModel !== false, showProject: !!cfg.showProject };
  const was = enabled;
  enabled = cfg.on !== false;
  if (enabled && !sock) connect();
  else if (!enabled && was && sock) { push(); setTimeout(() => { if (!enabled) { const s = sock; sock = null; ready = false; clearTimeout(retryTimer); s?.destroy(); } }, 600); }
  else push();
}

function setView(v = {}) {
  ui = { view: String(v.view || 'home'), project: typeof v.project === 'string' ? v.project : null };
  push();
}

// События задач из main.js
function taskStart(id, info) { tasks.set(id, { started: Date.now(), route: 'code', ...info }); push(); }
function taskUpdate(id, info) { const x = tasks.get(id); if (x) { Object.assign(x, info); push(); } }
function taskEnd(id) { if (tasks.delete(id)) push(); }

function status() { return { enabled, connected: !!(sock && ready) }; }
function shutdown() {
  enabled = false; clearTimeout(retryTimer);
  if (sock) { try { sock.write(encode(OP.CLOSE, {})); } catch { /* уже закрыт */ } sock.destroy(); sock = null; }
}

module.exports = { configure, setView, taskStart, taskUpdate, taskEnd, status, shutdown, CLIENT_ID, _encode: encode, _activity: activity };
