// Каталог моделей: откуда Synapse берёт списки моделей для агентов, OpenRouter и Арены.
// 1) models.json рядом с приложением; 2) более новая копия этого файла с GitHub (обновляется сама);
// 3) data/models.json в папке данных — личные дополнения пользователя.
const fs = require('fs');
const path = require('path');
const netproxy = require('./netproxy');

const BUNDLED = path.join(__dirname, 'models.json');
const REMOTE_URL = 'https://raw.githubusercontent.com/wsq4kar/synapse/main/src/main/models.json';
const MODEL_ID = /^~?[\w.\-:]+(\/~?[\w.\-:]+){0,2}$/;
const AGENTS = ['claude', 'codex', 'antigravity', 'opencode'];

let dataDir = null;
let current = null;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const ids = (arr) => (Array.isArray(arr) ? arr : []).map(String).map(s => s.trim()).filter(s => MODEL_ID.test(s));
const uniq = (arr) => [...new Set(arr)];

// Привести файл к ожидаемому виду: неверные имена отбрасываем, чужие поля игнорируем
function sanitize(j) {
  if (!j || typeof j !== 'object') return null;
  const out = { version: String(j.version || '0'), agents: {}, openrouter: {}, arena: [] };
  for (const a of AGENTS) out.agents[a] = ids(j.agents?.[a]);
  const or = j.openrouter || {};
  for (const k of ['chat', 'chatUltra', 'router', 'image']) if (MODEL_ID.test(or[k] || '')) out.openrouter[k] = or[k];
  out.openrouter.list = ids(or.list);
  out.arena = (Array.isArray(j.arena) ? j.arena : [])
    .filter(x => x && MODEL_ID.test(x.model || '') && AGENTS.includes(x.agent) && ['big', 'small'].includes(x.tier))
    .map(x => ({ model: x.model, agent: x.agent, tier: x.tier }));
  return out;
}

// Личный файл дополняет списки (его модели — первыми)
function mergeUser(base, user) {
  if (!user) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const a of AGENTS) if (user.agents[a].length) out.agents[a] = uniq([...user.agents[a], ...out.agents[a]]);
  Object.assign(out.openrouter, Object.fromEntries(Object.entries(user.openrouter).filter(([k, v]) => k !== 'list' && v)));
  if (user.openrouter.list.length) out.openrouter.list = uniq([...user.openrouter.list, ...out.openrouter.list]);
  if (user.arena.length) out.arena = user.arena;
  return out;
}

function load() {
  const bundled = sanitize(readJson(BUNDLED)) || sanitize({});
  const remote = dataDir ? sanitize(readJson(path.join(dataDir, 'models.remote.json'))) : null;
  const base = remote && remote.version > bundled.version ? remote : bundled;
  const user = dataDir ? sanitize(readJson(path.join(dataDir, 'models.json'))) : null;
  current = mergeUser(base, user);
  return current;
}

function init(dir) { dataDir = dir; load(); }
function get() { return current || load(); }

// Скачать свежий список с GitHub (не чаще раза в 6 часов). Ошибки сети молча пропускаем.
async function refresh(force = false) {
  if (!dataDir) return get();
  const file = path.join(dataDir, 'models.remote.json');
  try {
    if (!force && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600 * 1000) return get();
  } catch { /* файла ещё нет */ }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await netproxy.fetch(REMOTE_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return get();
    const j = sanitize(await res.json());
    if (j && j.version) fs.writeFileSync(file, JSON.stringify(j, null, 2));
  } catch { /* без сети остаётся встроенный список */ }
  return load();
}

module.exports = { init, get, load, refresh, AGENTS };
