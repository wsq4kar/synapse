// Расширения агентов: MCP-серверы, коннекторы, скиллы, плагины и маркетплейсы.
// Synapse ничего не хранит «у себя»: читает и пишет родные конфиги каждого CLI,
// поэтому всё, что добавлено здесь, работает и в самих Claude Code / Codex / Gemini CLI / OpenCode.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { t } = require('./i18n');

const IS_WIN = process.platform === 'win32';
const home = () => os.homedir();
const P = {
  claudeJson: () => path.join(home(), '.claude.json'),
  claudeSkills: () => path.join(home(), '.claude', 'skills'),
  agentsSkills: () => path.join(home(), '.agents', 'skills'),
  geminiSkills: () => path.join(home(), '.gemini', 'skills'),
  opencodeSkills: () => path.join(home(), '.config', 'opencode', 'skills'),
  codexToml: () => path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'config.toml'),
  codexPlugins: () => path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'plugins', 'cache'),
  geminiSettings: () => path.join(home(), '.gemini', 'settings.json'),
  geminiExt: () => path.join(home(), '.gemini', 'extensions'),
  opencodeJson: () => path.join(home(), '.config', 'opencode', 'opencode.json'),
};
const AGENTS = ['claude', 'codex', 'gemini-cli', 'opencode'];
const NAME_RE = /^[A-Za-z0-9][\w.-]{0,63}$/;

// ---------- файлы ----------
function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw Object.assign(new Error(t('Не удалось прочитать {f}: {m}', { f, m: e.message })), { code: 'ext' }); }
}
function writeAtomic(f, text) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try { if (fs.existsSync(f) && !fs.existsSync(f + '.synapse-backup')) fs.copyFileSync(f, f + '.synapse-backup'); } catch { /* резервная копия не обязательна */ }
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, f);
}
const writeJson = (f, obj) => writeAtomic(f, JSON.stringify(obj, null, 2) + '\n');
// JSON с комментариями (opencode.jsonc) — читаем, но не переписываем, чтобы не потерять комментарии
const hasComments = (s) => /^\s*\/\/|\/\*/m.test(s);

// ---------- маленький разбор TOML (только то, что нужно для config.toml Codex) ----------
function tomlValue(s) {
  s = s.trim();
  if (s.startsWith('"')) { const m = /^"((?:[^"\\]|\\.)*)"/.exec(s); return m ? JSON.parse(`"${m[1]}"`) : s; }
  if (s.startsWith("'")) { const m = /^'([^']*)'/.exec(s); return m ? m[1] : s; }
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('[')) return splitTop(s.slice(1, s.lastIndexOf(']'))).map(tomlValue);
  if (s.startsWith('{')) {
    const o = {};
    for (const part of splitTop(s.slice(1, s.lastIndexOf('}')))) {
      const i = part.indexOf('=');
      if (i > 0) o[unquoteKey(part.slice(0, i).trim())] = tomlValue(part.slice(i + 1));
    }
    return o;
  }
  return s;
}
function splitTop(s) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquoteKey = (k) => (/^".*"$/.test(k) ? JSON.parse(k) : /^'.*'$/.test(k) ? k.slice(1, -1) : k);
function headerPath(h) { return splitDotted(h).map(unquoteKey); }
function splitDotted(s) {
  const out = []; let q = null, cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '.') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const h = /^\[([^\[\]]+)\]\s*(#.*)?$/.exec(line);
    if (h) {
      cur = root;
      for (const k of headerPath(h[1])) cur = cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let val = line.slice(eq + 1).trim();
    // многострочный массив
    if (val.startsWith('[') && !balanced(val)) { while (i + 1 < lines.length && !balanced(val)) val += ' ' + lines[++i].trim(); }
    if (val.startsWith('"""') || val.startsWith("'''")) continue; // многострочные строки нам не нужны
    val = val.replace(/\s+#[^"'\]}]*$/, '');
    const keys = splitDotted(line.slice(0, eq)).map(unquoteKey);
    let o = cur;
    for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
    o[keys.at(-1)] = tomlValue(val);
  }
  return root;
}
function balanced(s) { let d = 0, q = null; for (const c of s) { if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--; } return d <= 0; }
const tq = (s) => JSON.stringify(String(s));
const tkey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tq(k));
const tInline = (o) => `{ ${Object.entries(o).map(([k, v]) => `${tkey(k)} = ${tq(v)}`).join(', ')} }`;
// удалить таблицу [prefix] и все её подтаблицы [prefix.*]
function tomlRemoveTable(text, pathArr) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const h = /^\s*\[([^\[\]]+)\]\s*(#.*)?$/.exec(line);
    if (h) {
      const hp = headerPath(h[1]);
      skip = pathArr.every((k, i) => hp[i] === k) && hp.length >= pathArr.length;
    }
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
// поставить ключ внутри существующей таблицы (или добавить таблицу)
function tomlSetKey(text, pathArr, key, rawValue) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const h = /^\s*\[([^\[\]]+)\]\s*(#.*)?$/.exec(lines[i]);
    if (!h) continue;
    if (start >= 0) { end = i; break; }
    const hp = headerPath(h[1]);
    if (hp.length === pathArr.length && pathArr.every((k, j) => hp[j] === k)) start = i;
  }
  if (start < 0) return `${text.replace(/\s*$/, '')}\n\n[${pathArr.map(tkey).join('.')}]\n${key} = ${rawValue}\n`;
  for (let i = start + 1; i < end; i++) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) { lines[i] = `${key} = ${rawValue}`; return lines.join('\n'); }
  }
  lines.splice(start + 1, 0, `${key} = ${rawValue}`);
  return lines.join('\n');
}

// ---------- запуск CLI ----------
function winQuote(a) { return /[\s"&|<>^%]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a; }
/** Запустить CLI без оболочки, где можно (.exe и не Windows), иначе через cmd с кавычками. */
function runCli(bin, args, { env, timeout = 120000, input } = {}) {
  return new Promise((resolve) => {
    const viaShell = IS_WIN && !/\.exe$/i.test(bin);
    let child;
    try {
      child = spawn(viaShell && /\s/.test(bin) ? `"${bin}"` : bin, viaShell ? args.map(winQuote) : args,
        { shell: viaShell, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...(env || {}) } });
    } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.code === 'ENOENT' ? t('CLI не найден: {b}', { b: bin }) : e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
const lastJsonLine = (s) => { const lines = String(s).trim().split(/\r?\n/).reverse(); for (const l of lines) { try { return JSON.parse(l); } catch { /* */ } } return null; };
const firstJson = (s) => { const i = String(s).search(/[\[{]/); if (i < 0) return null; try { return JSON.parse(String(s).slice(i)); } catch { return null; } };
// Открыть системный терминал с командой (вход OAuth и т.п. — пользователь проходит его сам)
function openTerminal(bin, args, env) {
  const cmd = [IS_WIN && /\s/.test(bin) ? `"${bin}"` : bin, ...args.map(a => (IS_WIN ? winQuote(a) : `'${String(a).replace(/'/g, "'\\''")}'`))].join(' ');
  const e = { ...process.env, ...(env || {}) };
  if (IS_WIN) spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', cmd], { detached: true, windowsHide: false, env: e }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`], { detached: true, env: e }).unref();
  else spawn('x-terminal-emulator', ['-e', cmd], { detached: true, env: e }).unref();
}

// ================= MCP =================
// Общий вид сервера: { type: 'stdio', command, args[], env{} } или { type: 'http', url, headers{} }
function fromClaude(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'http' || s.type === 'sse' || (s.url && s.type !== 'stdio')) return { type: 'http', url: s.url, headers: s.headers || {}, sse: s.type === 'sse' };
  return { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {} };
}
function fromCodex(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.url) return { type: 'http', url: s.url, headers: s.http_headers || {}, bearerEnv: s.bearer_token_env_var || null, enabled: s.enabled !== false };
  return { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {}, enabled: s.enabled !== false };
}
function fromGemini(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.httpUrl || s.url) return { type: 'http', url: s.httpUrl || s.url, headers: s.headers || {}, sse: !s.httpUrl };
  return { type: 'stdio', command: s.command, args: s.args || [], env: s.env || {} };
}
function fromOpencode(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'remote') return { type: 'http', url: s.url, headers: s.headers || {}, enabled: s.enabled !== false };
  const [command, ...args] = Array.isArray(s.command) ? s.command : [s.command];
  return { type: 'stdio', command, args, env: s.environment || {}, enabled: s.enabled !== false };
}

function readMcp() {
  const out = { claude: {}, codex: {}, 'gemini-cli': {}, opencode: {} };
  const errors = {};
  try { const j = readJson(P.claudeJson(), {}); for (const [n, s] of Object.entries(j.mcpServers || {})) out.claude[n] = fromClaude(s); } catch (e) { errors.claude = e.message; }
  try {
    const f = P.codexToml();
    if (fs.existsSync(f)) { const j = parseToml(fs.readFileSync(f, 'utf8')); for (const [n, s] of Object.entries(j.mcp_servers || {})) out.codex[n] = fromCodex(s); }
  } catch (e) { errors.codex = e.message; }
  try { const j = readJson(P.geminiSettings(), {}); for (const [n, s] of Object.entries(j.mcpServers || {})) out['gemini-cli'][n] = fromGemini(s); } catch (e) { errors['gemini-cli'] = e.message; }
  try {
    const f = P.opencodeJson();
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f, 'utf8');
      const j = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
      for (const [n, s] of Object.entries(j.mcp || {})) out.opencode[n] = fromOpencode(s);
    }
  } catch (e) { errors.opencode = e.message; }
  return { servers: out, errors };
}

/** Сводный список: имя → { spec, agents: {claude: true, ...} } */
function listMcp(saved = {}) {
  const { servers, errors } = readMcp();
  const map = {};
  for (const a of AGENTS) {
    for (const [name, spec] of Object.entries(servers[a])) {
      if (!spec) continue;
      const row = map[name] = map[name] || { name, spec, agents: {} };
      row.agents[a] = spec.enabled === false ? 'off' : true;
      if (!row.spec.command && !row.spec.url) row.spec = spec;
    }
  }
  // серверы, которые сейчас нигде не включены, но сохранены в Synapse
  for (const [name, spec] of Object.entries(saved)) if (!map[name]) map[name] = { name, spec, agents: {}, parked: true };
  return { list: Object.values(map).sort((a, b) => a.name.localeCompare(b.name)), errors };
}

function validSpec(spec) {
  if (!spec || (spec.type !== 'stdio' && spec.type !== 'http')) throw new Error(t('Неверное описание сервера'));
  if (spec.type === 'stdio' && !String(spec.command || '').trim()) throw new Error(t('Укажите команду запуска'));
  if (spec.type === 'http' && !/^https?:\/\//i.test(spec.url || '')) throw new Error(t('Укажите адрес сервера (https://…)'));
}

async function addMcp(agent, name, spec, ctx) {
  if (!NAME_RE.test(name)) throw new Error(t('Имя сервера: латиница, цифры, точка, дефис, подчёркивание'));
  validSpec(spec);
  const env = spec.env || {}, headers = spec.headers || {};
  if (agent === 'claude') {
    const bin = ctx.bin('claude');
    const args = spec.type === 'http'
      ? ['mcp', 'add', '--transport', spec.sse ? 'sse' : 'http', '--scope', 'user', ...Object.entries(headers).flatMap(([k, v]) => ['--header', `${k}: ${v}`]), name, spec.url]
      : ['mcp', 'add', '--scope', 'user', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), name, '--', spec.command, ...(spec.args || [])];
    await runCli(bin, ['mcp', 'remove', name, '--scope', 'user'], { env: ctx.env, timeout: 30000 }); // замена существующего
    const r = await runCli(bin, args, { env: ctx.env, timeout: 60000 });
    if (r.code !== 0) throw new Error(t('Claude Code: {m}', { m: (r.err || r.out).trim().split('\n').pop() || t('ошибка') }));
    return;
  }
  if (agent === 'codex') {
    const f = P.codexToml();
    let text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    text = tomlRemoveTable(text, ['mcp_servers', name]);
    const lines = [`[mcp_servers.${tkey(name)}]`];
    if (spec.type === 'http') {
      lines.push(`url = ${tq(spec.url)}`);
      if (Object.keys(headers).length) lines.push(`http_headers = ${tInline(headers)}`);
      if (spec.bearerEnv) lines.push(`bearer_token_env_var = ${tq(spec.bearerEnv)}`);
    } else {
      lines.push(`command = ${tq(spec.command)}`);
      if (spec.args?.length) lines.push(`args = [${spec.args.map(tq).join(', ')}]`);
      if (Object.keys(env).length) lines.push(`env = ${tInline(env)}`);
    }
    writeAtomic(f, `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${lines.join('\n')}\n`);
    return;
  }
  if (agent === 'gemini-cli') {
    const f = P.geminiSettings();
    const j = readJson(f, {});
    j.mcpServers = j.mcpServers || {};
    j.mcpServers[name] = spec.type === 'http'
      ? { [spec.sse ? 'url' : 'httpUrl']: spec.url, ...(Object.keys(headers).length ? { headers } : {}) }
      : { command: spec.command, args: spec.args || [], ...(Object.keys(env).length ? { env } : {}) };
    writeJson(f, j);
    return;
  }
  if (agent === 'opencode') {
    const f = P.opencodeJson();
    const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (raw && hasComments(raw)) throw new Error(t('В {f} есть комментарии — добавьте сервер вручную, чтобы их не потерять', { f }));
    const j = raw ? JSON.parse(raw) : { $schema: 'https://opencode.ai/config.json' };
    j.mcp = j.mcp || {};
    j.mcp[name] = spec.type === 'http'
      ? { type: 'remote', url: spec.url, enabled: true, ...(Object.keys(headers).length ? { headers } : {}) }
      : { type: 'local', command: [spec.command, ...(spec.args || [])], enabled: true, ...(Object.keys(env).length ? { environment: env } : {}) };
    writeJson(f, j);
    return;
  }
  throw new Error(t('Неизвестный агент {a}', { a: agent }));
}

async function removeMcp(agent, name, ctx) {
  if (agent === 'claude') {
    const r = await runCli(ctx.bin('claude'), ['mcp', 'remove', name, '--scope', 'user'], { env: ctx.env, timeout: 30000 });
    if (r.code !== 0) {
      // запасной путь: убрать из ~/.claude.json напрямую
      const f = P.claudeJson();
      const j = readJson(f, null);
      if (j?.mcpServers?.[name]) { delete j.mcpServers[name]; writeJson(f, j); return; }
      throw new Error(t('Claude Code: {m}', { m: (r.err || r.out).trim().split('\n').pop() || t('ошибка') }));
    }
    return;
  }
  if (agent === 'codex') {
    const f = P.codexToml();
    if (fs.existsSync(f)) writeAtomic(f, tomlRemoveTable(fs.readFileSync(f, 'utf8'), ['mcp_servers', name]));
    return;
  }
  if (agent === 'gemini-cli') {
    const f = P.geminiSettings();
    const j = readJson(f, null);
    if (j?.mcpServers?.[name]) { delete j.mcpServers[name]; writeJson(f, j); }
    return;
  }
  if (agent === 'opencode') {
    const f = P.opencodeJson();
    if (!fs.existsSync(f)) return;
    const raw = fs.readFileSync(f, 'utf8');
    if (hasComments(raw)) throw new Error(t('В {f} есть комментарии — удалите сервер вручную, чтобы их не потерять', { f }));
    const j = JSON.parse(raw);
    if (j.mcp?.[name]) { delete j.mcp[name]; writeJson(f, j); }
  }
}

// Вход в удалённый сервер (OAuth) — в отдельном окне терминала
function loginMcp(agent, name, ctx) {
  const map = { claude: ['mcp', 'login', name], codex: ['mcp', 'login', name], opencode: ['mcp', 'auth', name] };
  if (!map[agent]) throw new Error(t('Gemini CLI входит в сервер сам при первом использовании (команда /mcp auth в сессии).'));
  openTerminal(ctx.bin(agent), map[agent], ctx.env);
}

// Проверка MCP-сервера: initialize + tools/list (stdio — запуск процесса, http — POST)
async function testMcp(spec, ctx) {
  validSpec(spec);
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synapse', version: '1' } } };
  if (spec.type === 'http') {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(spec.headers || {}) };
    const res = await ctx.fetch(spec.url, { method: 'POST', headers, body: JSON.stringify(init) });
    if (res.status === 401 || res.status === 403) return { ok: true, auth: true, note: t('Сервер отвечает и просит вход (OAuth) — нажмите «Войти» у нужного агента.') };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.text();
    const m = /"serverInfo"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(body);
    return { ok: true, note: m ? t('Сервер «{n}» отвечает', { n: m[1] }) : t('Сервер отвечает') };
  }
  return new Promise((resolve) => {
    const viaShell = IS_WIN;
    let child;
    try { child = spawn(spec.command, viaShell ? (spec.args || []).map(winQuote) : (spec.args || []), { shell: viaShell, windowsHide: true, env: { ...process.env, ...(ctx.env || {}), ...(spec.env || {}) } }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '', err = '', done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: t('Сервер не ответил за 40 секунд') + (err ? `: ${err.trim().split('\n').pop()}` : '') }), 40000);
    child.on('error', (e) => finish({ ok: false, error: e.code === 'ENOENT' ? t('Команда не найдена: {c}', { c: spec.command }) : e.message }));
    child.on('exit', (c) => finish({ ok: false, error: (err.trim().split('\n').pop() || t('Процесс завершился с кодом {code}', { code: c })) }));
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        } else if (j.id === 2) {
          const tools = (j.result?.tools || []).map(x => x.name);
          finish({ ok: true, tools, note: t('Инструментов: {n}', { n: tools.length }) });
        }
      }
    });
    child.stdin.write(JSON.stringify(init) + '\n');
  });
}

// ================= Коннекторы (готовые удалённые MCP-серверы) =================
// Адреса сверены с официальным реестром MCP (registry.modelcontextprotocol.io) и документацией сервисов.
const CONNECTORS = [
  { id: 'github', name: 'GitHub', domain: 'github.com', spec: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: {} }, auth: 'token', tokenHeader: 'Authorization', tokenPrefix: 'Bearer ', tokenHint: 'GitHub → Settings → Developer settings → Personal access tokens', desc: 'Репозитории, issues, pull requests, Actions' },
  { id: 'notion', name: 'Notion', domain: 'notion.so', spec: { type: 'http', url: 'https://mcp.notion.com/mcp' }, auth: 'oauth', desc: 'Страницы, базы данных, поиск по рабочему пространству' },
  { id: 'linear', name: 'Linear', domain: 'linear.app', spec: { type: 'http', url: 'https://mcp.linear.app/mcp' }, auth: 'oauth', desc: 'Задачи, проекты, циклы' },
  { id: 'figma', name: 'Figma', domain: 'figma.com', spec: { type: 'http', url: 'https://mcp.figma.com/mcp' }, auth: 'oauth', desc: 'Макеты, компоненты и переменные для вёрстки по дизайну' },
  { id: 'atlassian', name: 'Jira и Confluence', domain: 'atlassian.com', spec: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' }, auth: 'oauth', desc: 'Задачи Jira и страницы Confluence' },
  { id: 'sentry', name: 'Sentry', domain: 'sentry.io', spec: { type: 'http', url: 'https://mcp.sentry.dev/mcp' }, auth: 'oauth', desc: 'Ошибки и трассировки из продакшена' },
  { id: 'stripe', name: 'Stripe', domain: 'stripe.com', spec: { type: 'http', url: 'https://mcp.stripe.com' }, auth: 'oauth', desc: 'Платежи, клиенты, подписки' },
  { id: 'supabase', name: 'Supabase', domain: 'supabase.com', spec: { type: 'http', url: 'https://mcp.supabase.com/mcp' }, auth: 'oauth', desc: 'Базы данных, таблицы, миграции, функции' },
  { id: 'context7', name: 'Context7', domain: 'context7.com', spec: { type: 'http', url: 'https://mcp.context7.com/mcp' }, auth: 'none', desc: 'Свежая документация библиотек прямо в контекст' },
  { id: 'huggingface', name: 'Hugging Face', domain: 'huggingface.co', spec: { type: 'http', url: 'https://huggingface.co/mcp' }, auth: 'none', desc: 'Модели, датасеты, Spaces' },
  { id: 'playwright', name: 'Playwright', domain: 'playwright.dev', spec: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }, auth: 'none', local: true, desc: 'Управление браузером: открыть сайт, кликнуть, сделать снимок' },
  { id: 'chrome-devtools', name: 'Chrome DevTools', domain: 'developer.chrome.com', spec: { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }, auth: 'none', local: true, desc: 'Отладка страниц: консоль, сеть, производительность' },
  { id: 'filesystem', name: 'Файлы', domain: 'modelcontextprotocol.io', spec: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }, auth: 'none', local: true, needsPath: true, desc: 'Доступ к выбранной папке на компьютере' },
];

// ================= Реестр MCP (маркетплейс серверов) =================
const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
async function searchRegistry(query, cursor, ctx) {
  const u = new URL(REGISTRY);
  u.searchParams.set('limit', '60');
  if (query) u.searchParams.set('search', query);
  if (cursor) u.searchParams.set('cursor', cursor);
  const res = await ctx.fetch(u.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(t('Реестр MCP ответил {s}', { s: res.status }));
  const j = await res.json();
  const items = [];
  for (const e of j.servers || []) {
    const s = e.server || e;
    const meta = e._meta?.['io.modelcontextprotocol.registry/official'] || {};
    if (meta.isLatest === false || meta.status === 'deleted' || meta.status === 'deprecated') continue;
    if (items.some(x => x.id === s.name)) continue;
    items.push({
      id: s.name, title: s.title || s.name.split('/').pop(), description: s.description || '', version: s.version || '',
      repo: s.repository?.url || null, website: s.websiteUrl || null,
      remotes: (s.remotes || []).filter(r => r.type === 'streamable-http' || r.type === 'sse').map(r => ({ type: r.type, url: r.url, headers: (r.headers || []).map(h => ({ name: h.name, required: !!h.isRequired, secret: !!h.isSecret, description: h.description || '' })) })),
      packages: (s.packages || []).filter(p => ['npm', 'pypi', 'oci'].includes(p.registryType)).map(p => ({ registryType: p.registryType, identifier: p.identifier, version: p.version || '',
        env: (p.environmentVariables || []).map(v => ({ name: v.name, required: !!v.isRequired, secret: !!v.isSecret, description: v.description || '' })) })),
    });
  }
  return { items, next: j.metadata?.nextCursor || null };
}
/** Описание из реестра → наш формат сервера (удалённый, если есть; иначе пакет) */
function specFromRegistry(item, choice = {}) {
  const r = item.remotes?.[choice.remote ?? 0];
  if (r && choice.kind !== 'package') return { type: 'http', url: r.url, sse: r.type === 'sse', headers: choice.headers || {} };
  const p = item.packages?.[choice.package ?? 0];
  if (!p) throw new Error(t('У этого сервера нет способа запуска, который поддерживает Synapse'));
  const env = choice.env || {};
  if (p.registryType === 'npm') return { type: 'stdio', command: 'npx', args: ['-y', p.version ? `${p.identifier}@${p.version}` : p.identifier], env };
  if (p.registryType === 'pypi') return { type: 'stdio', command: 'uvx', args: [p.version ? `${p.identifier}==${p.version}` : p.identifier], env };
  return { type: 'stdio', command: 'docker', args: ['run', '-i', '--rm', ...Object.keys(env).flatMap(k => ['-e', k]), p.identifier], env };
}

// ================= Скиллы =================
// Где агенты ищут личные скиллы. Один и тот же формат SKILL.md у всех.
const SKILL_ROOTS = () => [
  { id: 'claude', dir: P.claudeSkills(), label: '~/.claude/skills', seenBy: ['claude', 'opencode'] },
  { id: 'agents', dir: P.agentsSkills(), label: '~/.agents/skills', seenBy: ['codex', 'gemini-cli', 'opencode'] },
  { id: 'gemini', dir: P.geminiSkills(), label: '~/.gemini/skills', seenBy: ['gemini-cli'] },
  { id: 'opencode', dir: P.opencodeSkills(), label: '~/.config/opencode/skills', seenBy: ['opencode'] },
];
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text, extra: '' };
  const meta = {}; const extra = [];
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) { extra.push(lines[i]); continue; }
    let v = kv[2].trim();
    if (v === '>' || v === '|' || v === '>-' || v === '|-') { // многострочное значение
      const parts = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(v.startsWith('>') ? ' ' : '\n');
    } else v = v.replace(/^(['"])(.*)\1$/, '$2');
    if (kv[1] === 'name' || kv[1] === 'description') meta[kv[1]] = v;
    else extra.push(lines[i]);
  }
  return { meta, body: m[2].replace(/^\r?\n/, ''), extra: extra.join('\n') };
}
const yamlStr = (s) => (/[:#'"\n]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);
function buildSkill({ name, description, body, extra }) {
  return `---\nname: ${name}\ndescription: ${yamlStr(String(description).replace(/\s+/g, ' ').trim())}\n${extra ? extra.trim() + '\n' : ''}---\n\n${String(body || '').trim()}\n`;
}
function listSkills(projectDir) {
  const roots = SKILL_ROOTS();
  if (projectDir) {
    roots.push({ id: 'project-claude', dir: path.join(projectDir, '.claude', 'skills'), label: '.claude/skills', seenBy: ['claude', 'opencode'], project: true });
    roots.push({ id: 'project-agents', dir: path.join(projectDir, '.agents', 'skills'), label: '.agents/skills', seenBy: ['codex', 'gemini-cli', 'opencode'], project: true });
  }
  const out = [];
  for (const r of roots) {
    let entries = [];
    try { entries = fs.readdirSync(r.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const dir = path.join(r.dir, e.name);
      const f = path.join(dir, 'SKILL.md');
      let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const { meta } = parseSkill(text);
      let files = 0; try { files = fs.readdirSync(dir).length; } catch { /* */ }
      out.push({ name: meta.name || e.name, folder: e.name, description: meta.description || '', dir, root: r.id, rootLabel: r.label, seenBy: r.seenBy, project: !!r.project, files });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function rootDir(id, projectDir) {
  const r = SKILL_ROOTS().find(x => x.id === id);
  if (r) return r.dir;
  if (id === 'project-claude' && projectDir) return path.join(projectDir, '.claude', 'skills');
  if (id === 'project-agents' && projectDir) return path.join(projectDir, '.agents', 'skills');
  throw new Error(t('Неизвестная папка скиллов'));
}
// путь должен лежать внутри одной из папок скиллов
function assertSkillDir(dir, projectDir) {
  const roots = [...SKILL_ROOTS().map(r => r.dir), ...(projectDir ? [path.join(projectDir, '.claude', 'skills'), path.join(projectDir, '.agents', 'skills')] : [])];
  const abs = path.resolve(dir);
  if (!roots.some(r => abs.startsWith(path.resolve(r) + path.sep))) throw new Error(t('Это не папка скилла'));
  return abs;
}
function readSkill(dir, projectDir) {
  const abs = assertSkillDir(dir, projectDir);
  const { meta, body, extra } = parseSkill(fs.readFileSync(path.join(abs, 'SKILL.md'), 'utf8'));
  let files = []; try { files = fs.readdirSync(abs, { withFileTypes: true }).map(e => (e.isDirectory() ? e.name + '/' : e.name)); } catch { /* */ }
  return { name: meta.name || path.basename(abs), description: meta.description || '', body, extra, dir: abs, files };
}
function saveSkill({ name, description, body, roots = ['claude'], dir, projectDir }) {
  if (!SKILL_NAME.test(name || '') || name.length > 64) throw new Error(t('Имя скилла: строчные латинские буквы, цифры и дефисы, до 64 символов'));
  if (!String(description || '').trim()) throw new Error(t('Добавьте описание — по нему агент решает, когда применять скилл'));
  if (String(description).length > 1024) throw new Error(t('Описание длиннее 1024 символов'));
  const written = [];
  if (dir) { // правка существующего
    const abs = assertSkillDir(dir, projectDir);
    const prev = parseSkill(fs.readFileSync(path.join(abs, 'SKILL.md'), 'utf8'));
    let target = abs;
    if (path.basename(abs) !== name) { // переименование: имя должно совпадать с папкой
      target = path.join(path.dirname(abs), name);
      if (fs.existsSync(target)) throw new Error(t('Скилл «{n}» уже есть', { n: name }));
      fs.renameSync(abs, target);
    }
    fs.writeFileSync(path.join(target, 'SKILL.md'), buildSkill({ name, description, body, extra: prev.extra }), 'utf8');
    return [target];
  }
  for (const id of roots) {
    const target = path.join(rootDir(id, projectDir), name);
    if (fs.existsSync(path.join(target, 'SKILL.md'))) throw new Error(t('Скилл «{n}» уже есть в {r}', { n: name, r: id }));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), buildSkill({ name, description, body }), 'utf8');
    written.push(target);
  }
  return written;
}
function removeSkill(dir, projectDir) {
  const abs = assertSkillDir(dir, projectDir);
  fs.rmSync(abs, { recursive: true, force: true });
}
function copySkill(dir, rootId, projectDir) {
  const src = assertSkillDir(dir, projectDir);
  const target = path.join(rootDir(rootId, projectDir), path.basename(src));
  if (fs.existsSync(target)) throw new Error(t('Там уже есть скилл с таким именем'));
  fs.cpSync(src, target, { recursive: true });
  return target;
}
function importSkill(folder, rootIds, projectDir) {
  const f = path.join(folder, 'SKILL.md');
  if (!fs.existsSync(f)) throw new Error(t('В папке нет SKILL.md'));
  const { meta } = parseSkill(fs.readFileSync(f, 'utf8'));
  const name = meta.name || path.basename(folder);
  if (!SKILL_NAME.test(name)) throw new Error(t('Имя скилла «{n}» не подходит: строчные латинские буквы, цифры и дефисы', { n: name }));
  const out = [];
  for (const id of rootIds) {
    const target = path.join(rootDir(id, projectDir), name);
    if (fs.existsSync(target)) throw new Error(t('Скилл «{n}» уже есть в {r}', { n: name, r: id }));
    fs.cpSync(folder, target, { recursive: true });
    out.push(target);
  }
  return out;
}

// ================= Плагины =================
// Claude Code: всё через `claude plugin … --json`
async function claudePlugins(ctx) {
  const bin = ctx.bin('claude');
  const [pl, mk] = await Promise.all([
    runCli(bin, ['plugin', 'list', '--json', '--available'], { env: ctx.env, timeout: 90000 }),
    runCli(bin, ['plugin', 'marketplace', 'list', '--json'], { env: ctx.env, timeout: 60000 }),
  ]);
  const plj = firstJson(pl.out);
  const mkj = firstJson(mk.out);
  if (pl.code !== 0 && !plj) return { ok: false, error: (pl.err || pl.out).trim().split('\n').pop() || t('Claude Code недоступен') };
  const installed = Array.isArray(plj) ? plj : (plj?.installed || []);
  return {
    ok: true,
    installed: installed.map(p => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, path: p.installPath, errors: p.errors || [], notes: p.notes || [], mcp: Object.keys(p.mcpServers || {}) })),
    available: (plj?.available || []).map(p => ({ id: p.pluginId, name: p.name, marketplace: p.marketplaceName, description: p.description || '', version: p.version || '', installs: p.installCount || null })),
    marketplaces: Array.isArray(mkj) ? mkj.map(m => ({ name: m.name, source: m.source, repo: m.repo || m.url || m.path || '', status: m.status || null })) : [],
  };
}
const PLUGIN_ID = /^[\w.@-]+$/;
async function claudePluginAction(action, id, ctx, opts = {}) {
  if (!PLUGIN_ID.test(id || '')) throw new Error(t('Неверный идентификатор плагина'));
  const args = ['plugin', action, id, '--json'];
  if (action === 'install') args.push('--scope', 'user');
  if (opts.accept && /^[a-f0-9]{64}$/i.test(opts.accept)) args.push('--accept-command', opts.accept);
  const r = await runCli(ctx.bin('claude'), args, { env: ctx.env, timeout: 300000 });
  const j = lastJsonLine(r.out);
  if (j?.outcome === 'ok') return { ok: true, message: j.message };
  if (j?.shownCommand) return { ok: false, needAccept: { command: j.shownCommand.command || j.shownCommand.displayed || JSON.stringify(j.shownCommand), sha256: j.shownCommand.sha256 }, message: j.message };
  return { ok: false, message: j?.message || (r.err || r.out).trim().split('\n').pop() || t('ошибка') };
}
const MARKET_SRC = /^([\w.-]+\/[\w.-]+([#@][\w./-]+)?|https?:\/\/\S+|[A-Za-z]:\\\S+|[~.\/]\S*)$/;
async function claudeMarketplace(action, arg, ctx) {
  const args = ['plugin', 'marketplace', action];
  if (action === 'add') { if (!MARKET_SRC.test(arg || '')) throw new Error(t('Укажите owner/repo, ссылку или путь к папке')); args.push(arg); }
  else if (arg) { if (!/^[\w.-]+$/.test(arg)) throw new Error(t('Неверное имя маркетплейса')); args.push(arg); }
  const r = await runCli(ctx.bin('claude'), args, { env: ctx.env, timeout: 300000 });
  if (r.code !== 0) throw new Error((r.err || r.out).trim().split('\n').pop() || t('ошибка'));
  return { ok: true, message: (r.out || '').trim().split('\n').pop() };
}
// Популярные маркетплейсы Anthropic (официальный Claude Code добавляет сам)
const MARKETS = [
  { source: 'anthropics/claude-plugins-official', name: 'claude-plugins-official', desc: 'Официальный: плагины Anthropic и партнёров' },
  { source: 'anthropics/claude-plugins-community', name: 'claude-community', desc: 'Сообщество: плагины сторонних авторов, присланные в Anthropic' },
  { source: 'anthropics/skills', name: 'anthropic-agent-skills', desc: 'Скиллы Anthropic: документы, таблицы, презентации, дизайн' },
  { source: 'anthropics/knowledge-work-plugins', name: 'knowledge-work-plugins', desc: 'Плагины для работы с текстами и знаниями' },
];

// Codex: установленные плагины лежат в кэше, включение — в config.toml [plugins."id"]
function codexPlugins() {
  const root = P.codexPlugins();
  const out = [];
  let conf = {};
  try { conf = parseToml(fs.readFileSync(P.codexToml(), 'utf8')).plugins || {}; } catch { /* */ }
  let markets = [];
  try { markets = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return out; }
  for (const mp of markets) {
    let plugins = [];
    try { plugins = fs.readdirSync(path.join(root, mp), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { continue; }
    for (const name of plugins) {
      const id = `${name}@${mp}`;
      let manifest = {};
      try {
        const vers = fs.readdirSync(path.join(root, mp, name));
        for (const v of vers) { const f = path.join(root, mp, name, v, '.codex-plugin', 'plugin.json'); if (fs.existsSync(f)) { manifest = JSON.parse(fs.readFileSync(f, 'utf8')); break; } }
      } catch { /* */ }
      out.push({ id, name: manifest.name || name, description: manifest.description || '', version: manifest.version || '', enabled: conf[id]?.enabled !== false });
    }
  }
  return out;
}
function codexPluginToggle(id, enabled) {
  if (!PLUGIN_ID.test(id)) throw new Error(t('Неверный идентификатор плагина'));
  const f = P.codexToml();
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  writeAtomic(f, tomlSetKey(text, ['plugins', id], 'enabled', enabled ? 'true' : 'false'));
}
// Gemini CLI: расширения — папки с gemini-extension.json
function geminiExtensions() {
  const root = P.geminiExt();
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return out; }
  for (const d of dirs) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, d, 'gemini-extension.json'), 'utf8'));
      out.push({ id: j.name || d, name: j.name || d, version: j.version || '', description: j.description || '', mcp: Object.keys(j.mcpServers || {}), dir: path.join(root, d) });
    } catch { /* не расширение */ }
  }
  return out;
}

module.exports = {
  P, AGENTS, CONNECTORS, MARKETS,
  listMcp, addMcp, removeMcp, loginMcp, testMcp,
  searchRegistry, specFromRegistry,
  listSkills, readSkill, saveSkill, removeSkill, copySkill, importSkill, SKILL_ROOTS,
  claudePlugins, claudePluginAction, claudeMarketplace, codexPlugins, codexPluginToggle, geminiExtensions,
  parseToml, tomlRemoveTable, tomlSetKey, parseSkill, buildSkill, runCli,
};
