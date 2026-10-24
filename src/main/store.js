// Локальное хранилище: настройки, ключи (зашифрованы через safeStorage), чаты, журнал.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'system',                 // system | light | dark
  smartRouting: true,              // спрашивать Gemini, если по словам непонятно
  codeExecutors: ['claude', 'codex', 'gemini-cli', 'opencode'], // порядок фолбэка
  agentAccess: 'edits',            // edits — только правки файлов; full — полный доступ
  models: {
    chat: 'gemini-2.5-flash',
    chatUltra: 'gemini-2.5-pro',
    router: 'gemini-2.5-flash-lite',
    image: 'gemini-2.5-flash-image',
    video: 'veo-3.0-fast-generate-001',
    videoUltra: 'veo-3.0-generate-001',
  },
  modelsAutoPicked: false,
  net: { mode: 'http', http: '127.0.0.1:10801', strict: true }, // как нейросети выходят в интернет: system | http | ssh
  tunnel: { enabled: false, host: '', user: 'root', port: 22, key: '' }, // Gemini через SSH-сервер
  modelsPicked2: false,
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
  cliPaths: { claude: '', codex: '', 'gemini-cli': '', opencode: '' }, // пусто = автопоиск
  // модели, которые можно выбрать для каждого CLI (флаг --model / -m)
  cliModels: {
    claude: 'claude-fable-5-1, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5, claude-sonnet-5',
    codex: 'gpt-6.1-sol, gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5',
    'gemini-cli': '', // пусто — список берётся из моделей Gemini API по ключу
    // OpenCode: любые провайдеры в виде provider/model; бесплатные модели OpenCode Zen работают без входа
    opencode: 'opencode/deepseek-v4.1-flash-free, opencode/glm-5.3-flash-free, opencode/big-pickle',
  },
  sidebarCollapsed: false,
  lang: '',
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
  for (const id of DEFAULT_SETTINGS.codeExecutors) if (!s.codeExecutors.includes(id)) s.codeExecutors.push(id);
  const bare = { claude: ['claude'], codex: ['codex'], 'gemini-cli': ['gemini', 'gemini-cli'], opencode: ['opencode'] };
  for (const [id, names] of Object.entries(bare)) if (names.includes((s.cliPaths?.[id] || '').trim())) s.cliPaths[id] = '';
  return s;
}
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
function logUsage(entry) {
  fs.appendFileSync(path.join(dirs().logs, 'usage.jsonl'), JSON.stringify({ t: Date.now(), ...entry }) + '\n');
}
function readUsage(limit = 200) {
  try {
    const lines = fs.readFileSync(path.join(dirs().logs, 'usage.jsonl'), 'utf8').trim().split('\n');
    return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = {
  dirs, getSettings, setSettings, getGeminiKey, setGeminiKey,
  listChats, getChat, saveChat, deleteChat, mediaDir, logUsage, readUsage,
  listProjects, saveProject, deleteProject, listMedia, recentFolders,
};
