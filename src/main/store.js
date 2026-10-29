// Локальное хранилище: настройки, ключи (зашифрованы через safeStorage), чаты, журнал.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'system',                 // system | light | dark
  smartRouting: true,              // спрашивать Gemini, если по словам непонятно
  codeExecutors: ['claude', 'codex', 'antigravity', 'opencode'], // порядок фолбэка
  agentAccess: 'edits',            // edits — только правки файлов; full — полный доступ
  discord: { on: true, showModel: true, showProject: false }, // статус в Discord
  models: {
    chat: 'gemini-2.5-flash',
    chatUltra: 'gemini-2.5-pro',
    router: 'gemini-2.5-flash-lite',
    image: 'gemini-2.5-flash-image',
    video: 'veo-3.0-fast-generate-001',
    videoUltra: 'veo-3.0-generate-001',
  },
  modelsAutoPicked: false,
  // OpenRouter: пусто — модель из models.json
  openrouter: { chat: '', chatUltra: '', router: '', image: '' },
  net: { mode: 'http', http: '127.0.0.1:10801', strict: true }, // как нейросети выходят в интернет: system | http | ssh
  tunnel: { enabled: false, host: '', user: 'root', port: 22, key: '' }, // Gemini через SSH-сервер
  modelsPicked2: false,
  extSaved: {},                    // описания MCP-серверов, выключенных у всех агентов
  team: false,                     // режим «Команда»: Claude Code раздаёт части задачи субагентам
  // Арена: большие модели планируют, спорят, пишут свои варианты и голосуют за лучший
  arena: { on: false, auto: true, rounds: 3, maxBig: 3, roster: [], dispatcher: null },
  memoryEnabled: true,             // передавать «Обо мне» агентам и Gemini
  allowConnectors: true,           // скиллы и коннекторы Claude Code без подтверждения
  claudeEnv: null,                 // что Claude Code загрузил в прошлый раз (скиллы, коннекторы)           // один раз обновляем старые модели по умолчанию
  ultra: false,
  effort: 'auto', // auto | low | medium | high | xhigh | max
  asciiBg: true,
  look: { font: 'system', size: 'm', accent: 'teal', width: 'm', motion: 'system', send: 'enter', bubbles: true }, // внешний вид
  pets: { enabled: true, list: ['dumpling', 'bot'] },
  progressPanel: true,
  windowBounds: null,
  videoAspect: '16:9',
  workspaceRoot: '',               // пусто = Документы/Synapse
  cliPaths: { claude: '', codex: '', antigravity: '', opencode: '' }, // пусто = автопоиск
  // Свои модели сверх списка из models.json (через запятую). Обычно пусто — список приложение берёт само.
  cliModels: { claude: '', codex: '', antigravity: '', opencode: '' },
  sidebarCollapsed: false,
  lang: '',
  displayName: '',                 // имя в приложении; пусто — имя пользователя Windows
};

let root;
function dirs() {
  if (!root) {
    root = path.join(app.getPath('userData'), 'data');
    for (const d of ['chats', 'media', 'logs']) fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  return {
    root,
    chats: path.join(root, 'chats'),
    media: path.join(root, 'media'),
    logs: path.join(root, 'logs'),
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

// ---------- настройки ----------
function getSettings() {
  const raw = readJson(path.join(dirs().root, 'settings.json'), {});
  const s = deepMerge(DEFAULT_SETTINGS, raw);
  // старые версии: включённый туннель → режим «SSH-сервер»
  if (!raw.net && raw.tunnel?.enabled) s.net.mode = 'ssh';
  if (!s.workspaceRoot) s.workspaceRoot = path.join(app.getPath('documents'), 'Synapse');
  // старые версии писали просто имя команды — теперь пусто = автопоиск
  // новые исполнители — в конец очереди у тех, кто уже настроил порядок
  migrateGeminiCli(s);
  for (const id of DEFAULT_SETTINGS.codeExecutors) if (!s.codeExecutors.includes(id)) s.codeExecutors.push(id);
  // старые списки моделей по умолчанию теперь живут в models.json
  for (const [id, v] of Object.entries(s.cliModels || {})) if (OLD_MODEL_DEFAULTS.has(String(v).replace(/\s+/g, ''))) s.cliModels[id] = '';
  const bare = { claude: ['claude'], codex: ['codex'], antigravity: ['agy', 'antigravity'], opencode: ['opencode'] };
  for (const [id, names] of Object.entries(bare)) if (names.includes((s.cliPaths?.[id] || '').trim())) s.cliPaths[id] = '';
  return s;
}
// Gemini CLI заменён на Antigravity CLI: переносим порядок, Арену и убираем старые поля
function migrateGeminiCli(s) {
  s.codeExecutors = [...new Set((s.codeExecutors || []).map(id => (id === 'gemini-cli' ? 'antigravity' : id)))];
  if (s.cliPaths) delete s.cliPaths['gemini-cli'];
  if (s.cliModels) delete s.cliModels['gemini-cli'];
  if (s.arena) {
    if (Array.isArray(s.arena.roster)) s.arena.roster = s.arena.roster.map(r => (r?.agent === 'gemini-cli' ? { ...r, agent: 'antigravity', model: null } : r));
    if (s.arena.dispatcher?.agent === 'gemini-cli') s.arena.dispatcher = null;
  }
}
const OLD_MODEL_DEFAULTS = new Set([
  'claude-fable-5-1,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5,claude-sonnet-5',
  'gpt-6.1-sol,gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna,gpt-5.5',
  'opencode/deepseek-v4.1-flash-free,opencode/glm-5.3-flash-free,opencode/big-pickle',
]);
function setSettings(patch) {
  const next = deepMerge(getSettings(), patch);
  writeJson(path.join(dirs().root, 'settings.json'), next);
  return next;
}

// ---------- секреты ----------
const secretsFile = () => path.join(dirs().root, 'secrets.bin');
function readSecrets() {
  try {
    const buf = fs.readFileSync(secretsFile());
    const text = safeStorage.isEncryptionAvailable() && buf[0] !== 0x7b
      ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(text);
  } catch { return {}; }
}
function writeSecrets(obj) {
  const text = JSON.stringify(obj);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
  fs.writeFileSync(secretsFile(), data);
}
function getOpenRouterKey() { return readSecrets().openrouter || process.env.OPENROUTER_API_KEY || ''; }
function setOpenRouterKey(key) {
  const s = readSecrets();
  if (key) s.openrouter = String(key).trim(); else delete s.openrouter;
  writeSecrets(s);
}
function getGeminiKey() { return readSecrets().gemini || process.env.GEMINI_API_KEY || ''; }
function setGeminiKey(key) {
  const s = readSecrets();
  if (key) s.gemini = String(key).trim(); else delete s.gemini;
  writeSecrets(s);
}

// ---------- чаты ----------
const safeId = (id) => /^[a-z0-9-]{6,64}$/i.test(id) ? id : null;
function listChats() {
  const { chats } = dirs();
  return fs.readdirSync(chats).filter(f => f.endsWith('.json')).map(f => {
    const c = readJson(path.join(chats, f), null);
    return c && { id: c.id, kind: c.kind || 'chat', title: c.title, updatedAt: c.updatedAt, pinned: !!c.pinned, projectId: c.projectId || null, cwd: c.cwd || null };
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
function getChat(id) {
  if (!safeId(id)) return null;
  return readJson(path.join(dirs().chats, id + '.json'), null);
}
function saveChat(chat) {
  if (!chat || !safeId(chat.id)) throw new Error('bad chat id');
  chat.updatedAt = Date.now();
  writeJson(path.join(dirs().chats, chat.id + '.json'), chat);
  return true;
}
function deleteChat(id) {
  if (!safeId(id)) return false;
  fs.rmSync(path.join(dirs().chats, id + '.json'), { force: true });
  fs.rmSync(path.join(dirs().media, id), { recursive: true, force: true });
  return true;
}

// ---------- проекты ----------
const projectsFile = () => path.join(dirs().root, 'projects.json');
function listProjects() { return readJson(projectsFile(), []); }
function saveProject(p) {
  if (!p || !safeId(p.id)) throw new Error('bad project id');
  const list = listProjects();
  const i = list.findIndex(x => x.id === p.id);
  const clean = { id: p.id, name: String(p.name || 'Проект').slice(0, 80), folder: p.folder || null, pinned: !!p.pinned, createdAt: p.createdAt || Date.now(), updatedAt: Date.now() };
  if (i >= 0) list[i] = clean; else list.unshift(clean);
  writeJson(projectsFile(), list);
  return clean;
}
function deleteProject(id) {
  writeJson(projectsFile(), listProjects().filter(p => p.id !== id));
  for (const c of listChats()) if (c.projectId === id) {
    const full = getChat(c.id);
    if (full) { full.projectId = null; writeJson(path.join(dirs().chats, full.id + '.json'), full); }
  }
  return true;
}

// Все сгенерированные изображения и видео
function listMedia() {
  const out = [];
  for (const c of listChats()) {
    const full = getChat(c.id);
    for (const m of full?.messages || []) {
      for (const f of m.files || []) {
        if (fs.existsSync(f.path)) out.push({ ...f, chatId: c.id, chatTitle: c.title, at: m.at || c.updatedAt });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

// Недавние рабочие папки (для выбора окружения во вкладке «Код»)
function recentFolders() {
  const seen = new Map();
  for (const c of listChats()) if (c.cwd && !seen.has(c.cwd)) seen.set(c.cwd, c.updatedAt);
  for (const p of listProjects()) if (p.folder && !seen.has(p.folder)) seen.set(p.folder, p.updatedAt || 0);
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);
}

// ---------- медиа и журнал ----------
function mediaDir(chatId) {
  const d = path.join(dirs().media, safeId(chatId) || 'misc');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// Токены задачи в компактном виде: in — новые входные, cr/cw — чтение/запись кэша, out — ответ, th — рассуждения
function compactTokens(u, executor) {
  if (!u) return null;
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  const tk = { in: n(u.input), cr: n(u.cacheRead), cw: n(u.cacheWrite), out: n(u.output), th: n(u.thinking) };
  // у Gemini рассуждения не входят в output, у Claude/Codex — входят
  tk.total = tk.in + tk.cr + tk.cw + tk.out + (['gemini', 'antigravity'].includes(executor) ? tk.th : 0);
  return tk.total ? tk : null;
}
function logUsage(entry) {
  const { usage, ...rest } = entry || {};
  const tk = compactTokens(usage, rest.executor);
  if (tk) { rest.tk = tk; if (!rest.model && usage?.model) rest.model = usage.model; if (rest.cost == null && typeof usage?.listCost === 'number') rest.cost = usage.listCost; }
  fs.appendFileSync(path.join(dirs().logs, 'usage.jsonl'), JSON.stringify({ t: Date.now(), ...rest }) + '\n');
}

// ---------- статистика (как в Codex: токены за всё время, серии, активность) ----------
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function readAllUsage() {
  try {
    return fs.readFileSync(path.join(dirs().logs, 'usage.jsonl'), 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
// Задачи до появления статистики берём из сохранённых чатов (там у ответов уже есть токены)
function backfill(since) {
  const file = path.join(dirs().logs, 'usage-backfill.jsonl');
  try { return fs.readFileSync(file, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* ещё не собрано */ }
  const out = [];
  for (const c of listChats()) {
    const full = getChat(c.id);
    for (const m of full?.messages || []) {
      if (m.role !== 'assistant' || !m.at || m.at >= since) continue;
      if (m.status !== 'done' && m.status !== 'error') continue;
      const tk = compactTokens(m.usage, m.executor);
      out.push({ t: m.at, route: m.route || null, executor: m.executor || null, model: m.usage?.model || null, ok: m.status === 'done', ms: m.ms || null, ultra: !!m.ultra, arena: m.executor === 'arena', ...(tk ? { tk } : {}) });
    }
  }
  try { fs.writeFileSync(file, out.map(x => JSON.stringify(x)).join('\n')); } catch { /* не критично */ }
  return out;
}
function usageStats() {
  let s = getSettings();
  if (!s.statsSince) s = setSettings({ statsSince: Date.now() });
  const since = s.statsSince;
  // старые записи журнала без токенов заменяет перенос из чатов; новые (с tk) учитываем всегда
  const rows = [...backfill(since), ...readAllUsage().filter(r => r.t >= since || r.tk)];
  const days = {};
  const by = {}, models = {}, efforts = {};
  let total = 0, fresh = 0, cache = 0, thinking = 0, tasks = 0, okCount = 0, longest = null, cost = 0, ultra = 0, arena = 0;
  for (const r of rows) {
    const k = dayKey(r.t);
    const d = days[k] || (days[k] = { tokens: 0, tasks: 0 });
    const tok = r.tk?.total || 0;
    d.tokens += tok; d.tasks++;
    total += tok; fresh += (r.tk?.in || 0) + (r.tk?.out || 0); cache += (r.tk?.cr || 0) + (r.tk?.cw || 0); thinking += r.tk?.th || 0;
    tasks++; if (r.ok !== false) okCount++;
    if (r.ms && (!longest || r.ms > longest.ms)) longest = { ms: r.ms, at: r.t, executor: r.executor || null };
    if (typeof r.cost === 'number') cost += r.cost;
    if (r.ultra) ultra++;
    if (r.arena) arena++;
    const ex = r.executor || r.route || 'other';
    const b = by[ex] || (by[ex] = { tasks: 0, tokens: 0 });
    b.tasks++; b.tokens += tok;
    if (r.model) { const m = models[r.model] || (models[r.model] = { tasks: 0, tokens: 0, executor: r.executor || null }); m.tasks++; m.tokens += tok; }
    if (r.effort) efforts[r.effort] = (efforts[r.effort] || 0) + 1;
  }
  // серии дней подряд
  const keys = Object.keys(days).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const cur = new Date(k + 'T12:00:00');
    run = prev && Math.round((cur - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = cur;
  }
  let current = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    if (days[dayKey(d)]) current++;
    else if (current || dayKey(d) !== dayKey(Date.now())) break; // сегодня ещё можно успеть
  }
  const maxDay = keys.reduce((a, k) => (days[k].tokens > a.tokens ? { day: k, tokens: days[k].tokens } : a), { day: null, tokens: 0 });
  const topEffort = Object.entries(efforts).sort((a, b) => b[1] - a[1])[0] || null;
  const effortTotal = Object.values(efforts).reduce((a, b) => a + b, 0);
  return {
    total, fresh, cache, thinking, tasks, ok: okCount, cost, ultra, arena, longest, maxDay,
    streak: { best, current }, activeDays: keys.length, first: rows.length ? Math.min(...rows.map(r => r.t)) : null,
    days, byExecutor: by,
    models: Object.entries(models).sort((a, b) => b[1].tokens - a[1].tokens || b[1].tasks - a[1].tasks).slice(0, 8).map(([id, v]) => ({ id, ...v })),
    effort: topEffort ? { level: topEffort[0], share: Math.round(topEffort[1] / effortTotal * 100) } : null,
  };
}
function readUsage(limit = 200) {
  try {
    const lines = fs.readFileSync(path.join(dirs().logs, 'usage.jsonl'), 'utf8').trim().split('\n');
    return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = {
  dirs, getSettings, setSettings, getGeminiKey, setGeminiKey, getOpenRouterKey, setOpenRouterKey,
  listChats, getChat, saveChat, deleteChat, mediaDir, logUsage, readUsage, usageStats,
  listProjects, saveProject, deleteProject, listMedia, recentFolders,
};
