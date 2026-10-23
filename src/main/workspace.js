// Рабочее место вкладки «Код»: дерево файлов, предпросмотр и терминал в папке чата.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

// ---------- корни (папки чатов), к которым разрешён доступ ----------
const roots = new Map(); // id -> абсолютный путь

function rootId(dir) { return crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 12); }

function register(dir) {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const id = rootId(abs);
  roots.set(id, abs);
  return { id, path: abs };
}

// Путь внутри корня; всё, что выходит наружу (../, ссылки на другие диски) — запрещено
function inside(id, rel = '') {
  const root = roots.get(id);
  if (!root) throw new Error('unknown root');
  const p = path.resolve(root, String(rel || '').replace(/^[\\/]+/, ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('outside root');
  return p;
}

const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const HEAVY = new Set(['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache']);

function list(id, rel = '') {
  const dir = inside(id, rel);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => !HIDDEN.has(e.name))
    .map(e => {
      const full = path.join(dir, e.name);
      let st = null;
      try { st = fs.statSync(full); } catch { /* битая ссылка */ }
      return {
        name: e.name,
        rel: path.relative(roots.get(id), full).split(path.sep).join('/'),
        dir: !!st?.isDirectory(),
        size: st?.size || 0,
        mtime: st?.mtimeMs || 0,
        heavy: HEAVY.has(e.name),
      };
    })
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VID = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUD = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
const LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', lua: 'lua', luau: 'lua', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'bash', bash: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos',
  cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', php: 'php', rb: 'ruby',
  sql: 'sql', swift: 'swift', dart: 'dart', vue: 'xml', txt: 'plaintext', log: 'plaintext', env: 'ini', gitignore: 'plaintext',
};

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function read(id, rel) {
  const p = inside(id, rel);
  const st = fs.statSync(p);
  if (st.isDirectory()) return { kind: 'dir' };
  const ext = (path.extname(p).slice(1) || path.basename(p).replace(/^\./, '')).toLowerCase();
  const url = `wsfile://${id}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const base = { name: path.basename(p), rel, path: p, size: st.size, mtime: st.mtimeMs, ext, url };
  if (IMG.has(ext) && ext !== 'svg') return { ...base, kind: 'image' };
  if (VID.has(ext)) return { ...base, kind: 'video' };
  if (AUD.has(ext)) return { ...base, kind: 'audio' };
  if (ext === 'pdf') return { ...base, kind: 'pdf' };
  const LIMIT = 1.5 * 1024 * 1024;
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(Math.min(st.size, LIMIT));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  if (looksBinary(buf)) return { ...base, kind: 'binary' };
  const text = buf.toString('utf8');
  const kind = ext === 'md' || ext === 'markdown' ? 'markdown' : (ext === 'html' || ext === 'htm') ? 'html' : ext === 'svg' ? 'svg' : 'text';
  return { ...base, kind, text, truncated: st.size > LIMIT, lang: LANG[ext] || null };
}

// Протокол wsfile://<root>/<путь> — для живого предпросмотра HTML со всеми его css/js/картинками
function handleProtocol(req, netFetch, pathToFileURL) {
  try {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname || '/');
    let p = inside(u.hostname, rel);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) return new Response('not found', { status: 404 });
    return netFetch(pathToFileURL(p).toString());
  } catch {
    return new Response('forbidden', { status: 403 });
  }
}

// ---------- терминал ----------
// Без нативного PTY: постоянный процесс оболочки, команды идут в stdin.
// После каждой команды печатаем маркер с текущей папкой — по нему UI рисует приглашение.
const MARK = '\u0007SYN_DONE';
const terms = new Map(); // termId -> { child, cwd }

function shellSpec() {
  if (IS_WIN) {
    const ps = fs.existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')) ? 'pwsh.exe' : 'powershell.exe';
    return {
      bin: ps, name: ps === 'pwsh.exe' ? 'PowerShell 7' : 'Windows PowerShell',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      init: '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; $ErrorView="ConciseView"',
      wrap: (cmd) => `${cmd}\nWrite-Host ("${MARK}" + (Get-Location).Path)\n`,
    };
  }
  const sh = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
  return {
    bin: sh, name: path.basename(sh), args: [],
    init: 'export TERM=dumb',
    wrap: (cmd) => `${cmd}\nprintf '%s%s\\n' "${MARK}" "$PWD"\n`,
  };
}

function termStart(termId, cwd, env, onData, onExit) {
  termKill(termId);
  const spec = shellSpec();
  const child = spawn(spec.bin, spec.args, { cwd, env: { ...env, NO_COLOR: '1', FORCE_COLOR: '0' }, windowsHide: true });
  const t = { child, cwd, spec, buf: '' };
  terms.set(termId, t);
  const pump = (stream) => (d) => {
    let s = t.buf + d.toString('utf8');
    t.buf = '';
    let i;
    while ((i = s.indexOf(MARK)) >= 0) {
      const end = s.indexOf('\n', i);
      if (end < 0) { t.buf = s.slice(i); s = s.slice(0, i); break; }
      if (i > 0) onData({ stream, text: s.slice(0, i) });
      t.cwd = s.slice(i + MARK.length, end).replace(/\r$/, '');
      onData({ stream: 'done', cwd: t.cwd });
      s = s.slice(end + 1);
    }
    if (s) onData({ stream, text: s });
  };
  child.stdout.on('data', pump('out'));
  child.stderr.on('data', (d) => onData({ stream: 'err', text: d.toString('utf8') }));
  child.on('exit', (code) => { if (terms.get(termId)?.child === child) terms.delete(termId); onExit(code); });
  child.on('error', (e) => onData({ stream: 'err', text: `${e.message}\n` }));
  child.stdin.on('error', () => {});
  child.stdin.write(spec.wrap(spec.init));
  return { shell: spec.name, cwd };
}

function termRun(termId, cmd) {
  const t = terms.get(termId);
  if (!t) return false;
  t.child.stdin.write(t.spec.wrap(String(cmd)));
  return true;
}

function termKill(termId) {
  const t = terms.get(termId);
  if (!t) return;
  terms.delete(termId);
  const pid = t.child.pid;
  try {
    if (IS_WIN) execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else t.child.kill('SIGKILL');
  } catch { /* уже завершён */ }
}

function killAll() { for (const id of [...terms.keys()]) termKill(id); }

module.exports = { register, list, read, handleProtocol, termStart, termRun, termKill, killAll, inside, roots };
