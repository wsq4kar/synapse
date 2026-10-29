// Арена: несколько больших моделей решают задачу вместе.
// Маленькая модель пишет бриф → большие предлагают планы → спорят (до N кругов, пока не согласятся)
// → каждая пишет код в своей копии папки → анонимно голосуют за лучший вариант
// → победитель исправляет то, что нашли другие → пользователь смотрит итог и применяет его кнопкой.
// Пока не нажата «Применить», папка пользователя не меняется.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cli = require('./executors/cli');
const { t } = require('./i18n');

// ---------- модели ----------
// Список и порядок (по силе в коде) — в models.json, раздел arena. big — участники, small — диспетчер.
const catalog = require('./catalog');
const modelsList = () => catalog.get().arena;
const BIG_AGENTS = ['claude', 'codex', 'antigravity']; // OpenCode — только вручную
const DEFAULTS = { auto: true, rounds: 3, maxBig: 3, roster: [], dispatcher: null };

function cfgOf(settings) { return { ...DEFAULTS, ...(settings.arena || {}) }; }

// Запасные модели того же агента — если выбранной нет в подписке.
// Если CLI сообщил список доступных моделей (Antigravity), недоступные сразу пропускаем.
function candidatesFor(agent, model, tier, available) {
  const same = modelsList().filter(m => m.agent === agent && m.tier === tier).map(m => m.model);
  let list = [model, ...same.filter(m => m !== model)].filter(Boolean);
  if (available?.length) list = list.filter(m => available.includes(m));
  return [...new Set(list), null]; // null = модель по умолчанию в CLI
}

/** Состав: участники (большие модели) и диспетчер (маленькая). */
function roster(settings, agents) {
  const cfg = cfgOf(settings);
  const installed = new Set((agents || []).filter(a => a.installed).map(a => a.id));
  let big;
  if (!cfg.auto && cfg.roster?.length) {
    big = cfg.roster.filter(r => r.on !== false && installed.has(r.agent)).map(r => ({ agent: r.agent, model: r.model || null }));
  } else {
    // сначала по одной сильнейшей модели от каждого агента — разные «школы» спорят полезнее
    big = [];
    for (const m of modelsList().filter(x => x.tier === 'big' && BIG_AGENTS.includes(x.agent) && installed.has(x.agent))) {
      if (!big.some(b => b.agent === m.agent)) big.push({ agent: m.agent, model: m.model });
    }
    // мало агентов — добираем до лимита их следующими по силе моделями
    const want = Math.max(2, Math.min(4, cfg.maxBig || 3));
    for (const m of modelsList().filter(x => x.tier === 'big' && BIG_AGENTS.includes(x.agent) && installed.has(x.agent))) {
      if (big.length >= want) break;
      if (!big.some(b => b.model === m.model)) big.push({ agent: m.agent, model: m.model });
    }
  }
  big = big.slice(0, cfg.auto === false && cfg.roster?.length ? 4 : Math.max(1, Math.min(4, cfg.maxBig || 3)));
  let disp = cfg.dispatcher && installed.has(cfg.dispatcher.agent) ? cfg.dispatcher : null;
  if (!disp) {
    const s = modelsList().find(x => x.tier === 'small' && installed.has(x.agent) && x.agent !== 'opencode')
      || modelsList().find(x => x.tier === 'small' && installed.has(x.agent));
    disp = s ? { agent: s.agent, model: s.model } : (big[0] ? { ...big[0] } : null);
  }
  return {
    participants: big.map((b, i) => ({ id: `p${i + 1}`, agent: b.agent, model: b.model, label: cli.LABELS[b.agent] })),
    dispatcher: disp ? { id: 'd', agent: disp.agent, model: disp.model, label: cli.LABELS[disp.agent] } : null,
    rounds: Math.max(1, Math.min(5, cfg.rounds || 3)),
    models: modelsList(),
  };
}

// ---------- копии папки ----------
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target', '.synapse', '.idea', '.vs', '.gradle', 'Library', 'Temp']);
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 20000;

function walk(root, onFile) {
  let n = 0;
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
      if (++n > MAX_FILES) throw Object.assign(new Error(t('Папка слишком большая для Арены (больше {n} файлов). Выберите папку проекта поменьше.', { n: MAX_FILES })), { code: 'arena' });
      onFile(r, abs, st);
    }
  };
  rec(root, '');
}
const hashFile = (abs) => { try { return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'); } catch { return null; } };
function snapshot(root) {
  const map = {};
  if (fs.existsSync(root)) walk(root, (rel, abs) => { map[rel] = hashFile(abs); });
  return map;
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  if (!fs.existsSync(src)) return;
  walk(src, (rel, abs) => {
    const to = path.join(dst, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(abs, to);
  });
}
// Что изменилось в копии относительно исходной папки
function changes(snap, dir) {
  const out = [];
  const seen = new Set();
  walk(dir, (rel, abs) => {
    seen.add(rel);
    const h = hashFile(abs);
    if (!(rel in snap)) out.push({ rel, kind: 'add' });
    else if (snap[rel] !== h) out.push({ rel, kind: 'mod' });
  });
  for (const rel of Object.keys(snap)) if (!seen.has(rel)) out.push({ rel, kind: 'del' });
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ---------- diff ----------
const isText = (buf) => !buf.subarray(0, 8000).includes(0);
function readText(abs) {
  try { const b = fs.readFileSync(abs); return isText(b) ? b.toString('utf8') : null; } catch { return ''; }
}
// Построчный diff (LCS) с контекстом; большие файлы — кратко
function unified(a, b, ctx = 2, maxOut = 260) {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 4e6) return `@@ ${t('файл большой: было {a} строк, стало {b}', { a: A.length, b: B.length })} @@`;
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', A[i++]]);
    else ops.push(['+', B[j++]]);
  }
  while (i < n) ops.push(['-', A[i++]]);
  while (j < m) ops.push(['+', B[j++]]);
  // оставляем изменения и ctx строк вокруг
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -ctx; d <= ctx; d++) if (ops[k + d]) keep[k + d] = true; });
  const lines = [];
  let gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) { if (!gap && lines.length) lines.push('…'); gap = true; continue; }
    gap = false;
    lines.push(ops[k][0] + ops[k][1]);
    if (lines.length >= maxOut) { lines.push(t('… ещё изменения не показаны')); break; }
  }
  return lines.join('\n');
}
function fileDiff(origRoot, dir, f) {
  if (f.kind === 'del') return { ...f, diff: t('(файл удалён)') };
  const now = readText(path.join(dir, ...f.rel.split('/')));
  if (now == null) return { ...f, diff: t('(двоичный файл)') };
  const was = f.kind === 'mod' ? readText(path.join(origRoot, ...f.rel.split('/'))) : '';
  if (was == null) return { ...f, diff: t('(двоичный файл)') };
  const d = f.kind === 'add' ? now.split('\n').slice(0, 260).map(l => '+' + l).join('\n') : unified(was, now);
  const add = (d.match(/^\+/gm) || []).length, del = (d.match(/^-/gm) || []).length;
  return { ...f, diff: d, add, del };
}
function variantText(origRoot, dir, files, limit = 30000) {
  let out = '';
  for (const f of files) {
    const d = fileDiff(origRoot, dir, f);
    const block = `### ${f.kind === 'add' ? 'NEW' : f.kind === 'del' ? 'DELETED' : 'CHANGED'} ${f.rel}\n\`\`\`diff\n${d.diff}\n\`\`\`\n`;
    if (out.length + block.length > limit) { out += `\n(${t('и ещё {n} файлов', { n: files.length - files.indexOf(f) })})\n`; break; }
    out += block;
  }
  return out || t('(изменений нет)');
}

// ---------- разбор ответов ----------
function lastJson(text) {
  const s = String(text || '');
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]).reverse();
  for (const f of fences) { try { return JSON.parse(f.trim()); } catch { /* дальше */ } }
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    const end = s.lastIndexOf('}');
    if (end > i) { try { return JSON.parse(s.slice(i, end + 1)); } catch { /* дальше */ } }
    if (i === 0) break;
  }
  return null;
}
const stripJson = (text) => String(text || '').replace(/```json[\s\S]*?```\s*$/i, '').replace(/\{[^{}]*"(agree|scores)"[\s\S]*\}\s*$/, '').trim();
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + '\n…' : s; };
function addUsage(a, u) {
  if (!u) return a;
  for (const k of ['input', 'cacheRead', 'cacheWrite', 'output', 'thinking']) a[k] = (a[k] || 0) + (u[k] || 0);
  return a;
}
const MODEL_MISSING = /model[^\n]{0,80}(not (found|supported|available|exist)|does not exist|unknown|invalid|unsupported)|(unknown|unsupported|invalid) model|not_found_error|no such model|model_not_found/i;

// ---------- промпты ----------
const LANG = 'Write your answer in the same language as the user task.';
const P = {
  brief: (task, ctx) => `You are the dispatcher of the Synapse Arena: several strong AI models will plan, debate and implement a coding task, then vote for the best result.
Do NOT create or modify any files. Briefly look at the project in the current folder, then write a precise brief for the senior models:
1. Goal
2. Project context: the relevant files and how they fit together
3. Requirements and constraints (including the user's preferences below, if relevant)
4. Acceptance criteria as a checklist
5. Risks and edge cases
Keep it under 450 words. ${LANG}
${ctx ? `\n${ctx}\n` : ''}
USER TASK:
${task}`,

  plan: (me, n, brief) => `You are ${me}, one of ${n} senior engineers in the Synapse Arena. The others will see your plan and criticise it.
Do NOT modify files yet. Read the brief and the project, then propose your implementation plan: approach, files to create or change, key decisions and trade-offs, how you will verify it works. Max 450 words. ${LANG}

BRIEF:
${brief}`,

  // mine = null: участник продолжает свою сессию и помнит свой план — не пересылаем его заново
  debate: (me, round, maxR, mine, others) => `Arena debate, round ${round} of ${maxR}. You are ${me}. Do NOT modify files.
Below are the current plans of the other engineers. Criticise them honestly (bugs, missed requirements, over-engineering, risks), defend or improve your own plan, and adopt good ideas from others.
Output your REVISED plan (max 400 words). ${LANG}
On the very last line output only a JSON object:
{"agree": true or false, "objections": ["short objection", "..."]}
"agree": true means you have no significant objections left and the team is ready to implement.
${mine ? `\nYOUR CURRENT PLAN:\n${mine}\n` : '\nYour current plan is your previous answer in this conversation.\n'}
OTHER PLANS:
${others}`,

  // brief/plan = null: они уже есть в сессии участника
  build: (brief, plan, objections) => `Implement the task now in the current folder. This folder is your own copy of the project; other engineers implement their own variants in parallel and will review yours.
Follow your final plan, respect the brief's acceptance criteria and address the objections raised in the debate. Make it complete and working; run the project's checks or tests if there are any.
Finish with a short summary of what you changed (max 150 words). ${LANG}
${brief ? `\nBRIEF:\n${brief}\n` : '\nThe brief is earlier in this conversation.\n'}${plan ? `\nYOUR FINAL PLAN:\n${plan}\n` : 'Your final plan is your last revised plan in this conversation.\n'}${objections ? `\nOBJECTIONS FROM THE DEBATE:\n${objections}\n` : ''}`,

  vote: (brief, variants, letters) => `Arena vote. Do NOT modify files. Below are anonymous variants (diffs against the original project) produced by the other engineers.
Evaluate each against the brief's acceptance criteria: correctness, completeness, code quality, risk of regressions.
Give each variant a score from 1 to 10 and list concrete fixes it needs. Write a short justification, then on the very last line output only a JSON object:
{"scores": {${letters.map(l => `"${l}": 0`).join(', ')}}, "fixes": {${letters.map(l => `"${l}": ["..."]`).join(', ')}}}
${LANG}
${brief ? `\nBRIEF:\n${brief}\n` : '\nThe brief is earlier in this conversation.\n'}
VARIANTS:
${variants}`,

  polish: (fixes, ideas) => `You won the Arena vote. Reviewers found these issues in your variant — fix them in place in the current folder:
${fixes || '- (no specific issues)'}
${ideas ? `\nGood ideas from other variants you may adopt if they improve the result:\n${ideas}\n` : ''}
Then give a short final summary for the user: what was built and how to use or check it (max 200 words). Write it in the same language as the original task.`,
};

// ---------- запуск ----------
/**
 * opts: { taskId, input, settings, agents, text, history, memory, cwd, root, extraEnv, signal, emit }
 * emit({ kind:'arena', ... }) — прогресс для интерфейса.
 */
async function run(opts) {
  const { settings, agents, text, cwd, root, extraEnv, signal, emit } = opts;
  const R = roster(settings, agents);
  if (!R.participants.length) throw Object.assign(new Error(t('Для Арены нужен хотя бы один установленный агент: Claude Code, Codex или Antigravity.')), { code: 'arena' });
  const avail = (agent) => (agents || []).find(a => a.id === agent)?.models || null;

  const runId = `a${Date.now().toString(36)}`;
  const runDir = path.join(root, runId);
  cleanup(root, 10);
  fs.mkdirSync(runDir, { recursive: true });

  const ev = (o) => emit({ kind: 'arena', ...o });
  const parts = R.participants.map(p => ({ ...p, cand: candidatesFor(p.agent, p.model, 'big', avail(p.agent)), dir: path.join(runDir, p.id), session: null, alive: true, plan: '', summary: '', usage: {} }));
  const disp = R.dispatcher ? { ...R.dispatcher, cand: candidatesFor(R.dispatcher.agent, R.dispatcher.model, 'small', avail(R.dispatcher.agent)), dir: path.join(runDir, 'brief'), session: null, alive: true, usage: {} } : null;
  const total = {};
  const bigEffort = opts.input.ultra ? 'max' : 'xhigh';

  ev({ type: 'init', runId, cwd, rounds: R.rounds,
    participants: parts.map(p => ({ id: p.id, agent: p.agent, model: p.model, label: p.label })),
    dispatcher: disp ? { id: disp.id, agent: disp.agent, model: disp.model, label: disp.label } : null });

  // исходное состояние и копии
  ev({ type: 'stage', stage: 'copy' });
  const snap = snapshot(cwd);
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ cwd, snap, at: Date.now() }));
  for (const p of parts) copyTree(cwd, p.dir);
  if (disp) copyTree(cwd, disp.dir);

  // один шаг одного участника; при недоступной модели пробуем следующую того же агента
  async function step(p, stage, prompt, { effort, access = settings.agentAccess, keepSession = true } = {}) {
    if (signal.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
    ev({ type: 'part', pid: p.id, stage, status: 'run', at: Date.now() });
    while (p.cand.length) {
      const model = p.cand[0];
      const r = await cli.run({
        id: p.agent, bin: cli.binFor(p.agent, settings.cliPaths), cwd: p.dir, prompt, access,
        sessionId: keepSession && cli.RESUMABLE.has(p.agent) ? p.session : null,
        model, effort, ultra: false, extraEnv, signal,
        onEvent: (e) => {
          if (e.kind === 'step' && e.title) ev({ type: 'part', pid: p.id, stage, activity: `${e.title}${e.detail ? ' ' + e.detail : ''}`.slice(0, 140) });
          if (e.kind === 'limits') emit(e);
        },
      });
      if (r.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
      addUsage(p.usage, r.usage); addUsage(total, r.usage);
      if (r.ok) {
        if (r.sessionId) p.session = r.sessionId;
        if (model !== p.model) { p.model = model; ev({ type: 'model', pid: p.id, model }); }
        ev({ type: 'part', pid: p.id, stage, status: 'done', end: Date.now() });
        return r.text;
      }
      if (MODEL_MISSING.test(r.error || '') && p.cand.length > 1) {
        p.cand.shift();
        p.session = null; // сессия была у другой модели — следующий шаг получит полный контекст
        ev({ type: 'part', pid: p.id, stage, activity: t('{m} недоступна — пробую {n}', { m: model || t('модель по умолчанию'), n: p.cand[0] || t('модель по умолчанию') }) });
        continue;
      }
      p.alive = false;
      ev({ type: 'part', pid: p.id, stage, status: 'error', error: String(r.error || t('ошибка')).slice(0, 300), end: Date.now() });
      return null;
    }
    p.alive = false;
    return null;
  }
  const alive = () => parts.filter(p => p.alive);
  const need = (n = 1) => { if (alive().length < n) throw Object.assign(new Error(t('В Арене не осталось участников — все агенты завершились с ошибкой.')), { code: 'arena' }); };

  // 1. бриф
  ev({ type: 'stage', stage: 'brief' });
  const ctx = [opts.memory ? `USER PREFERENCES (from Synapse):\n${clip(opts.memory, 2500)}` : '', opts.history ? `RECENT CONVERSATION:\n${clip(opts.history, 4000)}` : ''].filter(Boolean).join('\n\n');
  let brief = disp ? await step(disp, 'brief', P.brief(text, ctx), { effort: 'low' }) : null;
  brief = clip(brief || text, 6000);
  ev({ type: 'brief', text: brief });

  // 2. планы
  ev({ type: 'stage', stage: 'plan' });
  const name = (p) => `${p.label}${p.model ? ` (${p.model})` : ''}`;
  // у участника есть своя сессия: бриф и его план уже в ней — не пересылаем (экономия токенов)
  const inSession = (p) => !!p.session && cli.RESUMABLE.has(p.agent);
  await Promise.all(parts.map(async p => {
    const out = await step(p, 'plan', P.plan(name(p), parts.length, brief), { effort: bigEffort, access: p.agent === 'codex' ? 'read' : settings.agentAccess });
    if (out) { p.plan = clip(out, 5000); ev({ type: 'plan', pid: p.id, round: 0, text: p.plan }); }
  }));
  need(1);

  // 3. спор
  let objections = {};
  if (alive().length > 1) {
    for (let round = 1; round <= R.rounds; round++) {
      ev({ type: 'stage', stage: 'debate', round });
      const live = alive();
      const res = await Promise.all(live.map(async p => {
        const others = live.filter(o => o !== p).map(o => `### ${name(o)}\n${o.plan}`).join('\n\n');
        const out = await step(p, 'debate', P.debate(name(p), round, R.rounds, inSession(p) ? null : p.plan, others), { effort: bigEffort, access: p.agent === 'codex' ? 'read' : settings.agentAccess });
        if (!out) return null;
        const j = lastJson(out) || {};
        const agree = j.agree === true;
        p.plan = clip(stripJson(out), 5000);
        objections[p.id] = Array.isArray(j.objections) ? j.objections.slice(0, 8).map(String) : [];
        ev({ type: 'plan', pid: p.id, round, text: p.plan, agree, objections: objections[p.id] });
        return agree;
      }));
      need(1);
      const votes = res.filter(v => v !== null);
      if (votes.length && votes.every(Boolean)) { ev({ type: 'consensus', round }); break; }
      if (alive().length < 2) break;
    }
  }

  // 4. код — каждый в своей копии
  ev({ type: 'stage', stage: 'build' });
  const allObj = (p) => Object.entries(objections).filter(([id]) => id !== p.id).flatMap(([, list]) => list).map(o => `- ${o}`).join('\n');
  await Promise.all(alive().map(async p => {
    const out = await step(p, 'build', P.build(inSession(p) ? null : brief, inSession(p) ? null : p.plan, allObj(p)), { effort: bigEffort });
    if (out) { p.summary = clip(out, 3000); p.files = changes(snap, p.dir); ev({ type: 'built', pid: p.id, summary: p.summary, files: p.files.map(f => ({ rel: f.rel, kind: f.kind })) }); }
  }));
  need(1);
  for (const p of alive()) if (!p.files?.length) { p.alive = false; ev({ type: 'part', pid: p.id, stage: 'build', status: 'error', error: t('Вариант без изменений в файлах') }); }
  need(1);
  // варианты, которые участвуют в сравнении (сбой при голосовании их не исключает)
  const built = alive();

  // 5. голосование — анонимно, за себя не голосуют
  let winner = built[0];
  const scores = {}; // pid -> [оценки]
  const fixes = {};  // pid -> [правки]
  const avg = (id) => (scores[id]?.length ? scores[id].reduce((a, b) => a + b, 0) / scores[id].length : -1);
  if (built.length > 1) {
    ev({ type: 'stage', stage: 'vote' });
    const live = built;
    await Promise.all(live.map(async voter => {
      const others = live.filter(o => o !== voter);
      const letters = others.map((_, i) => String.fromCharCode(65 + i));
      const variants = others.map((o, i) => `## Variant ${letters[i]}\nSummary from its author:\n${clip(o.summary, 800)}\n\n${variantText(cwd, o.dir, o.files, Math.floor(36000 / others.length))}`).join('\n\n');
      const out = await step(voter, 'vote', P.vote(inSession(voter) ? null : brief, variants, letters), { effort: 'high', access: voter.agent === 'codex' ? 'read' : settings.agentAccess });
      const j = lastJson(out) || {};
      const given = {};
      others.forEach((o, i) => {
        const s = Number(j.scores?.[letters[i]]);
        if (Number.isFinite(s)) { (scores[o.id] = scores[o.id] || []).push(Math.max(0, Math.min(10, s))); given[o.id] = s; }
        const f = j.fixes?.[letters[i]];
        if (Array.isArray(f)) (fixes[o.id] = fixes[o.id] || []).push(...f.slice(0, 8).map(String));
      });
      if (out) ev({ type: 'vote', pid: voter.id, given, note: clip(stripJson(out), 1200) });
    }));
    // при равенстве — модель выше в рейтинге (раньше в списке)
    winner = [...built].sort((a, b) => avg(b.id) - avg(a.id) || parts.indexOf(a) - parts.indexOf(b))[0];
    ev({ type: 'scores', scores: Object.fromEntries(built.map(p => [p.id, avg(p.id)])), winner: winner.id });
  } else {
    ev({ type: 'scores', scores: {}, winner: winner.id });
  }

  // 6. доработка победителя
  const winFixes = [...new Set(fixes[winner.id] || [])].map(f => `- ${f}`).join('\n');
  const runnerUp = built.filter(p => p !== winner).sort((a, b) => avg(b.id) - avg(a.id))[0];
  let finalText = winner.summary;
  if (built.length > 1) {
    ev({ type: 'stage', stage: 'polish' });
    const out = await step(winner, 'polish', P.polish(winFixes, runnerUp ? clip(runnerUp.summary, 600) : ''), { effort: opts.input.ultra ? 'max' : 'high' });
    if (out) finalText = out; // если доработка не удалась — остаётся вариант до неё
  }

  // 7. итог
  ev({ type: 'stage', stage: 'result' });
  const files = changes(snap, winner.dir).map(f => fileDiff(cwd, winner.dir, f));
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
  meta.winner = winner.id;
  meta.variants = Object.fromEntries(parts.map(p => [p.id, { dir: p.dir, model: p.model, agent: p.agent }]));
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta));
  ev({ type: 'result', runId, winner: winner.id, dir: winner.dir,
    files: files.map(f => ({ rel: f.rel, kind: f.kind, add: f.add || 0, del: f.del || 0, diff: clip(f.diff, 12000) })),
    variants: parts.map(p => ({ id: p.id, dir: p.dir, files: (p.files || []).length, alive: built.includes(p) })) });

  return { text: finalText, usage: total, winner, runId };
}

// ---------- применение итога ----------
function readMeta(root, runId) {
  if (!/^[at][a-z0-9]+$/.test(runId || '')) throw new Error('bad run id');
  return JSON.parse(fs.readFileSync(path.join(root, runId, 'meta.json'), 'utf8'));
}
/** Перенести вариант в папку пользователя. Без force — сначала проверка, не менялись ли файлы с начала Арены. */
function apply(root, runId, pid, force) {
  const meta = readMeta(root, runId);
  const id = pid || meta.winner;
  const v = meta.variants?.[id];
  if (!v) throw new Error('variant not found');
  const files = changes(meta.snap, v.dir);
  const conflicts = [];
  for (const f of files) {
    const real = path.join(meta.cwd, ...f.rel.split('/'));
    const now = fs.existsSync(real) ? hashFile(real) : null;
    const was = meta.snap[f.rel] ?? null;
    if (now !== was) conflicts.push(f.rel);
  }
  if (conflicts.length && !force) return { ok: false, conflicts };
  for (const f of files) {
    const real = path.join(meta.cwd, ...f.rel.split('/'));
    if (!path.resolve(real).startsWith(path.resolve(meta.cwd))) continue;
    if (f.kind === 'del') { fs.rmSync(real, { force: true }); continue; }
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.copyFileSync(path.join(v.dir, ...f.rel.split('/')), real);
  }
  meta.applied = { pid: id, at: Date.now() };
  fs.writeFileSync(path.join(root, runId, 'meta.json'), JSON.stringify(meta));
  return { ok: true, count: files.length };
}
/** Файлы и diff любого варианта — для просмотра проигравших. */
function variantFiles(root, runId, pid) {
  const meta = readMeta(root, runId);
  const v = meta.variants?.[pid];
  if (!v) throw new Error('variant not found');
  return changes(meta.snap, v.dir).map(f => fileDiff(meta.cwd, v.dir, f)).map(f => ({ ...f, diff: clip(f.diff, 12000) }));
}
function variantDir(root, runId, pid) {
  const meta = readMeta(root, runId);
  return meta.variants?.[pid || meta.winner]?.dir || null;
}
// храним последние N прогонов
function cleanup(root, keep) {
  try {
    const dirs = fs.readdirSync(root).filter(d => /^[at][a-z0-9]+$/.test(d)).sort((a, b) => a.slice(1).localeCompare(b.slice(1)));
    for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  } catch { /* папки ещё нет */ }
}

module.exports = { run, roster, apply, variantFiles, variantDir, unified, lastJson, changes, snapshot,
  copyTree, fileDiff, cleanup, candidatesFor, addUsage, stripJson, clip, MODEL_MISSING, BIG_AGENTS };
