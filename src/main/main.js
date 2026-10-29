const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, protocol, net, Menu, screen, desktopCapturer } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const store = require('./store');
const router = require('./router');
const gemini = require('./executors/gemini');
const openrouter = require('./executors/openrouter');
const catalog = require('./catalog');
const tokens = require('./tokens');
const cli = require('./executors/cli');
const discord = require('./discord');
const team = require('./team');
const history = require('./history');
const ws = require('./workspace');
const tunnel = require('./tunnel');
const netproxy = require('./netproxy');
const firewall = require('./firewall');
const codexLimits = require('./codexlimits');
const arena = require('./arena');
const ext = require('./extensions');
const i18n = require('./i18n');
const { t } = i18n;

if (process.env.SYNAPSE_USER_DATA) app.setPath('userData', process.env.SYNAPSE_USER_DATA);

// Обрыв сетевого соединения (прокси, CLI, сервер) — не повод показывать окно «JavaScript error».
// Такие ошибки пишем в журнал; всё остальное показываем как раньше.
const NET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ERR_STREAM_DESTROYED']);
function errLog(e) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'errors.log'), `${new Date().toISOString()} ${e?.stack || e}\n`); } catch { /* */ }
}
process.on('uncaughtException', (e) => {
  errLog(e);
  if (NET_CODES.has(e?.code)) return;
  try { dialog.showErrorBox('Synapse', String(e?.stack || e)); } catch { /* */ }
});
process.on('unhandledRejection', (e) => { errLog(e); });
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'wsfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win;
const tasks = new Map(); // taskId -> AbortController
let cliCache = null;

const THEME = {
  dark: { color: '#00000000', symbolColor: '#a9abb0' },
  light: { color: '#00000000', symbolColor: '#55575e' },
};

function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
  if (win && process.platform !== 'darwin') {
    try { win.setTitleBarOverlay({ ...THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'], height: 40 }); } catch { /* linux */ }
  }
}

function createWindow() {
  const settings = store.getSettings();
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
  const dark = nativeTheme.shouldUseDarkColors;
  // Размер по умолчанию 2560×860 (ультраширокий), подгоняется под рабочую область экрана
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = settings.windowBounds;
  const width = Math.min(saved?.width || 2560, wa.width);
  const height = Math.min(saved?.height || 860, wa.height);
  const x = saved && saved.x >= wa.x && saved.x < wa.x + wa.width ? saved.x : wa.x + Math.round((wa.width - width) / 2);
  const y = saved && saved.y >= wa.y && saved.y < wa.y + wa.height ? saved.y : wa.y + Math.round((wa.height - height) / 2);
  win = new BrowserWindow({
    width, height, x, y, minWidth: 980, minHeight: 600,
    backgroundColor: dark ? '#0f1011' : '#f6f6f3',
    title: 'Synapse',
    icon: path.join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { ...THEME[dark ? 'dark' : 'light'], height: 40 },
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => { if (settings.maximized) win.maximize(); win.show(); });
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    store.setSettings({ windowBounds: win.isMaximized() ? store.getSettings().windowBounds : win.getBounds(), maximized: win.isMaximized() });
  };
  win.on('close', saveBounds);
  // Служебный режим для снимков экрана при разработке
  if (process.env.SYNAPSE_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1200));
      if (process.env.SYNAPSE_SHOT_JS) { await win.webContents.executeJavaScript(process.env.SYNAPSE_SHOT_JS); await new Promise(r => setTimeout(r, 1600)); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SYNAPSE_SHOT, img.toPNG());
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  nativeTheme.on('updated', () => applyTheme(store.getSettings().theme));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  discord.configure(store.getSettings().discord || {}, app.getVersion());
  try { history.init(path.join(store.dirs().root, 'history')); } catch { /* без истории */ }
  Menu.setApplicationMenu(null);
  const mediaRoot = path.resolve(store.dirs().media);
  protocol.handle('media', (req) => {
    const p = path.resolve(decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, '')));
    if (!p.startsWith(mediaRoot + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  protocol.handle('wsfile', (req) => ws.handleProtocol(req, net.fetch, pathToFileURL));
  catalog.init(store.dirs().root);
  // точка отсчёта статистики: всё раньше берётся из сохранённых чатов
  if (!store.getSettings().statsSince) store.setSettings({ statsSince: Date.now() });
  createWindow();
  tunnel.onStatus((st) => { if (win && !win.isDestroyed()) win.webContents.send('tunnel:status', { ...st, enabled: !!store.getSettings().tunnel?.enabled }); });
  netproxy.configure(store.getSettings().net, store.getSettings().tunnel).catch(() => {})
    // свежий список моделей с GitHub — когда сеть уже настроена
    .finally(() => catalog.refresh().then(() => { if (win && !win.isDestroyed()) win.webContents.send('catalog:changed'); }).catch(() => {}));
  // Google не пускает из региона → один раз сам включаем SSH-туннель, если сервер и ключ уже указаны
  tunnel.setRescue(async () => {
    const s0 = store.getSettings();
    const tn = s0.tunnel || {};
    // только если пользователь не выбрал свой путь (HTTP-прокси/SSH) — тогда ничего не трогаем
    if (s0.net?.mode !== 'system' || !tn.host || !tn.user || tunnel.validate(tn)) return false;
    const s1 = store.setSettings({ net: { ...s0.net, mode: 'ssh' } });
    await netproxy.configure(s1.net, s1.tunnel);
    return true;
  });
  // после обновления приложения освежаем устаревшие модели по умолчанию (нужен ключ и сеть)
  if (store.getGeminiKey() && !store.getSettings().modelsPicked2) autoPickModels(null, true).catch(() => {});
});
app.on('window-all-closed', () => { for (const c of tasks.values()) c.abort(); ws.killAll(); tunnel.stop(); app.quit(); });
app.on('before-quit', () => { tunnel.stop(); discord.shutdown(); });

// ---------------- Рабочее место (файлы + терминал) ----------------
const chatDir = (chatId, cwd) => cwd || path.join(store.getSettings().workspaceRoot, `chat-${String(chatId).slice(0, 8)}`);
let watcher = null, watchTimer = null;
ipcMain.handle('ws:open', (_e, chatId, cwd) => {
  const r = ws.register(chatDir(chatId, cwd));
  try { watcher?.close(); } catch { /* */ }
  try {
    watcher = fs.watch(r.path, { recursive: true }, (_ev, f) => {
      if (f && /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(String(f))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => win?.webContents.send('ws:changed', { id: r.id }), 250);
    });
  } catch { watcher = null; }
  return r;
});
ipcMain.handle('ws:list', (_e, id, rel) => ws.list(id, rel));
ipcMain.handle('ws:read', (_e, id, rel) => { try { return ws.read(id, rel); } catch (e) { return { kind: 'error', error: e.message }; } });
ipcMain.handle('ws:reveal', (_e, id, rel) => { try { shell.showItemInFolder(ws.inside(id, rel)); } catch { /* */ } });
ipcMain.handle('ws:openExternal', (_e, id, rel) => { try { shell.openPath(ws.inside(id, rel)); } catch { /* */ } });
const termSend = (termId, ev) => { if (win && !win.isDestroyed()) win.webContents.send('term:event', { termId, ...ev }); };
ipcMain.handle('term:start', (_e, termId, rootId) => {
  const cwd = ws.roots.get(rootId);
  if (!cwd) throw new Error('unknown root');
  return ws.termStart(termId, cwd, process.env, (d) => termSend(termId, d), (code) => termSend(termId, { stream: 'exit', code }));
});
ipcMain.handle('term:run', (_e, termId, cmd) => ws.termRun(termId, cmd));
ipcMain.handle('term:kill', (_e, termId) => { ws.termKill(termId); return true; });

// ---------------- IPC ----------------
const send = (taskId, ev) => {
  // Discord: что сейчас делается
  if (ev.kind === 'executor') discord.taskUpdate(taskId, { executor: ev.executor, label: ev.label, name: cli.LABELS[ev.executor] || (ev.executor === 'gemini' ? 'Gemini' : ev.executor === 'openrouter' ? 'OpenRouter' : '') });
  else if (ev.kind === 'route' && ['chat', 'code', 'image', 'video'].includes(ev.route)) discord.taskUpdate(taskId, { route: ev.route });
  else if (ev.kind === 'done' || ev.kind === 'error') discord.taskEnd(taskId);
  if (win && !win.isDestroyed()) win.webContents.send('task:event', { taskId, ...ev });
};

const fullSettings = () => ({ ...store.getSettings(), lang: i18n.lang(), hasKey: !!store.getGeminiKey(), hasOrKey: !!store.getOpenRouterKey(),
  catalog: catalog.get(), platform: process.platform, version: app.getVersion(),
  user: String(store.getSettings().displayName || '').trim().slice(0, 40) || safeUser(), osUser: safeUser() });
ipcMain.handle('settings:get', fullSettings);
function safeUser() { try { return os.userInfo().username; } catch { return 'user'; } }
ipcMain.handle('settings:set', (_e, patch) => {
  const s = store.setSettings(patch || {});
  if (patch && 'theme' in patch) applyTheme(s.theme);
  if (patch && patch.cliPaths) cliCache = null;
  if (patch && (patch.tunnel || patch.net)) netproxy.configure(s.net, s.tunnel).catch(() => {});
  if (patch && patch.discord) discord.configure(s.discord, app.getVersion());
  return fullSettings();
});
ipcMain.handle('key:set', async (_e, key) => {
  store.setGeminiKey(key);
  // при первом ключе берём самые новые модели, дальше меняем только недоступные
  if (key) { try { await autoPickModels(null, !!store.getSettings().modelsAutoPicked); } catch { /* проверка ключа покажет ошибку */ } }
  return !!store.getGeminiKey();
});
ipcMain.handle('key:test', async () => {
  const models = await gemini.listModels(store.getGeminiKey());
  return { ok: true, count: models.length };
});
ipcMain.handle('models:list', async () => { const list = await gemini.listModels(store.getGeminiKey()); autoPickModels(list, true); return list; });
// OpenRouter: ключ, проверка, список моделей
ipcMain.handle('orkey:set', (_e, key) => { store.setOpenRouterKey(key); return !!store.getOpenRouterKey(); });
ipcMain.handle('orkey:test', async () => {
  const k = await openrouter.keyInfo(store.getOpenRouterKey());
  return { ok: true, label: k.label || null, usage: k.usage ?? null, limit: k.limit ?? null, free: !!k.is_free_tier };
});
ipcMain.handle('ormodels:list', () => openrouter.listModels(store.getOpenRouterKey()));
ipcMain.handle('catalog:refresh', async () => { await catalog.refresh(true); return catalog.get(); });

// Если выбранная модель недоступна по ключу — подбираем самую новую подходящую
const PICK = {
  chat: [/^gemini-[\d.]+-flash(-preview)?(-\d+)?$/, /^gemini-[\d.]+-flash/],
  chatUltra: [/^gemini-[\d.]+-pro(-preview)?(-\d+)?$/, /^gemini-[\d.]+-pro/],
  router: [/^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash(-preview)?$/],
  image: [/^gemini-[\d.]+-flash-image/, /image/],
  video: [/^veo-[\d.]+-fast/, /^veo/],
  videoUltra: [/^veo-[\d.]+-generate/, /^veo/],
};
const BAD = /(tts|live|audio|embedding|native|thinking-exp|computer|robotics|aqa|learnlm|gemma)/i;
const modelVer = (id) => parseFloat((id.match(/-(\d+(?:\.\d+)?)/) || [])[1] || 0);
// Подходящие модели для роли, от новых к старым
function candidatesFor(field, ids) {
  const out = [];
  for (const re of PICK[field] || []) {
    const cand = ids.filter(id => re.test(id) && !BAD.test(id) && (field.startsWith('image') || !/image/.test(id)))
      .sort((a, b) => modelVer(b) - modelVer(a) || a.length - b.length);
    for (const c of cand) if (!out.includes(c)) out.push(c);
  }
  return out;
}
// Значения, которые приложение ставило само в старых версиях — их можно обновлять без вопросов
const OLD_DEFAULTS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image', 'veo-3.0-fast-generate-001', 'veo-3.0-generate-001']);

async function autoPickModels(list, onlyMissing = true) {
  list = list || await gemini.listModels(store.getGeminiKey());
  const ids = list.map(m => m.id);
  const s = store.getSettings();
  const next = {};
  for (const field of Object.keys(PICK)) {
    const cur = s.models[field];
    // оставляем выбор пользователя; заменяем отсутствующие и старые значения по умолчанию
    if (onlyMissing && ids.includes(cur) && !(OLD_DEFAULTS.has(cur) && !s.modelsPicked2)) continue;
    const c = candidatesFor(field, ids)[0];
    if (c && c !== cur) next[field] = c;
  }
  store.setSettings({ ...(Object.keys(next).length ? { models: next } : {}), modelsAutoPicked: true, modelsPicked2: true });
  return next;
}

// Модель отвергнута (убрана для новых пользователей, не найдена) — перебираем более новые и запоминаем рабочую
const MODEL_GONE = /no longer available|not found|is not supported|deprecated|unavailable to new/i;
async function withModelFallback(field, key, current, run) {
  try { return await run(current); } catch (e) {
    if (!(e instanceof gemini.GeminiError) || ![400, 403, 404].includes(e.status) || !MODEL_GONE.test(e.message)) throw e;
    let list;
    try { list = await gemini.listModels(key); } catch { throw e; }
    const tried = new Set([current]);
    for (const cand of candidatesFor(field, list.map(m => m.id)).slice(0, 5)) {
      if (tried.has(cand)) continue;
      tried.add(cand);
      try {
        const r = await run(cand);
        store.setSettings({ models: { [field]: cand } });
        return r;
      } catch (e2) { if (!(e2 instanceof gemini.GeminiError) || ![400, 403, 404].includes(e2.status)) throw e2; }
    }
    throw e;
  }
}

ipcMain.handle('cli:detect', async (_e, force) => {
  if (!cliCache || force) cliCache = await cli.detect(store.getSettings().cliPaths);
  return cliCache;
});

ipcMain.handle('chats:list', () => store.listChats());
ipcMain.handle('chats:get', (_e, id) => store.getChat(id));
ipcMain.handle('chats:save', (_e, chat) => store.saveChat(chat));
ipcMain.handle('chats:delete', (_e, id) => store.deleteChat(id));
ipcMain.handle('projects:list', () => store.listProjects());
ipcMain.handle('projects:save', (_e, p) => store.saveProject(p));
ipcMain.handle('projects:delete', (_e, id) => store.deleteProject(id));
ipcMain.handle('media:list', () => store.listMedia().map(toMedia));
ipcMain.handle('folders:recent', () => store.recentFolders());

ipcMain.handle('cli:login', async (_e, id) => { if (!cli.LABELS[id]) return false; const env = await netproxy.agentEnv().catch(() => null); cli.openLogin(id, store.getSettings().cliPaths, env); cliCache = null; return true; });
ipcMain.handle('net:test', () => netproxy.test());
ipcMain.handle('limits:codex', async () => {
  const env = await netproxy.agentEnv().catch(() => null);
  return codexLimits.read({ bin: cli.binFor('codex', store.getSettings().cliPaths), env });
});
const agentsList = async () => cliCache || (cliCache = await cli.detect(store.getSettings().cliPaths));
ipcMain.handle('fw:status', async () => firewall.status(await agentsList()));
ipcMain.handle('fw:apply', async () => firewall.apply(await agentsList(), (netproxy.parseHostPort(store.getSettings().net?.http) || {}).host));
ipcMain.handle('fw:remove', () => firewall.remove());
ipcMain.handle('tunnel:status', () => tunnel.status());
ipcMain.handle('tunnel:test', () => tunnel.test());
ipcMain.handle('tunnel:pickKey', async () => {
  const r = await dialog.showOpenDialog(win, { title: t('Файл SSH-ключа'), defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:cli', async (_e, id) => {
  const name = cli.BINS[id] || 'cli';
  const r = await dialog.showOpenDialog(win, {
    title: t('Где находится {name}?', { name: cli.LABELS[id] || name }),
    properties: ['openFile', 'showHiddenFiles'],
    filters: process.platform === 'win32' ? [{ name: t('Программы'), extensions: ['exe', 'cmd', 'bat'] }, { name: '*', extensions: ['*'] }] : [],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: t('Папка проекта') });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('shell:open', (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return false;
  const inMedia = path.resolve(p).startsWith(path.resolve(store.dirs().media));
  if (fs.statSync(p).isDirectory() || inMedia) { shell.openPath(p); return true; }
  shell.showItemInFolder(p); return true;
});
ipcMain.handle('shell:url', (_e, u) => { if (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u)) shell.openExternal(u); return true; });
ipcMain.handle('shell:reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.handle('file:saveAs', async (_e, p) => {
  if (typeof p !== 'string' || !path.resolve(p).startsWith(path.resolve(store.dirs().media)) || !fs.existsSync(p)) return false;
  const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(p) });
  if (r.canceled || !r.filePath) return false;
  fs.copyFileSync(p, r.filePath);
  return true;
});
ipcMain.handle('usage:read', () => store.readUsage());
ipcMain.handle('stats:get', () => store.usageStats());
// «Что нового»: CHANGELOG.md из папки приложения
ipcMain.handle('changelog:get', () => { try { return fs.readFileSync(path.join(__dirname, '../../CHANGELOG.md'), 'utf8'); } catch { return ''; } });
// Скриншот экрана для меню «+»: окно Synapse прячется на время снимка
ipcMain.handle('screen:capture', async () => {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wasVisible = win && win.isVisible() && !win.isMinimized();
  if (wasVisible) { win.hide(); await new Promise(r => setTimeout(r, 350)); }
  try {
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    return { mime: 'image/png', data: src.thumbnail.toPNG().toString('base64') };
  } finally {
    if (wasVisible) { win.show(); win.focus(); }
  }
});
ipcMain.handle('discord:view', (_e, v) => { discord.setView(v || {}); return true; });
ipcMain.handle('discord:status', () => discord.status());
ipcMain.handle('history:list', (_e, { cwd } = {}) => history.list(cwd || null));
ipcMain.handle('history:diff', (_e, { id }) => history.diff(id));
ipcMain.handle('history:restore', (_e, { id, to, force }) => history.restore(id, to, !!force));
// Голосовой ввод: Gemini по ключу, без ключа — модель с аудиовходом через OpenRouter
ipcMain.handle('voice:transcribe', async (_e, { data } = {}) => {
  if (typeof data !== 'string' || !data || data.length > 40 * 1024 * 1024) throw new Error(t('Нет записи'));
  const settings = store.getSettings();
  const key = store.getGeminiKey();
  if (key) {
    const model = settings.models.router || settings.models.chat;
    return { text: await withModelFallback(settings.models.router ? 'router' : 'chat', key, model, (mdl) => gemini.transcribe({ key, model: mdl, data })) };
  }
  const orKey = store.getOpenRouterKey();
  if (!orKey) throw Object.assign(new Error(t('Для голосового ввода нужен ключ Google AI Studio или OpenRouter')), { code: 'no_key' });
  const cfg = orSettings(settings);
  const oc = catalog.get().openrouter || {};
  const model = [cfg.router, cfg.chat, oc.router, oc.chat, ...(oc.list || [])].find(m => /^google\/gemini/.test(m || '') && !/image|banana/.test(m)) || 'google/gemini-2.5-flash';
  return { text: await openrouter.transcribe({ key: orKey, model, data }) };
});
ipcMain.handle('task:cancel', (_e, taskId) => { tasks.get(taskId)?.abort(); return true; });
ipcMain.handle('task:run', (_e, input) => {
  const taskId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ctrl = new AbortController();
  tasks.set(taskId, ctrl);
  discord.taskStart(taskId, { route: input.arena && input.mode === 'code' ? 'arena' : input.team && input.mode === 'code' ? 'team' : (['image', 'video', 'chat'].includes(input.mode) ? input.mode : 'code'), project: input.cwd || null });
  runTask(taskId, input, ctrl.signal)
    .catch(e => {
      const code = e.code || (e.name === 'AbortError' ? 'aborted' : null);
      send(taskId, { kind: 'error', error: code === 'aborted' ? t('Остановлено') : (e.message || String(e)), code });
    })
    .finally(() => { tasks.delete(taskId); discord.taskEnd(taskId); });
  return taskId;
});

// ---------------- выполнение задачи ----------------
// Прикреплённые файлы (не картинки): текст — прямо в запрос чата, PDF — моделям, которые его читают,
// агентам — сохраняем в папку проекта и даём пути (агент сам прочитает, лишние токены не тратятся)
const TEXT_EXT = /\.(txt|md|markdown|js|mjs|cjs|ts|tsx|jsx|py|lua|luau|json|jsonc|css|scss|html?|xml|svg|ya?ml|toml|ini|cfg|conf|env|csv|tsv|sql|sh|bat|cmd|ps1|c|cc|cpp|h|hpp|cs|java|kt|go|rs|rb|php|swift|dart|vue|svelte|log|gitignore|dockerfile)$/i;
function prepareFiles(list) {
  const out = { inline: '', docs: [], save: [] };
  let budget = 120000;
  for (const f of (Array.isArray(list) ? list : []).slice(0, 10)) {
    if (!f || typeof f.data !== 'string' || !f.name) continue;
    const name = path.basename(String(f.name)).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file';
    const buf = Buffer.from(f.data, 'base64');
    if (buf.length > 20 * 1024 * 1024) continue;
    out.save.push({ name, buf });
    const isText = buf.length <= 400000 && !buf.includes(0) && (/^text\/|json|xml|javascript|yaml|toml|csv|sql/.test(f.mime || '') || TEXT_EXT.test(name));
    if (isText && buf.length <= budget) { budget -= buf.length; out.inline += `\n\n${t('Файл')} ${name}:\n\`\`\`\n${buf.toString('utf8')}\n\`\`\``; }
    else if (f.mime === 'application/pdf') out.docs.push({ mime: 'application/pdf', data: f.data, name });
    else out.inline += `\n\n${t('Приложен файл {n} ({k} КБ) — его содержимое в чат не передаётся.', { n: name, k: Math.ceil(buf.length / 1024) })}`;
  }
  return out;
}

async function runTask(taskId, input, signal) {
  const settings = store.getSettings();
  const key = store.getGeminiKey();
  const images = (input.images || []).filter(i => i && /^image\//.test(i.mime) && typeof i.data === 'string');
  const text = String(input.text || '').trim();
  input.prep = prepareFiles(input.files);
  // для чата: текст файлов в запросе, PDF — рядом с картинками
  const chatText = text + input.prep.inline;
  const chatImages = images.concat(input.prep.docs);
  const started = Date.now();

  send(taskId, { kind: 'status', status: 'routing' });
  // Арена: несколько больших моделей вместе (только во вкладке «Код»)
  if (input.arena && input.mode === 'code') {
    send(taskId, { kind: 'route', route: 'code', reason: t('Арена') });
    const log = (extra) => store.logUsage({ route: 'code', ms: Date.now() - started, chars: text.length, arena: true, ultra: !!input.ultra, ...extra });
    return runArena(taskId, input, settings, text, images, signal, log);
  }
  if (input.team && input.mode === 'code') {
    send(taskId, { kind: 'route', route: 'code', reason: t('Команда') });
    const log = (extra) => store.logUsage({ route: 'code', ms: Date.now() - started, chars: text.length, team: true, ultra: !!input.ultra, ...extra });
    return runTeam(taskId, input, settings, text, images, signal, log);
  }
  // Агент выбран вручную в меню модели — задача уходит ему (кроме явных «Изображение»/«Видео»)
  const forced = input.executor && cli.LABELS[input.executor] && !['image', 'video'].includes(input.mode)
    ? { route: 'code', reason: t('выбрано вручную') } : null;
  const orKey = store.getOpenRouterKey();
  const orCfg = orSettings(settings);
  // Маршрутизатор: Gemini по ключу, без него — дешёвая модель OpenRouter
  const askModel = !settings.smartRouting ? null
    : key ? (q, context) => gemini.classify({ key, model: settings.models.router, text: q, prompt: router.ROUTER_PROMPT, context, signal })
    : orKey ? (q, context) => openrouter.classify({ key: orKey, model: orCfg.router, text: q, prompt: router.ROUTER_PROMPT, context, signal })
    : null;
  const decided = forced || await router.route({
    text, mode: input.mode, hasFolder: !!input.cwd, hasImages: images.length > 0, lastRoute: input.lastRoute, askModel,
  });
  send(taskId, { kind: 'route', route: decided.route, reason: decided.reason });

  const log = (extra) => store.logUsage({ route: decided.route, ms: Date.now() - started, chars: text.length, effort: cli.effortOf(input.effort || settings.effort, input.ultra) || 'auto', ultra: !!input.ultra, ...extra });

  try {
    // Чат через OpenRouter: выбрана его модель или нет ключа Gemini
    const orPicked = /^or:/.test(input.chatModel || '') ? input.chatModel.slice(3) : null;
    if (decided.route === 'chat' && orKey && (orPicked || !key)) {
      return await runOpenRouterChat(taskId, input, settings, orKey, orPicked, text, images, signal, log, chatText, chatImages);
    }
    // Без ключей разговор ведёт Claude Code / Codex — подписки хватает
    if (decided.route === 'chat' && !key) {
      send(taskId, { kind: 'route', route: 'code', reason: t('нет ключа Gemini — отвечает агент') });
      return await runCode(taskId, input, settings, text, images, signal, log);
    }
    if (decided.route === 'chat') {
      const picked = /^[\w.\-]+$/.test(input.chatModel || '') ? input.chatModel : null;
      const field = input.ultra ? 'chatUltra' : 'chat';
      let model = picked || settings.models[field];
      send(taskId, { kind: 'executor', executor: 'gemini', label: `Gemini · ${model}` });
      let r;
      try {
        const go = (mdl) => gemini.chatStream({
          key, model: mdl, history: input.history || [], text: chatText, images: chatImages, signal, memory: memoryText(settings), search: !!input.research,
          effort: cli.effortOf(input.effort || settings.effort, input.ultra),
          onDelta: (d) => send(taskId, { kind: 'delta', text: d }),
          onThought: (d) => { thoughts += d; send(taskId, { kind: 'thinking', text: thoughts }); },
        });
        let thoughts = '';
        r = picked ? await go(model) : await withModelFallback(field, key, model, async (mdl) => {
          const out = await go(mdl);
          if (mdl !== model) { model = mdl; send(taskId, { kind: 'executor', executor: 'gemini', label: `Gemini · ${mdl}` }); }
          return out;
        });
      } catch (e) {
        // Google недоступен (сеть/регион) — отдаём вопрос агенту по подписке
        if (!['network', 'region'].includes(e.code)) throw e;
        send(taskId, { kind: 'fallback', from: 'Gemini', to: t('агент'), reason: t('Gemini недоступен'), error: e.message, action: 'network' });
        return await runCode(taskId, input, settings, text, images, signal, log);
      }
      const gu = geminiUsage(r.usage, model);
      log({ executor: 'gemini', model, ok: true, usage: gu });
      const window = await geminiWindow(key, model);
      const context = r.usage ? { used: (r.usage.promptTokenCount || 0) + (r.usage.candidatesTokenCount || 0) + (r.usage.thoughtsTokenCount || 0), window } : null;
      if (context) send(taskId, { kind: 'context', ...context, model });
      return send(taskId, { kind: 'done', text: r.text, executor: 'gemini', usage: gu, context });
    }

    if (decided.route === 'image' && !key && orKey) {
      const model = orCfg.image;
      send(taskId, { kind: 'executor', executor: 'openrouter', label: `${t('Изображение')} · ${model}` });
      send(taskId, { kind: 'status', status: 'generating' });
      const r = await openrouter.image({ key: orKey, model, text, images, outDir: store.mediaDir(input.chatId), signal });
      log({ executor: 'openrouter', model, ok: true, files: r.files.length, usage: openrouter.toUsage(r.usage, model) });
      return send(taskId, { kind: 'done', text: r.text, files: r.files.map(toMedia), executor: 'openrouter', usage: openrouter.toUsage(r.usage, model) });
    }
    if (decided.route === 'image') {
      send(taskId, { kind: 'executor', executor: 'gemini', label: `${t('Изображение')} · ${settings.models.image}` });
      send(taskId, { kind: 'status', status: 'generating' });
      const r = await withModelFallback('image', key, settings.models.image, (mdl) => gemini.image({ key, model: mdl, text, images, outDir: store.mediaDir(input.chatId), signal }));
      log({ executor: 'gemini', model: settings.models.image, ok: true, files: r.files.length, usage: geminiUsage(r.usage, settings.models.image) });
      return send(taskId, { kind: 'done', text: r.text, files: r.files.map(toMedia), executor: 'gemini', usage: geminiUsage(r.usage, settings.models.image) });
    }

    if (decided.route === 'video') {
      const vmodel = input.ultra ? settings.models.videoUltra : settings.models.video;
      send(taskId, { kind: 'executor', executor: 'gemini', label: `${t('Видео')} · ${vmodel}` });
      const r = await withModelFallback(input.ultra ? 'videoUltra' : 'video', key, vmodel, (mdl) => gemini.video({
        key, model: mdl, text, images, aspect: settings.videoAspect,
        outDir: store.mediaDir(input.chatId), signal,
        onProgress: (sec) => send(taskId, { kind: 'progress', seconds: sec }),
      }));
      log({ executor: 'gemini', model: vmodel, ok: true, seconds: r.seconds });
      return send(taskId, { kind: 'done', text: '', files: r.files.map(toMedia), executor: 'gemini' });
    }

    // ---- код: CLI-агенты по очереди ----
    return await runCode(taskId, input, settings, text, images, signal, log);
  } catch (e) {
    log({ ok: false, error: String(e.message).slice(0, 200) });
    throw e;
  }
}

// ---------- OpenRouter ----------
// Модели OpenRouter: выбор пользователя в настройках → models.json
function orSettings(settings) {
  const def = catalog.get().openrouter || {};
  const own = settings.openrouter || {};
  const ok = (m) => openrouter.MODEL_RE.test(m || '');
  return {
    chat: ok(own.chat) ? own.chat : def.chat, chatUltra: ok(own.chatUltra) ? own.chatUltra : def.chatUltra,
    router: ok(own.router) ? own.router : def.router, image: ok(own.image) ? own.image : def.image,
  };
}
async function runOpenRouterChat(taskId, input, settings, orKey, picked, text, images, signal, log, chatText = text, chatImages = images) {
  const cfg = orSettings(settings);
  const model = picked && openrouter.MODEL_RE.test(picked) ? picked : (input.ultra ? cfg.chatUltra : cfg.chat);
  send(taskId, { kind: 'executor', executor: 'openrouter', label: `OpenRouter · ${model}` });
  let thoughts = '';
  let r;
  try {
    r = await openrouter.chatStream({
      key: orKey, model, history: input.history || [], text: chatText, images: chatImages, signal, memory: memoryText(settings), search: !!input.research,
      effort: cli.effortOf(input.effort || settings.effort, input.ultra),
      onDelta: (d) => send(taskId, { kind: 'delta', text: d }),
      onThought: (d) => { thoughts += d; send(taskId, { kind: 'thinking', text: thoughts }); },
    });
  } catch (e) {
    if (e.code !== 'network') throw e;
    send(taskId, { kind: 'fallback', from: 'OpenRouter', to: t('агент'), reason: t('OpenRouter недоступен'), error: e.message, action: 'network' });
    return await runCode(taskId, input, settings, text, images, signal, log);
  }
  const usage = openrouter.toUsage(r.usage, r.model);
  log({ executor: 'openrouter', model: r.model, ok: true, usage });
  const window = (await openrouter.listModels(orKey).catch(() => [])).find(m => m.id === model)?.context || null;
  const context = r.usage ? { used: (r.usage.prompt_tokens || 0) + (r.usage.completion_tokens || 0), window } : null;
  if (context) send(taskId, { kind: 'context', ...context, model: r.model });
  return send(taskId, { kind: 'done', text: r.text, executor: 'openrouter', usage, context });
}

// ---------- Память «Обо мне» ----------
const memoryPath = () => path.join(store.dirs().root, 'memory.md');
function memoryText(settings) {
  if (settings.memoryEnabled === false) return '';
  try { return fs.readFileSync(memoryPath(), 'utf8').trim().slice(0, 12000); } catch { return ''; }
}
// Дополнение к системному промпту Claude Code: «Обо мне» + режим «Команда»
// Субагенты: агент сам решает, нужны ли они (отдельной кнопки больше нет)
const SUBAGENT_RULE = `Субагенты: если задача большая и делится на независимые части (например, интерфейс, логика, данные, тесты), а у тебя есть инструмент субагентов (Task/Agent), сам запусти несколько субагентов параллельно — каждому короткое описание и полное задание с путями к файлам; потом проверь, что части стыкуются. Для вопросов и небольших правок субагентов не запускай.`;
function systemFileFor(mem) {
  const parts = [];
  if (mem) parts.push(`# О пользователе (его собственные заметки)\n${mem}`);
  parts.push(SUBAGENT_RULE);
  const f = path.join(store.dirs().root, 'run-system.md');
  fs.writeFileSync(f, parts.join('\n\n'), 'utf8');
  return f;
}
const claudeMdPath = () => path.join(os.homedir(), '.claude', 'CLAUDE.md');
ipcMain.handle('memory:get', () => {
  let text = ''; try { text = fs.readFileSync(memoryPath(), 'utf8'); } catch { /* пусто */ }
  let claudeMd = null; try { const st = fs.statSync(claudeMdPath()); claudeMd = { path: claudeMdPath(), size: st.size }; } catch { claudeMd = { path: claudeMdPath(), size: null }; }
  return { text, claudeMd, env: store.getSettings().claudeEnv || null };
});
ipcMain.handle('memory:set', (_e, text) => { fs.writeFileSync(memoryPath(), String(text || '').slice(0, 12000), 'utf8'); return true; });
ipcMain.handle('memory:openClaudeMd', () => {
  const p = claudeMdPath();
  if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `# ${t('Обо мне')}\n\n`, 'utf8'); }
  shell.openPath(p);
  return p;
});

// usageMetadata Gemini → общий формат
function geminiUsage(u, model) {
  if (!u) return null;
  return { input: (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0), cacheRead: u.cachedContentTokenCount || 0, cacheWrite: 0,
    output: u.candidatesTokenCount || 0, thinking: u.thoughtsTokenCount || 0, model };
}
// Размер окна модели Gemini из списка моделей (кэшируется)
let gemModels = null;
async function geminiWindow(key, model) {
  try {
    if (!gemModels) gemModels = await gemini.listModels(key);
    return gemModels.find(m => m.id === model)?.inputTokenLimit || null;
  } catch { return null; }
}

// ---------- Арена ----------
const arenaRoot = () => path.join(app.getPath('userData'), 'arena');
async function runArena(taskId, input, settings, text, images, signal, log) {
  const agents = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  const cwd = input.cwd || path.join(settings.workspaceRoot, `chat-${String(input.chatId).slice(0, 8)}`);
  fs.mkdirSync(cwd, { recursive: true });
  send(taskId, { kind: 'cwd', cwd });
  send(taskId, { kind: 'executor', executor: 'arena', label: t('Арена') });
  let note = '';
  if (images.length) {
    const dir = path.join(arenaRoot(), 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    const saved = images.map((img, i) => {
      const f = path.join(dir, `${Date.now()}-${i}.${img.mime.split('/')[1] || 'png'}`);
      fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
      return f;
    });
    note = `\n\n${t('Приложенные изображения:')}\n${saved.map(s => `- ${s}`).join('\n')}`;
  }
  const extraEnv = { ...(await netproxy.agentEnv() || {}) };
  if (store.getOpenRouterKey()) extraEnv.OPENROUTER_API_KEY = store.getOpenRouterKey();
  const hist = (input.history || []).filter(m => m.text).slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, 1200)}`).join('\n');
  try {
    const r = await arena.run({
      input, settings, agents, text: text + note, history: hist, memory: memoryText(settings),
      cwd, root: arenaRoot(), extraEnv, signal, emit: (ev) => send(taskId, ev),
    });
    log({ executor: 'arena', ok: true, model: r.winner.model, usage: r.usage });
    return send(taskId, { kind: 'done', text: r.text, executor: 'arena', cwd, usage: { ...r.usage, model: t('Арена') } });
  } catch (e) {
    log({ executor: 'arena', ok: false, error: String(e.message).slice(0, 200) });
    throw e;
  }
}
async function runTeam(taskId, input, settings, text, images, signal, log) {
  const agents = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  const cwd = input.cwd || path.join(settings.workspaceRoot, `chat-${String(input.chatId).slice(0, 8)}`);
  fs.mkdirSync(cwd, { recursive: true });
  send(taskId, { kind: 'cwd', cwd });
  send(taskId, { kind: 'executor', executor: 'team', label: t('Команда') });
  let note = '';
  const saveAt = path.join(arenaRoot(), 'attachments');
  const saved = [];
  if (images.length || input.prep?.save.length) fs.mkdirSync(saveAt, { recursive: true });
  images.forEach((img, i) => { const f = path.join(saveAt, `${Date.now()}-${i}.${img.mime.split('/')[1] || 'png'}`); fs.writeFileSync(f, Buffer.from(img.data, 'base64')); saved.push(f); });
  for (const { name, buf } of input.prep?.save || []) { const f = path.join(saveAt, `${Date.now()}-${name}`); fs.writeFileSync(f, buf); saved.push(f); }
  if (saved.length) note = `\n\n${t('Приложенные файлы:')}\n${saved.map(s => `- ${s}`).join('\n')}`;
  const extraEnv = { ...(await netproxy.agentEnv() || {}) };
  if (store.getOpenRouterKey()) extraEnv.OPENROUTER_API_KEY = store.getOpenRouterKey();
  const hist = (input.history || []).filter(m => m.text).slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, 1200)}`).join('\n');
  try {
    const r = await team.run({
      input, settings, agents, text: text + note, history: hist, memory: memoryText(settings),
      cwd, root: arenaRoot(), extraEnv, signal,
      emit: (ev) => { if (ev.type === 'init') discord.taskUpdate(taskId, { members: ev.members.length }); send(taskId, ev); },
    });
    log({ executor: 'team', ok: true, model: r.lead?.model, usage: r.usage });
    return send(taskId, { kind: 'done', text: r.text, executor: 'team', cwd, usage: { ...r.usage, model: t('Команда') } });
  } catch (e) {
    log({ executor: 'team', ok: false, error: String(e.message).slice(0, 200) });
    throw e;
  }
}
ipcMain.handle('team:roster', async () => {
  const settings = store.getSettings();
  const agents = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  return { ...team.roster(settings, agents), models: catalog.get().arena, agents: agents.map(a => ({ id: a.id, label: a.label, installed: a.installed })) };
});
ipcMain.handle('arena:roster', async () => {
  const settings = store.getSettings();
  const agents = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  return { ...arena.roster(settings, agents), agents: agents.map(a => ({ id: a.id, label: a.label, installed: a.installed })) };
});
ipcMain.handle('arena:apply', (_e, { runId, pid, force } = {}) => {
  // применение Арены/Команды тоже попадает в историю — его можно откатить
  let snap = null;
  try { if (/^[at][a-z0-9]+$/.test(runId || '')) snap = history.before(JSON.parse(fs.readFileSync(path.join(arenaRoot(), runId, 'meta.json'), 'utf8')).cwd); } catch { /* без истории */ }
  const r = arena.apply(arenaRoot(), runId, pid, !!force);
  if (r.ok && snap) { try { r.point = history.after(snap, { kind: 'apply', label: runId.startsWith('t') ? t('Команда') : t('Арена') }); } catch { /* без истории */ } }
  return r;
});
ipcMain.handle('arena:files', (_e, { runId, pid } = {}) => arena.variantFiles(arenaRoot(), runId, pid));
ipcMain.handle('arena:open', (_e, { runId, pid } = {}) => { const d = arena.variantDir(arenaRoot(), runId, pid); if (d && fs.existsSync(d)) shell.openPath(d); return !!d; });

// ---------- Расширения: MCP, коннекторы, скиллы, плагины, маркетплейсы ----------
async function extCtx() {
  const settings = store.getSettings();
  let env = {};
  try { env = (await netproxy.agentEnv()) || {}; } catch { /* прокси выключен — команды без сети всё равно работают */ }
  return { bin: (id) => cli.binFor(id, settings.cliPaths), env, fetch: (u, i) => netproxy.fetch(u, i) };
}
const mcpSaved = () => store.getSettings().extSaved || {};
function rememberSpec(name, spec) { const all = { ...mcpSaved(), [name]: spec }; store.setSettings({ extSaved: all }); }
function forgetSpec(name) { const all = { ...mcpSaved() }; delete all[name]; store.setSettings({ extSaved: null }); store.setSettings({ extSaved: all }); }
async function installedAgents() {
  const settings = store.getSettings();
  const agents = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  return agents.map(a => ({ id: a.id, label: a.label, installed: a.installed }));
}
ipcMain.handle('ext:mcp:list', async () => ({ ...ext.listMcp(mcpSaved()), agents: await installedAgents() }));
ipcMain.handle('ext:mcp:add', async (_e, { name, spec, agents }) => {
  const ctx = await extCtx();
  const results = {};
  for (const a of agents || []) {
    try { await ext.addMcp(a, name, spec, ctx); results[a] = { ok: true }; } catch (e) { results[a] = { ok: false, error: e.message }; }
  }
  if (Object.values(results).some(r => r.ok)) rememberSpec(name, spec);
  return results;
});
ipcMain.handle('ext:mcp:toggle', async (_e, { name, agent, on, spec }) => {
  const ctx = await extCtx();
  if (on) {
    const s = spec || mcpSaved()[name];
    if (!s) throw new Error(t('Нет описания сервера «{n}»', { n: name }));
    await ext.addMcp(agent, name, s, ctx);
  } else {
    if (spec) rememberSpec(name, spec);
    await ext.removeMcp(agent, name, ctx);
  }
  return true;
});
ipcMain.handle('ext:mcp:remove', async (_e, { name, agents }) => {
  const ctx = await extCtx();
  const errors = [];
  for (const a of agents || []) { try { await ext.removeMcp(a, name, ctx); } catch (e) { errors.push(`${cli.LABELS[a] || a}: ${e.message}`); } }
  forgetSpec(name);
  if (errors.length) throw new Error(errors.join('\n'));
  return true;
});
ipcMain.handle('ext:mcp:login', async (_e, { name, agent }) => { ext.loginMcp(agent, name, await extCtx()); return true; });
ipcMain.handle('ext:mcp:test', async (_e, spec) => ext.testMcp(spec, await extCtx()));
ipcMain.handle('ext:connectors', () => ext.CONNECTORS);
ipcMain.handle('ext:registry', async (_e, { query, cursor } = {}) => ext.searchRegistry(String(query || '').slice(0, 100), cursor || null, await extCtx()));
ipcMain.handle('ext:registry:spec', (_e, { item, choice }) => ext.specFromRegistry(item, choice));
ipcMain.handle('ext:skills:list', (_e, { cwd } = {}) => ({ skills: ext.listSkills(cwd || null), roots: ext.SKILL_ROOTS().map(r => ({ id: r.id, label: r.label, seenBy: r.seenBy })) }));
ipcMain.handle('ext:skills:read', (_e, { dir, cwd }) => ext.readSkill(dir, cwd || null));
ipcMain.handle('ext:skills:save', (_e, data) => ext.saveSkill(data));
ipcMain.handle('ext:skills:remove', (_e, { dir, cwd }) => { ext.removeSkill(dir, cwd || null); return true; });
ipcMain.handle('ext:skills:copy', (_e, { dir, root, cwd }) => ext.copySkill(dir, root, cwd || null));
ipcMain.handle('ext:skills:import', async (_e, { roots, cwd }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: t('Папка скилла (с файлом SKILL.md)') });
  if (r.canceled || !r.filePaths[0]) return null;
  return ext.importSkill(r.filePaths[0], roots || ['claude'], cwd || null);
});
ipcMain.handle('ext:plugins', async () => {
  const ctx = await extCtx();
  const agents = await installedAgents();
  const has = (id) => agents.some(a => a.id === id && a.installed);
  return {
    claude: has('claude') ? await ext.claudePlugins(ctx) : { ok: false, error: t('Claude Code не установлен') },
    codex: ext.codexPlugins(), antigravity: ext.agyPlugins(), markets: ext.MARKETS, agents,
  };
});
ipcMain.handle('ext:plugin', async (_e, { action, id, accept }) => {
  if (!['install', 'uninstall', 'enable', 'disable', 'update'].includes(action)) throw new Error('bad action');
  return ext.claudePluginAction(action, id, await extCtx(), { accept });
});
ipcMain.handle('ext:market', async (_e, { action, arg }) => {
  if (!['add', 'remove', 'update'].includes(action)) throw new Error('bad action');
  return ext.claudeMarketplace(action, arg, await extCtx());
});
ipcMain.handle('ext:codexPlugin', (_e, { id, enabled }) => { ext.codexPluginToggle(id, !!enabled); return true; });

async function runCode(taskId, input, settings, text, images, signal, log) {
  const detected = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  const installed = new Set(detected.filter(d => d.installed).map(d => d.id));
  const order = (input.executor ? [input.executor] : []).concat(settings.codeExecutors)
    .filter((v, i, a) => a.indexOf(v) === i && cli.LABELS[v]);
  const queue = order.filter(id => installed.has(id));
  if (!queue.length) {
    throw new Error(t('Не найден ни один CLI-агент. Установите Claude Code, Codex, Antigravity или OpenCode и войдите в аккаунт, затем нажмите «Проверить» в настройках.'));
  }

  const cwd = input.cwd || path.join(settings.workspaceRoot, `chat-${String(input.chatId).slice(0, 8)}`);
  fs.mkdirSync(cwd, { recursive: true });
  send(taskId, { kind: 'cwd', cwd });

  // Вложенные картинки кладём в папку проекта, чтобы агент мог их прочитать
  let attachNote = '';
  if (images.length) {
    const dir = path.join(cwd, '.synapse', 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    const saved = images.map((img, i) => {
      const f = path.join(dir, `${Date.now()}-${i}.${img.mime.split('/')[1] || 'png'}`);
      fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
      return f;
    });
    attachNote = `\n\n${t('Приложенные изображения:')}\n${saved.map(s => `- ${s}`).join('\n')}`;
  }
  if (input.prep?.save.length) {
    const dir = path.join(cwd, '.synapse', 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    const saved = input.prep.save.map(({ name, buf }) => {
      const f = path.join(dir, `${Date.now()}-${name}`);
      fs.writeFileSync(f, buf);
      return f;
    });
    attachNote += `\n\n${t('Приложенные файлы:')}\n${saved.map(s => `- ${s}`).join('\n')}`;
  }
  // режимы из меню «+»
  if (input.research) attachNote += `\n\n${t('Режим «Исследование»: сначала найди актуальную информацию в интернете (веб-поиск), сверь несколько источников и в конце дай список источников со ссылками.')}`;
  if (input.plan) attachNote += `\n\n${t('Режим плана: ничего не меняй и не запускай команды, которые меняют файлы. Изучи проект и составь подробный план: что и в каких файлах сделать, в каком порядке, какие риски. В конце спроси, начинать ли.')}`;

  // Сеть для агентов: в строгом режиме без прокси задача не запускается вовсе
  const extraEnv = { ...(await netproxy.agentEnv() || {}) };
  // OpenCode с моделями openrouter/… — ключ из настроек Synapse (другие агенты его не получают)
  const orKey = store.getOpenRouterKey();
  if (orKey) extraEnv.OPENROUTER_API_KEY = orKey;
  const sessions = sessionsOf(input);
  let lastErr = null;
  // История файлов: снимок до работы агента, точка восстановления — после (и при ошибке, если агент успел что-то поменять)
  const snap = history.before(cwd);
  let pointSent = false;
  const checkpoint = (executor) => {
    if (pointSent) return;
    pointSent = true;
    try { const point = history.after(snap, { chatId: input.chatId, executor, label: cli.LABELS[executor] || executor }); if (point) send(taskId, { kind: 'checkpoint', point }); } catch { /* история — не главное */ }
  };
  try {
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    // своя сессия агента: история и кэш уже у него — пересылаем только новое сообщение
    let resume = cli.RESUMABLE.has(id) ? sessions[id] || null : null;
    const am = id === input.executor && input.agentModel ? input.agentModel : null;
    send(taskId, { kind: 'executor', executor: id, label: am ? `${cli.LABELS[id]} · ${am}` : cli.LABELS[id] });
    send(taskId, { kind: 'status', status: 'working' });

    const mem = memoryText(settings);
    const env = settings.claudeEnv || {};
    const go = (sessionId) => cli.run({
      id, bin: cli.binFor(id, settings.cliPaths), cwd, access: input.plan ? 'read' : settings.agentAccess,
      // Claude получает «Обо мне» системным промптом, остальные агенты — в начале новой сессии
      prompt: (id !== 'claude' && !sessionId ? `${mem ? `${t('Контекст о пользователе (из Synapse):')}\n${mem}\n\n` : ''}${SUBAGENT_RULE}\n\n---\n\n` : '')
        + (sessionId ? '' : historyContext(input.history)) + text + attachNote,
      memoryFile: id === 'claude' ? systemFileFor(mem) : null,
      allowTools: settings.allowConnectors !== false ? ['Skill', ...(env.mcpPrefixes || [])] : [],
      sessionId, ultra: !!input.ultra, effort: input.effort || settings.effort, model: id === input.executor ? input.agentModel : null,
      extraEnv, signal, onEvent: (ev) => {
        if (ev.kind === 'agent-env') store.setSettings({ claudeEnv: ev });
        send(taskId, ev);
      },
    });
    let r = await go(resume);
    // сессия не продолжилась (удалена, другая версия CLI) — один раз начинаем заново с кратким контекстом
    if (!r.ok && resume && !r.aborted && !r.limited && !r.netFail && !r.notInstalled) {
      send(taskId, { kind: 'step', id: `resume-${id}`, status: 'done', title: t('Новая сессия'), tool: 'other', detail: t('Прошлую сессию продолжить не удалось — начинаю заново с кратким контекстом') });
      resume = null;
      r = await go(null);
    }

    if (r.ok) {
      log({ executor: id, ok: true, cost: r.cost, ultra: !!input.ultra, usage: r.usage, model: r.usage?.model || (id === input.executor ? input.agentModel : null) || null });
      checkpoint(id);
      return send(taskId, { kind: 'done', text: r.text, executor: id, sessionId: r.sessionId, cost: r.cost, cwd, usage: r.usage, context: r.context });
    }
    if (r.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
    lastErr = r.error;
    log({ executor: id, ok: false, error: String(r.error || '').slice(0, 200) });
    const next = queue[i + 1];
    if (next) {
      const reason = r.notInstalled ? t('не установлен') : r.limited ? t('лимит подписки') : r.netFail ? t('нет связи') : t('ошибка');
      send(taskId, { kind: 'fallback', from: cli.LABELS[id], to: cli.LABELS[next], reason, error: String(r.error || '').slice(0, 400), action: r.netFail ? 'network' : null });
    }
  }
  throw new Error(lastErr || t('Агенты не смогли выполнить задачу'));
  } finally { checkpoint(queue[queue.length - 1]); }
}

// Краткий контекст разговора для агента без своей сессии: код из ответов свёрнут, длинное сокращено
function historyContext(history = []) {
  const recent = tokens.agentHistory(history);
  if (!recent.length) return '';
  const lines = recent.map(m => `${m.role === 'user' ? t('Пользователь') : t('Ассистент')}: ${m.text}`);
  return `${t('Контекст предыдущего разговора:')}\n${lines.join('\n')}\n\n${t('Новая задача:')}\n`;
}
// Сессии агентов для этого чата (старые чаты хранили claudeSession / opencodeSession отдельно)
function sessionsOf(input) {
  const out = { ...(input.sessions && typeof input.sessions === 'object' ? input.sessions : {}) };
  if (!out.claude && input.claudeSession) out.claude = input.claudeSession;
  if (!out.opencode && input.opencodeSession) out.opencode = input.opencodeSession;
  for (const [k, v] of Object.entries(out)) if (!cli.RESUMABLE.has(k) || typeof v !== 'string' || !/^[\w.:-]{1,200}$/.test(v)) delete out[k];
  return out;
}

function toMedia(f) {
  return { ...f, url: 'media://f/' + encodeURIComponent(f.path) };
}
