// История файлов: перед каждым запуском агента — снимок папки, после — точка восстановления.
// Содержимое файлов хранится один раз по хэшу (blobs/<sha1>), поэтому повторные снимки почти ничего не занимают.
// Откат возвращает только те файлы, которые поменял агент, и только если вы их с тех пор не трогали.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { t } = require('./i18n');
const arena = require('./arena');

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target', '.synapse', '.idea', '.vs', '.gradle', 'Library', 'Temp', 'dist', 'build', 'out']);
const MAX_FILE = 5 * 1024 * 1024;   // большие файлы (медиа, архивы) не сохраняем
const MAX_FILES = 8000;
const MAX_TOTAL = 300 * 1024 * 1024;
const KEEP = 60;                     // сколько точек восстановления хранить
const ID_RE = /^h[a-z0-9]{6,20}$/;

let root = null;
function init(dir) { root = dir; fs.mkdirSync(path.join(root, 'blobs'), { recursive: true }); fs.mkdirSync(path.join(root, 'points'), { recursive: true }); }
const blobPath = (h) => path.join(root, 'blobs', h.slice(0, 2), h);
const pointPath = (id) => path.join(root, 'points', `${id}.json`);
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Обход папки: { rel → { h, size } }; слишком большая папка — история для неё выключается
function scan(cwd) {
  const map = {};
  let n = 0, total = 0;
  const rec = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(abs, r); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > MAX_FILE) continue;
      if (++n > MAX_FILES || (total += st.size) > MAX_TOTAL) throw Object.assign(new Error('too big'), { code: 'too_big' });
      let buf; try { buf = fs.readFileSync(abs); } catch { continue; }
      const h = sha1(buf);
      map[r] = h;
      // содержимое сохраняем сразу: после работы агента старой версии уже не будет
      const bp = blobPath(h);
      if (!fs.existsSync(bp)) { fs.mkdirSync(path.dirname(bp), { recursive: true }); fs.writeFileSync(bp, buf); }
    }
  };
  rec(cwd, '');
  return map;
}

/** Снимок перед запуском агента. null — история для этой папки недоступна (слишком большая или нет папки). */
function before(cwd) {
  if (!root || !cwd || !fs.existsSync(cwd)) return null;
  try { return { cwd, at: Date.now(), map: scan(cwd) }; } catch { return null; }
}

/** После работы агента: точка восстановления, если что-то изменилось. */
function after(snap, info = {}) {
  if (!snap) return null;
  let now;
  try { now = scan(snap.cwd); } catch { return null; }
  const files = [];
  for (const [rel, h] of Object.entries(now)) {
    if (!(rel in snap.map)) files.push({ rel, kind: 'add', after: h });
    else if (snap.map[rel] !== h) files.push({ rel, kind: 'mod', before: snap.map[rel], after: h });
  }
  for (const [rel, h] of Object.entries(snap.map)) if (!(rel in now)) files.push({ rel, kind: 'del', before: h });
  if (!files.length) return null;
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const point = { id, cwd: snap.cwd, at: Date.now(), started: snap.at, files, ...pick(info, ['chatId', 'msgId', 'executor', 'label', 'kind']) };
  fs.writeFileSync(pointPath(id), JSON.stringify(point));
  // последнее состояние папки — чтобы следующий снимок не копировал всё заново (хэши уже в blobs)
  gc(snap.cwd, now);
  return summary(point);
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null).map(k => [k, o[k]]));

function read(id) {
  if (!ID_RE.test(id || '')) throw new Error('bad id');
  return JSON.parse(fs.readFileSync(pointPath(id), 'utf8'));
}
function summary(p) {
  return { id: p.id, cwd: p.cwd, at: p.at, kind: p.kind || 'agent', label: p.label || '', reverted: p.reverted || null,
    files: p.files.map(f => ({ rel: f.rel, kind: f.kind })) };
}

const readBlob = (h) => (h ? fs.readFileSync(blobPath(h)) : null);
const textOf = (buf) => (buf && !buf.subarray(0, 8000).includes(0) ? buf.toString('utf8') : null);

/** Diff по файлам точки (для просмотра). */
function diff(id) {
  const p = read(id);
  return p.files.map(f => {
    let d = '';
    try {
      const a = f.before ? textOf(readBlob(f.before)) : '';
      const b = f.after ? textOf(readBlob(f.after)) : '';
      if (f.kind === 'del') d = t('(файл удалён)');
      else if (a == null || b == null) d = t('(двоичный файл)');
      else d = f.kind === 'add' ? b.split('\n').slice(0, 260).map(l => '+' + l).join('\n') : arena.unified(a, b);
    } catch { d = t('(нет сохранённой версии)'); }
    return { rel: f.rel, kind: f.kind, diff: d, add: (d.match(/^\+/gm) || []).length, del: (d.match(/^-/gm) || []).length };
  });
}

const fileHash = (abs) => { try { return sha1(fs.readFileSync(abs)); } catch { return null; } };
const inside = (cwd, rel) => { const abs = path.resolve(cwd, ...rel.split('/')); return abs.startsWith(path.resolve(cwd) + path.sep) ? abs : null; };

/**
 * Откат (to='before') или возврат изменений (to='after').
 * Без force файлы, которые изменились после агента, не трогаем — возвращаем список конфликтов.
 */
function restore(id, to = 'before', force = false) {
  const p = read(id);
  const want = to === 'after' ? 'after' : 'before';
  const expect = want === 'before' ? 'after' : 'before'; // что сейчас должно лежать в папке
  const conflicts = [];
  for (const f of p.files) {
    const abs = inside(p.cwd, f.rel);
    if (!abs) continue;
    const now = fs.existsSync(abs) ? fileHash(abs) : null;
    if (now !== (f[expect] || null)) conflicts.push(f.rel);
  }
  if (conflicts.length && !force) return { ok: false, conflicts };
  let n = 0;
  for (const f of p.files) {
    const abs = inside(p.cwd, f.rel);
    if (!abs) continue;
    const h = f[want];
    if (!h) { fs.rmSync(abs, { force: true }); n++; continue; }
    const buf = readBlob(h);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    n++;
  }
  p.reverted = want === 'before' ? { at: Date.now() } : null;
  fs.writeFileSync(pointPath(id), JSON.stringify(p));
  return { ok: true, count: n, reverted: !!p.reverted };
}

/** Точки восстановления для папки (новые сверху). */
function list(cwd, limit = 30) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(path.join(root, 'points')).filter(n => n.endsWith('.json')).sort().reverse(); } catch { return out; }
  for (const n of names) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(root, 'points', n), 'utf8'));
      if (!cwd || path.resolve(p.cwd) === path.resolve(cwd)) out.push(summary(p));
    } catch { /* битый файл */ }
    if (out.length >= limit) break;
  }
  return out;
}

// Чистка: храним KEEP последних точек; содержимое — только то, на что они ссылаются, и последнее состояние папок
const LATEST = () => path.join(root, 'latest.json');
function gc(cwd, map) {
  let latest = {};
  try { latest = JSON.parse(fs.readFileSync(LATEST(), 'utf8')); } catch { /* первый раз */ }
  if (cwd) latest[path.resolve(cwd)] = map;
  const keys = Object.keys(latest);
  if (keys.length > 12) for (const k of keys.slice(0, keys.length - 12)) delete latest[k];
  fs.writeFileSync(LATEST(), JSON.stringify(latest));
  let names = [];
  try { names = fs.readdirSync(path.join(root, 'points')).filter(n => n.endsWith('.json')).sort(); } catch { return; }
  for (const n of names.slice(0, Math.max(0, names.length - KEEP))) fs.rmSync(path.join(root, 'points', n), { force: true });
  // редкая полная чистка содержимого
  if (Math.random() > 0.2) return;
  const used = new Set();
  for (const m of Object.values(latest)) for (const h of Object.values(m)) used.add(h);
  for (const n of names.slice(-KEEP)) {
    try { for (const f of JSON.parse(fs.readFileSync(path.join(root, 'points', n), 'utf8')).files) { if (f.before) used.add(f.before); if (f.after) used.add(f.after); } } catch { /* пропуск */ }
  }
  const bdir = path.join(root, 'blobs');
  for (const d of fs.readdirSync(bdir)) {
    for (const h of fs.readdirSync(path.join(bdir, d))) if (!used.has(h)) fs.rmSync(path.join(bdir, d, h), { force: true });
  }
}

module.exports = { init, before, after, diff, restore, list, read: (id) => summary(read(id)) };
