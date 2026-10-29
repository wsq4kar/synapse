const { t } = require('../i18n');
// Запуск официальных CLI-агентов (Claude Code, Codex, Antigravity CLI, OpenCode) на этом компьютере.
// Приложение только ставит задачу и читает вывод — работают сами CLI под вашим входом.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
// Путь к CLI: буквы любых языков, цифры, пробелы, скобки — но без символов оболочки (& | < > ^ " % ! ;)
const SAFE_ARG = /^[\p{L}\p{N}_.\-:\/\\ ()~+@]+$/u;
const BINS = { claude: 'claude', codex: 'codex', antigravity: 'agy', opencode: 'opencode' };

// Где обычно лежат CLI на Windows / macOS / Linux
function candidates(id) {
  const name = BINS[id];
  const home = os.homedir();
  if (IS_WIN) {
    const ad = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const lad = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(home, '.local', 'bin', `${name}.exe`),
      path.join(home, `.${name}`, 'bin', `${name}.exe`),
      path.join(ad, 'npm', `${name}.cmd`),
      path.join(lad, 'Programs', name, `${name}.exe`),
      path.join(lad, name, 'bin', `${name}.exe`), // Antigravity CLI: %LOCALAPPDATA%\agy\bin\agy.exe
      path.join(lad, 'pnpm', `${name}.cmd`),
      path.join(home, 'scoop', 'shims', `${name}.exe`),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', `${name}.cmd`),
    ];
  }
  return [
    path.join(home, '.local', 'bin', name), path.join(home, `.${name}`, 'bin', name), path.join(home, '.npm-global', 'bin', name),
    '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name, path.join(home, '.bun', 'bin', name),
  ];
}

// Пользователь мог указать папку — ищем в ней исполняемый файл
function normalizeUserPath(id, p) {
  if (!p) return '';
  p = p.trim().replace(/^"(.*)"$/, '$1');
  if (p === BINS[id] || p === id) return ''; // просто имя команды = автопоиск
  try {
    if (fs.statSync(p).isDirectory()) {
      const name = BINS[id];
      const hit = (IS_WIN ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name]).map(f => path.join(p, f)).find(f => fs.existsSync(f));
      if (hit) return hit;
    }
  } catch { /* нет такого пути */ }
  return p;
}

// Какую команду запускать: путь из настроек → найденный в стандартных местах → имя в PATH
function binFor(id, paths = {}) {
  const user = normalizeUserPath(id, paths[id]);
  if (user) return user;
  return candidates(id).find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || BINS[id];
}

// cmd.exe (shell:true) склеивает аргументы через пробел — берём в кавычки те, где есть пробелы
function winQuote(a) { return /[\s"]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a; }

// Для shell:true на Windows путь с пробелами нужно взять в кавычки
function shellBin(bin) { return IS_WIN && /\s/.test(bin) ? `"${bin}"` : bin; }

// Полный путь к команде из PATH (where / which)
function whichSync(bin) {
  if (/[\\/]/.test(bin)) return bin;
  try {
    const out = require('child_process').execFileSync(IS_WIN ? 'where' : 'which', [bin], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort((a, b) => (/\.(cmd|exe)$/i.test(b) ? 1 : 0) - (/\.(cmd|exe)$/i.test(a) ? 1 : 0))[0] || null;
  } catch { return null; }
}

const LABELS = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode' };
// Агенты, которые умеют продолжать свою сессию — им не нужно заново пересылать историю чата
const RESUMABLE = new Set(['claude', 'codex', 'antigravity', 'opencode']);

// ---------- описание запуска каждого CLI ----------
const MODEL_ARG = /^~?[\w.\-:]+(\/~?[\w.\-:]+){0,2}$/; // OpenCode: provider/model, openrouter/vendor/model
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Ultra = максимум; иначе — выбранный уровень (auto = настройка самого CLI)
function effortOf(effort, ultra) { return ultra ? 'max' : (EFFORTS.includes(effort) ? effort : null); }
const CODEX_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
// OpenCode: --variant зависит от провайдера; передаём только явные «high/max»
const OPENCODE_VARIANT = { high: 'high', xhigh: 'high', max: 'max' };
// Antigravity: low | medium | high | max (max есть не у всех моделей — тогда флаг уберётся при повторе)
const AGY_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'max' };
const SESSION_RE = /^[\w.:-]+$/;

function buildCommand(id, { access, sessionId, lastMessageFile, ultra, model, effort, memoryFile, allowTools }) {
  const m = model && MODEL_ARG.test(model) ? model : null;
  const ef = effortOf(effort, ultra);
  switch (id) {
    case 'claude': {
      const args = ['-p', '--output-format', 'stream-json', '--verbose',
        // текст по кусочкам + краткий пересказ рассуждений модели
        '--include-partial-messages', '--thinking-display', 'summarized',
        // read — «Режим плана»: в -p без разрешений правки и команды отклоняются, чтение работает
        '--permission-mode', access === 'full' ? 'bypassPermissions' : access === 'read' ? 'default' : 'acceptEdits'];
      if (sessionId && /^[\w-]+$/.test(sessionId)) args.push('--resume', sessionId);
      if (m) args.push('--model', m);
      if (ef) args.push('--effort', ef);
      // «Обо мне» из Synapse — дополнением к системному промпту (файлом: без проблем с кавычками и длиной)
      if (memoryFile) args.push('--append-system-prompt-file', memoryFile);
      // В режиме «Правки файлов» разрешаем скиллы и инструменты подключённых коннекторов/MCP без подтверждения
      if (access !== 'full' && allowTools?.length) args.push('--allowedTools', allowTools.join(','));
      return { args, parser: 'claude' };
    }
    case 'codex': {
      const args = ['exec', '--json', '--skip-git-repo-check',
        ...(access === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', access === 'read' ? 'read-only' : 'workspace-write']),
        ...(ef ? ['-c', `model_reasoning_effort=${CODEX_EFFORT[ef]}`] : []),
        '-c', 'model_reasoning_summary=auto', // рассуждения модели в выводе
        ...(m ? ['-m', m] : []),
        '--output-last-message', lastMessageFile,
        // продолжение прошлой сессии: история и кэш остаются у Codex, заново ничего не пересылаем
        ...(sessionId && SESSION_RE.test(sessionId) ? ['resume', sessionId] : []),
        '-'];
      return { args, parser: 'codex' };
    }
    case 'antigravity': {
      // Antigravity CLI (agy): задача приходит через stdin одним сообщением stream-json, ответ — поток событий NDJSON.
      // Так не нужно передавать длинный текст в командной строке (cmd.exe ломает кавычки и переносы).
      const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
      if (access === 'full') args.push('--dangerously-skip-permissions');
      else args.push('--mode', access === 'read' ? 'plan' : 'accept-edits');
      if (sessionId && SESSION_RE.test(sessionId)) args.push('--conversation', sessionId);
      if (m) args.push('--model', m);
      if (ef && AGY_EFFORT[ef]) args.push('--effort', AGY_EFFORT[ef]);
      const stdin = (prompt) => JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
      return { args, parser: 'antigravity', stdin };
    }
    case 'opencode': {
      // задача приходит через stdin; --format json — поток событий; --thinking — рассуждения
      const args = ['run', '--format', 'json', '--thinking'];
      if (access === 'full') args.push('--auto');
      if (access === 'read') args.push('--agent', 'plan'); // встроенный агент OpenCode, который не меняет файлы
      if (sessionId && /^[\w-]+$/.test(sessionId)) args.push('--session', sessionId);
      if (m) args.push('--model', m);
      if (ef && OPENCODE_VARIANT[ef]) args.push('--variant', OPENCODE_VARIANT[ef]);
      return { args, parser: 'opencode' };
    }
    default: throw new Error(t('Неизвестный исполнитель {id}', { id }));
  }
}

// ---------- проверка установленных CLI ----------
const AUTH = {
  claude: { args: ['auth', 'status', '--json'], parse: (e, out) => { const j = JSON.parse(out.slice(out.indexOf('{'))); return !!j.loggedIn; } },
  codex: { args: ['login', 'status'], parse: (e, out) => (e ? (/not logged in/i.test(out) ? false : null) : !/not logged in/i.test(out)) },
};
// Antigravity: «agy models» работает только после входа — заодно узнаём доступные модели
function parseAgyModels(out) {
  const list = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^\s*([a-z][\w.\-:]*\d[\w.\-:]*)(?:\s+|$)/i.exec(line);
    if (m && /-/.test(m[1]) && !list.includes(m[1])) list.push(m[1]);
  }
  return list;
}
AUTH.antigravity = {
  args: ['models'],
  parse: (e, out) => {
    if (/not (currently )?signed in|authentication required|please (log|sign) ?in|unauthenticated/i.test(out)) return false;
    const models = parseAgyModels(out);
    return models.length ? { loggedIn: true, models } : (e ? null : true);
  },
};
const LOGIN = { claude: ['auth', 'login'], codex: ['login'], antigravity: [], opencode: ['auth', 'login'] };

// Открыть системный терминал с командой входа — пользователь входит сам, в своём браузере
function openLogin(id, paths = {}, extraEnv = null) {
  const bin = binFor(id, paths);
  if (!SAFE_ARG.test(bin)) throw new Error(t('Недопустимые символы в пути'));
  const cmd = [IS_WIN && /\s/.test(bin) ? `"${bin}"` : bin, ...LOGIN[id]].join(' ');
  if (IS_WIN) spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', cmd], { detached: true, windowsHide: false, env: envForAgent(id, { ...cleanEnv(), ...(extraEnv || {}) }) }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmd}"`], { detached: true }).unref();
  else spawn('x-terminal-emulator', ['-e', cmd], { detached: true }).unref();
}

function detect(paths = {}) {
  const ids = Object.keys(LABELS);
  return Promise.all(ids.map(id => new Promise(resolve => {
    const bin = binFor(id, paths);
    const base = { id, label: LABELS[id], custom: !!paths[id], bin };
    if (!SAFE_ARG.test(bin)) return resolve({ ...base, installed: false, version: null, error: t('Недопустимые символы в пути') });
    const opts = { timeout: 15000, shell: IS_WIN, windowsHide: true, env: envForAgent(id, cleanEnv()) };
    execFile(shellBin(bin), ['--version'], opts, (err, stdout, stderr) => {
      const v = (stdout || stderr || '').trim().split('\n')[0];
      const ok = !err && !!v;
      const done = (loggedIn) => resolve({ ...base, installed: ok, version: ok ? v.slice(0, 60) : null, path: ok ? whichSync(bin) : null, loggedIn });
      if (!ok || !AUTH[id]) return done(null);
      // Вход в аккаунт: null — CLI не умеет сообщать
      execFile(shellBin(bin), AUTH[id].args, opts, (e2, out2, err2) => {
        try {
          const r = AUTH[id].parse(e2, String(out2 || '') + String(err2 || ''));
          if (r && typeof r === 'object') resolve({ ...base, installed: true, version: v.slice(0, 60), path: whichSync(bin), loggedIn: r.loggedIn, models: r.models });
          else done(r);
        } catch { done(null); }
      });
    });
  })));
}

// ---------- обход Antigravity (AGUnlocker, github.com/confeden/Antigravity) ----------
// Обход патчит agy: вместо https_proxy он читает AG_LS_PROXY — локальный сервис обхода (http://127.0.0.1:53129).
// Переменную обход пишет в окружение пользователя (Windows) или в ~/.config/environment.d (Linux).
// Если отдать agy ещё и HTTPS_PROXY из настроек Synapse, запросы уйдут мимо обхода, и Google ответит
// 400 «User location is not supported». Поэтому при установленном обходе agy получает только AG_LS_PROXY.
const AGU_VAR = 'AG_LS_PROXY';
const AGU_VALUE = /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d{2,5}\/?$/i;
let aguCache = { at: 0, value: null };
function readRegEnv(name) {
  // Synapse мог быть запущен раньше, чем обход записал переменную, — читаем её прямо из реестра
  for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const out = require('child_process').execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i').exec(out);
      if (m) return m[1].trim();
    } catch { /* нет такой переменной */ }
  }
  return null;
}
function readEnvironmentD(name) {
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'environment.d');
  try {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.conf'))) {
      const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (m) return m[1].trim();
    }
  } catch { /* папки нет */ }
  return null;
}
function unlockerProxy() {
  if (Date.now() - aguCache.at < 20000) return aguCache.value;
  const raw = (IS_WIN ? readRegEnv(AGU_VAR) : readEnvironmentD(AGU_VAR)) || process.env[AGU_VAR] || null;
  aguCache = { at: Date.now(), value: raw && AGU_VALUE.test(raw) ? raw : null };
  return aguCache.value;
}
// Окружение конкретного агента: Antigravity с обходом — без прокси Synapse, с AG_LS_PROXY
function envForAgent(id, env) {
  if (id !== 'antigravity') return env;
  const agu = unlockerProxy();
  if (!agu) return env;
  for (const k of Object.keys(env)) if (/^(https?|all)_proxy$/i.test(k)) delete env[k];
  env[AGU_VAR] = agu;
  return env;
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  env.FORCE_COLOR = '0';
  env.NO_COLOR = '1';
  return env;
}

// ---------- запуск ----------
/**
 * Возвращает промис { ok, text, sessionId, cost, notInstalled, limited, error }.
 * onEvent получает { kind:'step'|'delta'|'text'|'log', ... } по мере работы.
 */
// Если CLI после обновления отвергает какой-то из наших флагов — убираем его и повторяем запуск
async function run(opts, drop = []) {
  const r = await runOnce(opts, drop);
  if (r.ok || r.aborted || drop.length >= 3) return r;
  const errText = (r.error || '') + '\n' + (r.stderr || '');
  const m = /unexpected argument '(-{1,2}[\w-]+)'|unknown (?:option|flag|argument)s?[:\s'"]+(-{1,2}[\w-]+)|unrecogni[sz]ed (?:option|argument|flag)s?[:\s'"]+(-{1,2}[\w-]+)/i.exec(errText);
  let flag = m && (m[1] || m[2] || m[3]);
  // недопустимый уровень рассуждений у этой модели — запускаем без него
  if (!flag && /invalid[^\n]{0,40}(effort|variant)|(effort|variant)[^\n]{0,40}(invalid|not supported|unsupported)/i.test(errText)) flag = /variant/i.test(errText) ? '--variant' : '--effort';
  if (!flag || drop.includes(flag) || ['-', '--', '--json', '--output-last-message', '--input-format', '--output-format'].includes(flag)) return r;
  opts.onEvent?.({ kind: 'step', id: `drop-${flag}`, status: 'done', title: t('Совместимость'), tool: 'other', detail: t('{f} не поддерживается этой версией — запускаю без него', { f: flag }) });
  return run(opts, [...drop, flag]);
}

function runOnce({ id, bin, prompt, cwd, access, sessionId, ultra, model, effort, memoryFile, allowTools, extraEnv, signal, onEvent }, drop = []) {
  return new Promise((resolve) => {
    if (!SAFE_ARG.test(bin)) return resolve({ ok: false, error: t('Небезопасный путь к {name}', { name: LABELS[id] }) });
    fs.mkdirSync(cwd, { recursive: true });
    const lastMessageFile = path.join(os.tmpdir(), `synapse-codex-${Date.now()}.txt`);
    const built = buildCommand(id, { access, sessionId, lastMessageFile, ultra, model, effort, memoryFile, allowTools });
    const VALUE_FLAGS = new Set(['--sandbox', '-s', '--model', '-m', '--config', '-c', '--effort', '--permission-mode', '--approval-mode', '--ask-for-approval', '-a', '--append-system-prompt-file', '--allowedTools', '--thinking-display', '--variant', '--session', '--format', '--agent', '--mode', '--mode', '--conversation']);
    const args = [];
    for (let i = 0; i < built.args.length; i++) {
      const a = built.args[i];
      if (drop.includes(a)) { if (VALUE_FLAGS.has(a)) i++; continue; }
      args.push(a);
    }
    const parser = built.parser;
    // ключ OpenRouter нужен только OpenCode (модели openrouter/…), остальным агентам его не отдаём
    const { OPENROUTER_API_KEY: orKey, ...shared } = extraEnv || {};
    const env = envForAgent(id, { ...cleanEnv(), ...shared, ...(id === 'opencode' && orKey ? { OPENROUTER_API_KEY: orKey } : {}) });
    if (id === 'antigravity' && env[AGU_VAR] && !drop.length) {
      onEvent?.({ kind: 'step', id: 'agy-unlocker', status: 'done', title: t('Обход Antigravity'), tool: 'other', detail: t('Запросы идут через AGUnlocker ({p}), прокси Synapse для agy отключён', { p: env[AGU_VAR] }) });
    }

    let child;
    try {
      child = spawn(shellBin(bin), IS_WIN ? args.map(winQuote) : args, { cwd, shell: IS_WIN, windowsHide: true, env });
    } catch (e) {
      return resolve({ ok: false, notInstalled: true, error: e.message });
    }

    const state = { model: (model && MODEL_ARG.test(model)) ? model : null, text: '', sessionId: null, cost: null, isError: false, finalResult: null, stderr: '', t0: Date.now(), retries: 0 };
    const parse = PARSERS[parser];
    let buf = '';

    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        parse(line, state, onEvent);
      }
      checkNet();
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      state.stderr += s;
      if (state.stderr.length > 20000) state.stderr = state.stderr.slice(-20000);
      if (NET_RE.test(s)) state.netFails = (state.netFails || 0) + 1;
      checkNet();
    });
    // Нет связи: CLI сам будет повторять минутами — прекращаем после двух сетевых ошибок, чтобы сразу перейти к следующему
    function checkNet() {
      if ((state.netFails || 0) >= 2 && !state.netKilled && !state.text) {
        state.netKilled = true;
        killTree(child);
      }
    }

    child.on('error', (e) => {
      resolve({ ok: false, notInstalled: e.code === 'ENOENT', error: e.message });
    });

    const onAbort = () => killTree(child);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (buf) parse(buf, state, onEvent);
      if (parser === 'codex') {
        try { state.finalResult = fs.readFileSync(lastMessageFile, 'utf8').trim() || state.finalResult; } catch { /* нет файла */ }
        fs.rm(lastMessageFile, { force: true }, () => {});
      }
      const err = state.stderr.trim();
      const notInstalled = (IS_WIN && (code === 9009 || /is not recognized|не является внутренней/i.test(err))) || code === 127;
      let text = (state.finalResult || state.text).trim();
      const limited = /usage limit|rate limit|limit reached|quota|5-hour limit|too many requests/i.test(err + ' ' + (state.isError ? text : ''));
      // Google не пускает из региона — объясняем, что делать, вместо голого «400» (только если запуск не удался)
      const failed = state.isError || (code !== 0 && !state.turnDone);
      if (id === 'antigravity' && failed && /location is not supported|not supported in your (country|region)|ineligible/i.test(err + ' ' + (state.isError ? text : ''))) {
        state.isError = true;
        state.finalResult = env[AGU_VAR]
          ? t('Antigravity: Google ответил «регион не поддерживается», хотя обход AGUnlocker найден ({p}). Откройте AGUnlocker и проверьте, что сервис запущен и agy пропатчен (после обновления agy патч нужно применить снова).', { p: env[AGU_VAR] })
          : t('Antigravity: Google не пускает из вашего региона (ошибка 400). Установите обход AGUnlocker (github.com/confeden/Antigravity) или выберите в «Настройки → Сеть» прокси с выходом за рубежом.');
      }
      text = (state.finalResult || state.text).trim();
      const aborted = signal?.aborted;
      const ok = !aborted && !state.netKilled && !state.isError && !!text && (code === 0 || !!state.turnDone);
      resolve({
        ok, text, sessionId: state.sessionId, cost: state.cost, code, aborted, usage: state.usage || null, stderr: err.slice(-2000),
        context: state.ctxUsed ? { used: state.ctxUsed, window: state.ctxWindow || null, compactAt: state.compactAt || null } : null,
        notInstalled, limited,
        netFail: !!state.netKilled,
        error: ok ? null : (aborted ? t('Остановлено')
          : state.netKilled ? t('Нет связи с сервером модели — проверьте прокси или VPN ({e})', { e: (lastLines(err, 1) || state.lastError || 'ECONNREFUSED').slice(0, 160) })
          : (state.isError ? text : '') || lastLines(err) || t('Процесс завершился с кодом {code}', { code })),
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(built.stdin ? built.stdin(prompt) : prompt);
  });
}

function lastLines(s, n = 6) { return s.split('\n').filter(Boolean).slice(-n).join('\n'); }

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

// ---------- разбор вывода ----------
// kind: create | edit | read | run | search | web | plan | other — для сводки «создано N файлов…»
const OC_KIND = { write: 'create', edit: 'edit', patch: 'edit', multiedit: 'edit', read: 'read', bash: 'run', grep: 'search', glob: 'search', list: 'search', webfetch: 'web', websearch: 'web', todowrite: 'plan' };
const TOOL_KIND = { Write: 'create', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read', NotebookRead: 'read',
  Bash: 'run', BashOutput: 'run', Grep: 'search', Glob: 'search', LS: 'search', WebFetch: 'web', WebSearch: 'web', TodoWrite: 'plan', Task: 'other' };
function toolSummary(name, input = {}) {
  const file = input.file_path || input.notebook_path || null;
  const pick = file || input.path || input.command || input.pattern
    || input.url || input.query || input.description || input.prompt || '';
  return { title: name, tool: TOOL_KIND[name] || 'other', path: file, detail: String(pick).replace(/\s+/g, ' ').slice(0, 160) };
}

// Лимиты Codex (primary ≈ 5 часов, secondary ≈ неделя), если CLI их присылает
function codexLimits(rl, emit) {
  const p = require('../codexlimits').parse(rl);
  if (p) emit({ kind: 'limits', provider: 'codex', windows: p.windows, at: Date.now() });
}

// Признаки того, что до сервера модели вообще не достучаться
const NET_RE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|Connection refused|getaddrinfo|socket hang up|Unable to connect|Connection error/i;

const PARSERS = {
  // claude -p --output-format stream-json --verbose
  claude(line, state, emit) {
    if (!line.trim()) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.session_id) state.sessionId = j.session_id;
    if (j.type === 'system' && j.subtype === 'init') {
      if (j.model) state.model = j.model;
      state.tInit = Date.now();
      const mcpTools = (j.tools || []).filter(x => /^mcp__/.test(x));
      emit({ kind: 'agent-env', executor: 'claude', at: Date.now(),
        skills: j.skills || [], plugins: (j.plugins || []).map(x => x.name || x), agents: j.agents || [],
        mcp: (j.mcp_servers || []).map(x => ({ name: x.name, status: x.status })),
        mcpPrefixes: [...new Set(mcpTools.map(x => x.split('__').slice(0, 2).join('__')))],
        model: j.model || null, version: j.claude_code_version || null });
    }
    if (j.type === 'system' && /retry/i.test(j.subtype || '')) {
      state.retries++;
      if (NET_RE.test(JSON.stringify(j.error || '') + ' ' + (j.error_status || ''))) state.netFails = (state.netFails || 0) + 1;
      emit({ kind: 'step', id: `retry-${state.retries}`, status: 'error', title: t('Повтор запроса к Anthropic'), tool: 'other',
        detail: [j.error_status, j.error?.message || j.error, j.attempt ? t('попытка {n}', { n: j.attempt }) : '', j.retry_delay_ms ? t('ждём {s} с', { s: Math.round(j.retry_delay_ms / 1000) }) : ''].filter(Boolean).join(' · ').slice(0, 200) });
    }
    if (!state.tFirst && (j.type === 'assistant' || (j.type === 'stream_event' && j.event?.type === 'content_block_delta'))) state.tFirst = Date.now();
    if (j.type === 'autocompact_state' && j.value?.enabled) state.compactAt = j.value.threshold || null;
    if (j.type === 'rate_limit_event' && j.rate_limit_info) {
      const r = j.rate_limit_info;
      const wins = Object.entries(r.unifiedWindows || {}).map(([id, w]) => ({ id, used: w.utilization, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null }));
      if (!wins.length && r.rateLimitType) wins.push({ id: r.rateLimitType, used: r.utilization ?? null, resetsAt: r.resetsAt ? r.resetsAt * 1000 : null });
      emit({ kind: 'limits', provider: 'claude', status: r.status || null, windows: wins, at: Date.now() });
    }
    // Потоковые кусочки (только основной агент, без субагентов)
    if (j.type === 'stream_event' && !j.parent_tool_use_id) {
      const e = j.event || {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'thinking') {
        if (state.think) state.think += '\n\n';
        state.thinkLive = true;
        emit({ kind: 'thinking', text: state.think || '', start: true }); // модель начала думать — запускаем таймер
      } else if (e.type === 'content_block_delta') {
        const d = e.delta || {};
        if (d.type === 'thinking_delta' && d.thinking) {
          state.think = (state.think || '') + d.thinking; state.sawThinkDelta = true;
          emit({ kind: 'thinking', text: state.think });
        } else if (d.type === 'text_delta' && d.text) {
          state.cur = (state.cur || '') + d.text;
          emit({ kind: 'text', text: (state.text ? state.text + '\n\n' : '') + state.cur });
        }
      }
      return;
    }
    if (j.type === 'assistant' && j.message?.usage && !j.parent_tool_use_id) {
      const u = j.message.usage;
      const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      if (used) { state.ctxUsed = used; emit({ kind: 'context', used, window: state.ctxWindow || null, compactAt: state.compactAt || null, model: j.message.model || state.model }); }
    }
    if (j.type === 'assistant') {
      for (const b of j.message?.content || []) {
        if (b.type === 'thinking' && b.thinking && !state.sawThinkDelta && !j.parent_tool_use_id) {
          state.think = (state.think ? state.think + '\n\n' : '') + b.thinking;
          emit({ kind: 'thinking', text: state.think });
        } else if (b.type === 'text' && b.text) {
          // текст субагента — заметка в его карточке, в ответ не попадает
          if (j.parent_tool_use_id) { emit({ kind: 'subagent', id: j.parent_tool_use_id, note: b.text.slice(0, 600) }); continue; }
          state.text += (state.text ? '\n\n' : '') + b.text;
          state.cur = '';
          emit({ kind: 'text', text: state.text });
        } else if (b.type === 'tool_use') {
          // шаг внутри субагента
          if (j.parent_tool_use_id) {
            emit({ kind: 'subagent', id: j.parent_tool_use_id, step: { id: b.id, status: 'run', ...toolSummary(b.name, b.input) } });
            continue;
          }
          if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
            emit({ kind: 'todos', todos: b.input.todos.map(t => ({ text: t.content || t.activeForm || '', status: t.status || 'pending' })) });
          }
          // запуск субагента (Task / Agent)
          if (/^(Task|Agent)$/.test(b.name)) {
            state.subs = state.subs || new Set();
            state.subs.add(b.id);
            emit({ kind: 'subagent', id: b.id, status: 'run', name: b.input?.subagent_type || 'general-purpose', title: b.input?.description || '', at: Date.now() });
            continue;
          }
          emit({ kind: 'step', id: b.id, status: 'run', ...toolSummary(b.name, b.input) });
        }
      }
    } else if (j.type === 'user') {
      for (const b of j.message?.content || []) {
        if (b.type !== 'tool_result') continue;
        const status = b.is_error ? 'error' : 'done';
        if (j.parent_tool_use_id) emit({ kind: 'subagent', id: j.parent_tool_use_id, step: { id: b.tool_use_id, status } });
        else if (state.subs?.has(b.tool_use_id)) emit({ kind: 'subagent', id: b.tool_use_id, status, end: Date.now() });
        else emit({ kind: 'step', id: b.tool_use_id, status });
      }
    } else if (j.type === 'result') {
      state.isError = !!j.is_error;
      state.finalResult = typeof j.result === 'string' ? j.result : state.text;
      state.cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null;
      const u = j.usage || {};
      const mu = Object.entries(j.modelUsage || {});
      const main = mu.find(([m]) => m === state.model) || mu.sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0))[0];
      if (main?.[1]?.contextWindow) state.ctxWindow = main[1].contextWindow;
      state.usage = {
        input: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
        output: u.output_tokens || 0, thinking: u.output_tokens_details?.thinking_tokens || 0,
        apiMs: j.duration_api_ms || null, turns: j.num_turns || null, model: main?.[0] || state.model || null,
        startupMs: state.tInit ? state.tInit - state.t0 : null, firstMs: state.tFirst ? state.tFirst - state.t0 : null, retries: state.retries,
        listCost: state.cost,
      };
      if (state.ctxUsed) emit({ kind: 'context', used: state.ctxUsed, window: state.ctxWindow || null, compactAt: state.compactAt || null, model: state.usage.model });
    }
  },

  // codex exec --json (новый формат item.* и старый msg.*)
  codex(line, state, emit) {
    if (!line.trim()) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.thread_id) state.sessionId = j.thread_id;
    if (j.rate_limits) codexLimits(j.rate_limits, emit);
    if (j.model && !state.model) state.model = j.model;
    const item = j.item;
    if (item) {
      const done = j.type === 'item.completed';
      const status = done ? (item.status === 'failed' || item.exit_code > 0 ? 'error' : 'done') : 'run';
      switch (item.type) {
        case 'agent_message':
          if (done && item.text) { state.text += (state.text ? '\n\n' : '') + item.text; emit({ kind: 'text', text: state.text }); }
          break;
        case 'command_execution':
          emit({ kind: 'step', id: item.id, status, title: t('Терминал'), tool: 'run', detail: String(item.command || '').slice(0, 160) });
          break;
        case 'file_change': {
          const ch = item.changes || [];
          emit({ kind: 'step', id: item.id, status, title: t('Изменение файлов'), tool: ch.some(c => c.kind === 'add') ? 'create' : 'edit',
            path: ch[0]?.path || null, paths: ch.map(c => c.path).filter(Boolean),
            detail: ch.map(c => `${c.kind || ''} ${c.path}`.trim()).join(', ').slice(0, 160) });
          break;
        }
        case 'todo_list':
          emit({ kind: 'todos', todos: (item.items || []).map((t, i, a) => ({ text: t.text, status: t.completed ? 'completed' : (a.findIndex(x => !x.completed) === i ? 'in_progress' : 'pending') })) });
          break;
        case 'mcp_tool_call':
          emit({ kind: 'step', id: item.id, status, title: item.tool || t('Инструмент'), detail: item.server || '' });
          break;
        case 'web_search':
          emit({ kind: 'step', id: item.id, status, title: t('Поиск'), tool: 'web', detail: item.query || '' });
          break;
        case 'reasoning': {
          const txt = item.text || (item.summary || []).map(x => x.text || x).join('\n') || '';
          if (!txt) break;
          state.thinkItems = state.thinkItems || {};
          state.thinkItems[item.id] = txt;
          emit({ kind: 'thinking', text: Object.values(state.thinkItems).join('\n\n') });
          break;
        }
      }
    } else if (j.type === 'turn.completed') {
      state.turnDone = true;
      if (!j.usage) return;
      const u = j.usage;
      state.usage = { input: (u.input_tokens || 0) - (u.cached_input_tokens || 0), cacheRead: u.cached_input_tokens || 0, cacheWrite: 0,
        output: u.output_tokens || 0, thinking: u.reasoning_output_tokens || 0, model: state.model || null };
      // это сумма за все запросы хода, а не заполненность контекста — контекст берём только из token_count
    } else if (j.type === 'turn.failed') {
      state.isError = true;
      state.finalResult = j.error?.message || j.message || t('Ошибка Codex');
    } else if (j.type === 'error') {
      // Codex шлёт «error» и при временных сбоях (переподключение) — это ещё не провал задачи
      const msg = j.message || j.error?.message || '';
      state.lastError = msg;
      if (NET_RE.test(msg)) state.netFails = (state.netFails || 0) + 1;
      emit({ kind: 'step', id: `warn-${Date.now()}`, status: 'error', title: t('Предупреждение'), tool: 'other', detail: msg.slice(0, 200) });
    } else if (j.msg) {
      const m = j.msg;
      if (m.type === 'agent_message' && m.message) { state.text += (state.text ? '\n\n' : '') + m.message; emit({ kind: 'text', text: state.text }); }
      if (m.type === 'exec_command_begin') emit({ kind: 'step', id: m.call_id, status: 'run', title: t('Терминал'), tool: 'run', detail: [].concat(m.command || []).join(' ').slice(0, 160) });
      if (m.type === 'exec_command_end') emit({ kind: 'step', id: m.call_id, status: m.exit_code ? 'error' : 'done' });
      if (m.type === 'error') { state.isError = true; state.finalResult = m.message; }
      if (m.type === 'token_count') {
        if (m.info?.model_context_window) state.ctxWindow = m.info.model_context_window;
        const last = m.info?.last_token_usage;
        if (last) emit({ kind: 'context', used: (last.input_tokens || 0) + (last.output_tokens || 0), window: state.ctxWindow || null });
        codexLimits(m.rate_limits, emit);
      }
    }
  },

  // opencode run --format json: step_start · text · reasoning · tool_use · step_finish · error
  opencode(line, state, emit) {
    if (!line.trim()) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.sessionID) state.sessionId = j.sessionID;
    const p = j.part || {};
    if (j.type === 'step_start') {
      if (!state.tFirst) state.tFirst = Date.now();
    } else if (j.type === 'text' && p.text) {
      state.text += (state.text ? '\n\n' : '') + p.text;
      emit({ kind: 'text', text: state.text });
    } else if (j.type === 'reasoning' && p.text) {
      state.think = (state.think ? state.think + '\n\n' : '') + p.text;
      emit({ kind: 'thinking', text: state.think });
    } else if (j.type === 'tool_use' && p.type === 'tool') {
      const st = p.state || {};
      const inp = st.input || {};
      const status = st.status === 'error' ? 'error' : 'done';
      if (p.tool === 'task') {
        emit({ kind: 'subagent', id: p.callID || p.id, status, name: inp.subagent_type || 'general', title: inp.description || st.title || '', at: Date.now(), end: Date.now() });
        return;
      }
      if (p.tool === 'todowrite' && Array.isArray(inp.todos)) {
        emit({ kind: 'todos', todos: inp.todos.map(x => ({ text: x.content || '', status: x.status || 'pending' })) });
      }
      const file = inp.filePath || inp.file_path || inp.path || null;
      const pick = file || inp.command || inp.pattern || inp.url || inp.query || inp.description || st.title || '';
      emit({ kind: 'step', id: p.callID || p.id, status, title: p.tool, tool: OC_KIND[p.tool] || 'other', path: file,
        detail: String(st.error || pick).replace(/\s+/g, ' ').slice(0, 160) });
    } else if (j.type === 'step_finish') {
      state.turnDone = true;
      const tk = p.tokens || {};
      const u = state.usage || { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0, model: state.model || null, turns: 0 };
      u.input += tk.input || 0; u.output += tk.output || 0; u.thinking += tk.reasoning || 0;
      u.cacheRead += tk.cache?.read || 0; u.cacheWrite += tk.cache?.write || 0; u.turns++;
      if (typeof p.cost === 'number') state.cost = (state.cost || 0) + p.cost;
      state.usage = u;
      const used = (tk.input || 0) + (tk.cache?.read || 0) + (tk.cache?.write || 0) + (tk.output || 0);
      if (used) { state.ctxUsed = used; emit({ kind: 'context', used, window: null }); }
    } else if (j.type === 'error') {
      const e = j.error || {};
      const msg = e.data?.message || e.message || e.name || t('Ошибка OpenCode');
      state.lastError = msg;
      if (NET_RE.test(msg)) state.netFails = (state.netFails || 0) + 1;
      state.isError = true;
      state.finalResult = msg;
    }
  },

  // agy --output-format stream-json: init · step_update · result
  antigravity(line, state, emit) {
    if (!line.trim()) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    const type = j.event || j.type;
    if (type === 'init') {
      const i = j.init || {};
      if (i.model) state.model = i.model;
      state.tInit = Date.now();
      return;
    }
    if (type === 'step_update') {
      const s = j.step_update || {};
      if (s.conversation_id) state.sessionId = s.conversation_id;
      const idx = s.step_index ?? 0;
      const st = String(s.step_type || '').toLowerCase();
      if (s.text_delta) {
        if (!state.tFirst) state.tFirst = Date.now();
        if (/think|reason|thought/.test(st)) {
          state.think = (state.think || '') + s.text_delta;
          emit({ kind: 'thinking', text: state.think });
        } else if (st === 'agent_response' || st === 'planner_response' || !st) {
          // новый блок ответа — с новой строки
          if (state.textStep != null && state.textStep !== idx && state.text) state.text += '\n\n';
          state.textStep = idx;
          state.text += s.text_delta;
          emit({ kind: 'text', text: state.text });
        }
      }
      if (st === 'tool' || s.tool_info || s.tool_name) {
        const info = s.tool_info || {};
        const name = s.tool_name || info.name || 'tool';
        const p = info.parameters || {};
        const file = p.file_path || p.filePath || p.path || p.target_file || p.TargetFile || p.AbsolutePath || null;
        const pick = file || p.command || p.CommandLine || p.query || p.Query || p.pattern || p.url || p.Url || '';
        const failed = !!info.error;
        if (name === 'todo' || /todo/i.test(name)) {
          const todos = p.todos || p.items;
          if (Array.isArray(todos)) emit({ kind: 'todos', todos: todos.map(x => ({ text: x.content || x.text || '', status: x.status || 'pending' })) });
        }
        emit({ kind: 'step', id: `agy-${idx}`, status: failed ? 'error' : (s.state === 'DONE' ? 'done' : 'run'), title: name, tool: agyKind(name), path: typeof file === 'string' ? file : null,
          detail: String(failed ? (info.error.message || info.error.type || '') : pick).replace(/\s+/g, ' ').slice(0, 160) });
      }
      for (const sub of s.subagent_info?.subagents || []) {
        emit({ kind: 'subagent', id: sub.conversation_id || `${idx}-${sub.type_name}`, status: s.state === 'DONE' ? 'done' : 'run', name: sub.type_name || 'subagent', title: sub.role || '', at: Date.now(), ...(s.state === 'DONE' ? { end: Date.now() } : {}) });
      }
      const u = s.usage;
      if (u) {
        const used = u.total_tokens || ((u.input_tokens || 0) + (u.output_tokens || 0));
        if (used) { state.ctxUsed = used; emit({ kind: 'context', used, window: null, model: state.model }); }
      }
      return;
    }
    if (type === 'result') {
      const r = j.result || {};
      if (r.conversation_id) state.sessionId = r.conversation_id;
      state.turnDone = true;
      const status = String(r.status || '').toUpperCase();
      state.isError = !!r.error || (status && status !== 'SUCCESS');
      const err = typeof r.error === 'string' ? r.error : (r.error?.message || r.error?.type || '');
      state.finalResult = state.isError ? (err || t('Antigravity: {s}', { s: status || 'ERROR' })) : (typeof r.response === 'string' && r.response ? r.response : state.text);
      if (state.isError) { state.lastError = err; if (NET_RE.test(err)) state.netFails = (state.netFails || 0) + 1; }
      const u = r.usage || {};
      const cacheRead = u.cache_read_tokens || 0;
      // input_tokens у Gemini включает прочитанное из кэша — считаем только новые
      state.usage = { input: Math.max(0, (u.input_tokens || 0) - cacheRead), cacheRead, cacheWrite: 0, output: u.output_tokens || 0, thinking: u.thinking_tokens || 0,
        model: state.model || null, turns: r.num_turns || null, apiMs: r.duration_seconds ? Math.round(r.duration_seconds * 1000) : null,
        startupMs: state.tInit ? state.tInit - state.t0 : null, firstMs: state.tFirst ? state.tFirst - state.t0 : null };
    }
  },
};

// Инструменты Antigravity → тип шага для сводки
function agyKind(name) {
  const n = String(name || '').toLowerCase();
  if (/write|create/.test(n)) return 'create';
  if (/edit|replace|patch/.test(n)) return 'edit';
  if (/read|view/.test(n)) return 'read';
  if (/command|shell|terminal|bash|run/.test(n)) return 'run';
  if (/grep|search|find|list|glob|codesearch/.test(n)) return /web/.test(n) ? 'web' : 'search';
  if (/web|browser|url|fetch/.test(n)) return 'web';
  if (/todo|plan/.test(n)) return 'plan';
  return 'other';
}

module.exports = { openLogin, effortOf, binFor, normalizeUserPath, BINS, SAFE_ARG, run, detect, LABELS, RESUMABLE, PARSERS, buildCommand, parseAgyModels };
