const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, protocol, net, Menu, screen } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const store = require('./store');
const router = require('./router');
const gemini = require('./executors/gemini');
const cli = require('./executors/cli');
const ws = require('./workspace');
const tunnel = require('./tunnel');
const netproxy = require('./netproxy');
const firewall = require('./firewall');
const codexLimits = require('./codexlimits');
const i18n = require('./i18n');
const { t } = i18n;

if (process.env.SYNAPSE_USER_DATA) app.setPath('userData', process.env.SYNAPSE_USER_DATA);
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
  Menu.setApplicationMenu(null);
  const mediaRoot = path.resolve(store.dirs().media);
  protocol.handle('media', (req) => {
    const p = path.resolve(decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, '')));
    if (!p.startsWith(mediaRoot + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  protocol.handle('wsfile', (req) => ws.handleProtocol(req, net.fetch, pathToFileURL));
  createWindow();
  tunnel.onStatus((st) => { if (win && !win.isDestroyed()) win.webContents.send('tunnel:status', { ...st, enabled: !!store.getSettings().tunnel?.enabled }); });
  netproxy.configure(store.getSettings().net, store.getSettings().tunnel).catch(() => {});
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
app.on('before-quit', () => tunnel.stop());

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
const send = (taskId, ev) => { if (win && !win.isDestroyed()) win.webContents.send('task:event', { taskId, ...ev }); };

const fullSettings = () => ({ ...store.getSettings(), lang: i18n.lang(), hasKey: !!store.getGeminiKey(), platform: process.platform, version: app.getVersion(), user: safeUser() });
ipcMain.handle('settings:get', fullSettings);
function safeUser() { try { return os.userInfo().username; } catch { return 'user'; } }
ipcMain.handle('settings:set', (_e, patch) => {
  const s = store.setSettings(patch || {});
  if (patch && 'theme' in patch) applyTheme(s.theme);
  if (patch && patch.cliPaths) cliCache = null;
  if (patch && (patch.tunnel || patch.net)) netproxy.configure(s.net, s.tunnel).catch(() => {});
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
ipcMain.handle('shell:reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.handle('file:saveAs', async (_e, p) => {
  if (typeof p !== 'string' || !path.resolve(p).startsWith(path.resolve(store.dirs().media)) || !fs.existsSync(p)) return false;
  const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(p) });
  if (r.canceled || !r.filePath) return false;
  fs.copyFileSync(p, r.filePath);
  return true;
});
ipcMain.handle('usage:read', () => store.readUsage());
ipcMain.handle('task:cancel', (_e, taskId) => { tasks.get(taskId)?.abort(); return true; });
ipcMain.handle('task:run', (_e, input) => {
  const taskId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ctrl = new AbortController();
  tasks.set(taskId, ctrl);
  runTask(taskId, input, ctrl.signal)
    .catch(e => {
      const code = e.code || (e.name === 'AbortError' ? 'aborted' : null);
      send(taskId, { kind: 'error', error: code === 'aborted' ? t('Остановлено') : (e.message || String(e)), code });
    })
    .finally(() => tasks.delete(taskId));
  return taskId;
});

// ---------------- выполнение задачи ----------------
async function runTask(taskId, input, signal) {
  const settings = store.getSettings();
  const key = store.getGeminiKey();
  const images = (input.images || []).filter(i => i && /^image\//.test(i.mime) && typeof i.data === 'string');
  const text = String(input.text || '').trim();
  const started = Date.now();

  send(taskId, { kind: 'status', status: 'routing' });
  // Агент выбран вручную в меню модели — задача уходит ему (кроме явных «Изображение»/«Видео»)
  const forced = input.executor && cli.LABELS[input.executor] && !['image', 'video'].includes(input.mode)
    ? { route: 'code', reason: t('выбрано вручную') } : null;
  const decided = forced || await router.route({
    text, mode: input.mode, hasFolder: !!input.cwd, hasImages: images.length > 0, lastRoute: input.lastRoute,
    askModel: settings.smartRouting && key
      ? (t, context) => gemini.classify({ key, model: settings.models.router, text: t, prompt: router.ROUTER_PROMPT, context, signal })
      : null,
  });
  send(taskId, { kind: 'route', route: decided.route, reason: decided.reason });

  const log = (extra) => store.logUsage({ route: decided.route, ms: Date.now() - started, chars: text.length, ...extra });

  try {
    // Без ключа Gemini разговор ведёт Claude Code / Codex — подписки хватает
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
          key, model: mdl, history: input.history || [], text, images, signal, memory: memoryText(settings),
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
      log({ executor: 'gemini', model, ok: true, tokens: r.usage?.totalTokenCount });
      const gu = geminiUsage(r.usage, model);
      const window = await geminiWindow(key, model);
      const context = r.usage ? { used: (r.usage.promptTokenCount || 0) + (r.usage.candidatesTokenCount || 0) + (r.usage.thoughtsTokenCount || 0), window } : null;
      if (context) send(taskId, { kind: 'context', ...context, model });
      return send(taskId, { kind: 'done', text: r.text, executor: 'gemini', usage: gu, context });
    }

    if (decided.route === 'image') {
      send(taskId, { kind: 'executor', executor: 'gemini', label: `${t('Изображение')} · ${settings.models.image}` });
      send(taskId, { kind: 'status', status: 'generating' });
      const r = await withModelFallback('image', key, settings.models.image, (mdl) => gemini.image({ key, model: mdl, text, images, outDir: store.mediaDir(input.chatId), signal }));
      log({ executor: 'gemini', model: settings.models.image, ok: true, files: r.files.length });
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

// ---------- Память «Обо мне» ----------
const memoryPath = () => path.join(store.dirs().root, 'memory.md');
function memoryText(settings) {
  if (settings.memoryEnabled === false) return '';
  try { return fs.readFileSync(memoryPath(), 'utf8').trim().slice(0, 12000); } catch { return ''; }
}
// Дополнение к системному промпту Claude Code: «Обо мне» + режим «Команда»
const TEAM_PROMPT = `Режим «Команда». Работай как ведущий разработчик с командой субагентов:
- Если задача большая, разбей её на независимые части и поручи их субагентам (инструмент Task/Agent) — несколько сразу, параллельно. Например: разметка и стили, логика, данные, тесты, проверка результата.
- Каждому субагенту дай короткое понятное описание (description) и полное задание с путями к файлам.
- Сам собери результат, проверь, что части стыкуются, и кратко отчитайся.
- Для простых вопросов и маленьких правок субагентов не запускай.`;
function systemFileFor(mem, team) {
  const parts = [];
  if (mem) parts.push(`# О пользователе (его собственные заметки)\n${mem}`);
  if (team) parts.push(TEAM_PROMPT);
  if (!parts.length) return null;
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

async function runCode(taskId, input, settings, text, images, signal, log) {
  const detected = cliCache || (cliCache = await cli.detect(settings.cliPaths));
  const installed = new Set(detected.filter(d => d.installed).map(d => d.id));
  const order = (input.executor ? [input.executor] : []).concat(settings.codeExecutors)
    .filter((v, i, a) => a.indexOf(v) === i && cli.LABELS[v]);
  const queue = order.filter(id => installed.has(id));
  if (!queue.length) {
    throw new Error(t('Не найден ни один CLI-агент. Установите Claude Code, Codex, Gemini CLI или OpenCode и войдите в аккаунт, затем нажмите «Проверить» в настройках.'));
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

  // Сеть для агентов: в строгом режиме без прокси задача не запускается вовсе
  const extraEnv = await netproxy.agentEnv();
  let lastErr = null;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const resume = id === 'claude' ? input.claudeSession : id === 'opencode' ? input.opencodeSession : null;
    const prompt = (resume ? '' : historyContext(input.history)) + text + attachNote;
    const am = id === input.executor && input.agentModel ? input.agentModel : null;
    send(taskId, { kind: 'executor', executor: id, label: am ? `${cli.LABELS[id]} · ${am}` : cli.LABELS[id] });
    send(taskId, { kind: 'status', status: 'working' });

    const mem = memoryText(settings);
    const env = settings.claudeEnv || {};
    const r = await cli.run({
      id, bin: cli.binFor(id, settings.cliPaths), cwd, access: settings.agentAccess,
      // Claude получает «Обо мне» системным промптом, остальные агенты — в начале задачи
      prompt: (id !== 'claude' && mem && !resume ? `${t('Контекст о пользователе (из Synapse):')}\n${mem}\n\n---\n\n` : '') + prompt,
      memoryFile: id === 'claude' ? systemFileFor(mem, !!input.team) : null,
      allowTools: settings.allowConnectors !== false ? ['Skill', ...(env.mcpPrefixes || [])] : [],
      sessionId: resume, ultra: !!input.ultra, effort: input.effort || settings.effort, model: id === input.executor ? input.agentModel : null,
      extraEnv, signal, onEvent: (ev) => {
        if (ev.kind === 'agent-env') store.setSettings({ claudeEnv: ev });
        send(taskId, ev);
      },
    });

    if (r.ok) {
      log({ executor: id, ok: true, cost: r.cost, ultra: !!input.ultra });
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
}

function historyContext(history = []) {
  const recent = history.filter(m => m.text).slice(-6);
  if (!recent.length) return '';
  const lines = recent.map(m => `${m.role === 'user' ? t('Пользователь') : t('Ассистент')}: ${m.text.slice(0, 1500)}`);
  return `${t('Контекст предыдущего разговора:')}\n${lines.join('\n')}\n\n${t('Новая задача:')}\n`;
}

function toMedia(f) {
  return { ...f, url: 'media://f/' + encodeURIComponent(f.path) };
}
