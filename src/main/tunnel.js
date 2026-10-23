// SSH-туннель до вашего сервера: запросы к Gemini выходят в интернет с сервера, а не с этого ПК.
// Поднимает `ssh -N -D 127.0.0.1:<порт>` (SOCKS5) и пускает через него только сессию Gemini.
// Ключ API остаётся на ПК и на сервер не передаётся — туннель лишь пересылает уже зашифрованный TLS-трафик.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { session, app } = require('electron');
const { t } = require('./i18n');

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?|[0-9a-fA-F:]+)$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;
const IS_WIN = process.platform === 'win32';

let cfg = { enabled: false };
let child = null;
let wantUp = false;
let retry = 0;
let retryTimer = null;
let localPort = 0;
let connecting = null;           // промис текущего подключения
let state = { state: 'off' };    // off | connecting | up | error
const listeners = new Set();

const ses = () => session.fromPartition('synapse-gemini');

function set(next) {
  state = { ...next, at: Date.now() };
  for (const fn of listeners) { try { fn(state); } catch { /* окно закрыто */ } }
}
const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------- поиск ssh и ключа ----------
function sshBin() {
  if (IS_WIN) {
    const p = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'ssh';
}

function defaultKeys() {
  const d = path.join(os.homedir(), '.ssh');
  return ['id_ed25519', 'id_ecdsa', 'id_rsa'].map(n => path.join(d, n));
}
function resolveKey(c) {
  if (c.key) return c.key;
  return defaultKeys().find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || '';
}

function validate(c) {
  if (!c.host) return t('Укажите адрес сервера');
  if (!HOST_RE.test(c.host)) return t('Некорректный адрес сервера');
  if (!USER_RE.test(c.user || '')) return t('Некорректное имя пользователя');
  const port = Number(c.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return t('Некорректный порт');
  const key = resolveKey(c);
  if (!key) return t('Не найден SSH-ключ — укажите файл ключа');
  try { if (!fs.statSync(key).isFile()) throw 0; } catch { return t('Файл ключа не найден: {p}', { p: key }); }
  if (/^-/.test(key)) return t('Некорректный путь к ключу');
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(400, () => { s.destroy(); resolve(false); });
  });
}

// ---------- запуск и остановка ----------
function kill() {
  clearTimeout(retryTimer);
  const c = child;
  child = null;
  if (c) { c.removeAllListeners('exit'); try { c.kill(); } catch { /* уже завершён */ } }
}

async function connect() {
  const bad = validate(cfg);
  if (bad) { set({ state: 'error', error: bad }); throw new Error(bad); }
  kill();
  set({ state: 'connecting', host: cfg.host });
  const key = resolveKey(cfg);
  localPort = await freePort();
  const known = path.join(app.getPath('userData'), 'known_hosts');
  const args = [
    '-N', '-D', `127.0.0.1:${localPort}`,
    '-p', String(Number(cfg.port)), '-i', key,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile="${known}"`,
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=12',
    '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-o', 'LogLevel=ERROR',
    `${cfg.user}@${cfg.host}`,
  ];
  let err = '';
  let exited = null;
  const c = spawn(sshBin(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child = c;
  c.stderr.on('data', (d) => { err = (err + d.toString('utf8')).slice(-2000); });
  c.on('error', (e) => { exited = e.code === 'ENOENT' ? t('Не найден ssh. В Windows: Параметры → Приложения → Дополнительные компоненты → «Клиент OpenSSH».') : e.message; });
  c.on('exit', (code) => { exited = exited || (err.trim() || t('ssh завершился с кодом {c}', { c: code })); });

  // Порт SOCKS открывается только после успешной авторизации на сервере
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (exited) break;
    if (await portOpen(localPort)) {
      await ses().setProxy({ proxyRules: `socks5://127.0.0.1:${localPort}` });
      await ses().closeAllConnections().catch(() => {});
      retry = 0;
      c.on('exit', () => { if (child === c) { child = null; set({ state: 'error', error: t('Соединение с сервером потеряно') }); scheduleRetry(); } });
      set({ state: 'up', host: cfg.host, port: localPort, key });
      return;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  kill();
  const msg = humanError(exited || t('Сервер не ответил за 20 секунд'));
  set({ state: 'error', error: msg });
  scheduleRetry();
  throw new Error(msg);
}

function humanError(s) {
  s = String(s).trim();
  if (/permission denied/i.test(s)) return t('Сервер не принял ключ (Permission denied). Проверьте имя пользователя и что публичный ключ добавлен в ~/.ssh/authorized_keys на сервере.');
  if (/host key verification failed|REMOTE HOST IDENTIFICATION/i.test(s)) return t('Ключ сервера изменился. Если вы пересоздавали сервер — удалите файл known_hosts в папке данных Synapse.');
  if (/connection (refused|timed out)|timed out|no route|unreachable/i.test(s)) return t('Не удаётся подключиться к {h}:{p}: {e}', { h: cfg.host, p: cfg.port, e: s.split('\n')[0] });
  if (/UNPROTECTED PRIVATE KEY|bad permissions/i.test(s)) return t('У файла ключа слишком открытые права. Положите его в папку .ssh в вашем профиле.');
  if (/passphrase|incorrect passphrase|load key/i.test(s)) return t('Ключ защищён паролем или повреждён. Используйте ключ без пароля либо запустите ssh-agent.');
  return s.split('\n').slice(-2).join(' ');
}

function scheduleRetry() {
  if (!wantUp) return;
  clearTimeout(retryTimer);
  const wait = Math.min(30000, 2000 * 2 ** retry++);
  retryTimer = setTimeout(() => { if (wantUp) ensure().catch(() => {}); }, wait);
}

function ensure() {
  if (state.state === 'up' && child) return Promise.resolve();
  if (!connecting) connecting = connect().finally(() => { connecting = null; });
  return connecting;
}

// Применить настройки (вызывается при старте и при любом изменении)
async function configure(next) {
  const was = JSON.stringify(cfg);
  cfg = { enabled: false, ...(next || {}) };
  if (JSON.stringify(cfg) === was && (state.state === 'up' || state.state === 'connecting')) return state;
  if (!cfg.enabled) {
    wantUp = false; retry = 0; kill();
    await ses().setProxy({ mode: 'system' });
    set({ state: 'off' });
    return state;
  }
  wantUp = true; retry = 0;
  connecting = null;
  ensure().catch(() => {});
  return state;
}

// Любой запрос к Google идёт только через туннель, а при его отсутствии — не идёт вообще
async function fetch(url, init) {
  if (cfg.enabled) {
    wantUp = true;
    try { await ensure(); } catch (e) { throw Object.assign(new Error(t('SSH-сервер недоступен: {m}', { m: e.message })), { code: 'tunnel' }); }
  }
  return ses().fetch(url, init);
}

// Проверка: туннель + достижимость Google
async function test() {
  const t0 = Date.now();
  if (cfg.enabled) { try { await ensure(); } catch (e) { return { ok: false, step: 'ssh', error: e.message }; } }
  const t1 = Date.now();
  try {
    const r = await ses().fetch('https://generativelanguage.googleapis.com/', { signal: AbortSignal.timeout(15000) });
    return { ok: true, tunnel: cfg.enabled, sshMs: t1 - t0, googleMs: Date.now() - t1, status: r.status };
  } catch (e) {
    return { ok: false, step: 'google', error: e.message };
  }
}

// Автоспасение: Google не пускает из вашего региона, а туннель выключен — включаем его один раз, если всё для него есть
let rescueFn = null, rescued = false;
const setRescue = (fn) => { rescueFn = fn; };
async function rescue() {
  if (cfg.enabled || rescued || !rescueFn) return false;
  rescued = true;
  try {
    if (!(await rescueFn())) { rescued = false; return false; }
    await ensure();
    return true;
  } catch { return false; }
}

function stop() { wantUp = false; kill(); }

module.exports = { ensureUp: ensure, socksPort: () => (state.state === 'up' && child ? localPort : 0), configure, fetch, test, stop, rescue, setRescue, onStatus, status: () => ({ ...state, enabled: !!cfg.enabled, key: resolveKey(cfg) }), defaultKeys, validate };
