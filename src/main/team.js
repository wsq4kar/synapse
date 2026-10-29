// Команда: несколько нейросетей вместе пишут один проект.
// В отличие от Арены (все делают одну задачу и соревнуются), здесь работа делится:
// ведущий планирует и раздаёт части → участники параллельно пишут каждый свою часть в общей копии папки →
// ведущий собирает и чинит швы → другая модель делает ревью → ведущий исправляет → «Применить».
const fs = require('fs');
const path = require('path');
const cli = require('./executors/cli');
const catalog = require('./catalog');
const arena = require('./arena');
const { t } = require('./i18n');

const { snapshot, copyTree, changes, fileDiff, cleanup, candidatesFor, addUsage, lastJson, stripJson, clip, MODEL_MISSING, BIG_AGENTS } = arena;
const DEFAULTS = { max: 3, review: true, junior: true, lead: null };
const cfgOf = (settings) => ({ ...DEFAULTS, ...(settings.teamCfg || {}) });
const ROLE = { lead: 'lead', dev: 'dev', junior: 'junior' };

/** Состав: ведущий (сильнейшая модель или выбранная), разработчики (по одному на агента), младший — бесплатная модель OpenCode. */
function roster(settings, agents) {
  const cfg = cfgOf(settings);
  const installed = new Set((agents || []).filter(a => a.installed).map(a => a.id));
  const list = catalog.get().arena || [];
  const members = [];
  if (cfg.lead?.agent && installed.has(cfg.lead.agent)) members.push({ agent: cfg.lead.agent, model: cfg.lead.model || null });
  for (const m of list.filter(x => x.tier === 'big' && BIG_AGENTS.includes(x.agent) && installed.has(x.agent))) {
    if (members.length >= Math.max(1, Math.min(4, cfg.max))) break;
    if (!members.some(b => b.agent === m.agent)) members.push({ agent: m.agent, model: m.model });
  }
  if (cfg.junior !== false && installed.has('opencode')) {
    const j = list.find(x => x.agent === 'opencode' && x.tier === 'small');
    members.push({ agent: 'opencode', model: j?.model || null, junior: true });
  }
  return {
    members: members.map((m, i) => ({ id: `m${i + 1}`, agent: m.agent, model: m.model, label: cli.LABELS[m.agent], role: i === 0 ? ROLE.lead : m.junior ? ROLE.junior : ROLE.dev })),
    review: cfg.review !== false,
    cfg,
  };
}

// ---------- промпты ----------
const LANG = 'Write your answer in the same language as the user task.';
const who = (m) => `${m.id} — ${m.label}${m.model ? ` (${m.model})` : ''}${m.role === ROLE.lead ? ', team lead' : m.role === ROLE.junior ? ', junior: give it simple routine work (boilerplate, docs, small helpers, test data)' : ''}`;
const P = {
  plan: (task, team, ctx) => `You are the team lead in Synapse Team mode. Several AI engineers will build this task TOGETHER in one shared folder, in parallel.
Do NOT modify files now. Study the project in the current folder, then:
1. Write "## Plan": the approach and the target file layout.
2. Write "## Contracts": everything the parts need to agree on — module boundaries, function/class signatures, data formats, events, CSS class names, file paths. Be concrete: the engineers will code against it without talking to each other.
3. Split the work into 2–8 tasks. Each task has an owner and a DISJOINT set of files (two tasks must never edit the same file). Put tasks that depend on others in "after". Use each engineer's strengths. Small tasks can stay with you.
TEAM:
${team}
${LANG}
On the very last line output only a JSON object:
{"tasks": [{"id": "t1", "title": "short title", "owner": "m1", "files": ["path/a.js"], "details": "what exactly to do", "after": []}]}
${ctx ? `\n${ctx}\n` : ''}
USER TASK:
${task}`,

  work: (m, task, teamFile, notesFile) => `You are ${m.label}${m.model ? ` (${m.model})` : ''}, engineer ${m.id} in a Synapse team. Other engineers are editing OTHER files in this same folder right now.
First read ${teamFile} — the plan and the contracts you must follow.
YOUR TASK ${task.id}: ${task.title}
${task.details || ''}
FILES YOU OWN: ${task.files?.length ? task.files.join(', ') : '(choose new files that do not belong to other tasks)'}
Rules:
- Edit only the files you own (create them if needed). Do not touch other files.
- If you need a change in someone else's file or the contracts are not enough, write it down in ${notesFile} (create it) — the lead will see it.
- No destructive git commands, do not reformat the project.
Finish with a short summary of what you did (max 120 words) and anything the others must know. ${LANG}`,

  integrate: (status, notes) => `You are the team lead. The engineers have finished their tasks in this folder.
TASK STATUS:
${status}
${notes ? `\nMESSAGES FROM THE ENGINEERS:\n${notes}\n` : ''}
Now integrate: check that the parts fit the contracts and each other, wire them together, finish anything a failed task left undone, fix the seams, and run the project's build or tests if there are any.
Finish with a short summary (max 150 words). ${LANG}`,

  review: (task, diff) => `Code review in Synapse Team mode. Do NOT modify files. Below is the team's change to the project (diff against the original).
Check it against the user task: correctness, missing pieces, broken integration between parts, obvious bugs and risks.
Write a short review, then on the very last line output only a JSON object:
{"ok": true or false, "issues": ["concrete issue with file and fix", "..."]}
${LANG}
USER TASK:
${task}

CHANGES:
${diff}`,

  fix: (issues) => `The reviewer found these issues — fix them in place in the current folder:
${issues}
Then give the final summary for the user: what the team built, who did what and how to use or check it (max 200 words). Write it in the same language as the original task.`,
};

const TEAM_DIR = path.join('.synapse', 'team');
// убрать служебный JSON в конце ответа (план задач, итог ревью)
function stripTail(text) {
  let s = String(text || '').replace(/```json[\s\S]*?```\s*$/i, '').trimEnd();
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    if (i > 0 && s[i - 1] !== '\n') continue;
    try { JSON.parse(s.slice(i)); return s.slice(0, i).trimEnd(); } catch { /* не JSON — ищем раньше */ }
  }
  return stripJson(s);
}

/** opts: { input, settings, agents, text, history, memory, cwd, root, extraEnv, signal, emit } */
async function run(opts) {
  const { settings, agents, text, cwd, root, extraEnv, signal, emit } = opts;
  const R = roster(settings, agents);
  if (!R.members.length) throw Object.assign(new Error(t('Для Команды нужен хотя бы один установленный агент: Claude Code, Codex или Antigravity.')), { code: 'team' });
  const avail = (agent) => (agents || []).find(a => a.id === agent)?.models || null;

  const runId = `t${Date.now().toString(36)}`;
  const runDir = path.join(root, runId);
  cleanup(root, 10);
  fs.mkdirSync(runDir, { recursive: true });
  const work = path.join(runDir, 'work');
  const ev = (o) => emit({ kind: 'team', ...o });
  const bigEffort = opts.input.ultra ? 'max' : 'xhigh';
  const devEffort = opts.input.ultra ? 'max' : 'high';
  const total = {};
  const members = R.members.map(m => ({ ...m, cand: candidatesFor(m.agent, m.model, m.role === ROLE.junior ? 'small' : 'big', avail(m.agent)), session: null, alive: true, usage: {} }));
  const lead = members[0];

  ev({ type: 'init', runId, cwd, review: R.review, members: members.map(m => ({ id: m.id, agent: m.agent, model: m.model, label: m.label, role: m.role })) });

  ev({ type: 'stage', stage: 'copy' });
  const snap = snapshot(cwd);
  copyTree(cwd, work);
  fs.mkdirSync(path.join(work, TEAM_DIR), { recursive: true });
  const metaFile = path.join(runDir, 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ cwd, snap, at: Date.now(), team: true, winner: 'team', variants: { team: { dir: work, agent: lead.agent, model: lead.model } } }));

  // один шаг участника; сессии не продолжаем между задачами — у каждой задачи свой контекст
  async function step(m, stage, prompt, { effort, access = settings.agentAccess, keep = false, taskId } = {}) {
    if (signal.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
    ev({ type: 'member', mid: m.id, status: 'run', stage, task: taskId || null, at: Date.now() });
    while (m.cand.length) {
      const model = m.cand[0];
      const r = await cli.run({
        id: m.agent, bin: cli.binFor(m.agent, settings.cliPaths), cwd: work, prompt, access,
        sessionId: keep && cli.RESUMABLE.has(m.agent) ? m.session : null,
        model, effort, ultra: false, extraEnv, signal,
        onEvent: (e) => {
          if (e.kind === 'step' && e.title) {
            const act = `${e.title}${e.detail ? ' ' + e.detail : ''}`.slice(0, 140);
            ev({ type: 'member', mid: m.id, activity: act });
            if (taskId) ev({ type: 'task', id: taskId, activity: act });
          }
          if (e.kind === 'limits') emit(e);
        },
      });
      if (r.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
      addUsage(m.usage, r.usage); addUsage(total, r.usage);
      if (r.ok) {
        if (r.sessionId) m.session = r.sessionId;
        if (model !== m.model) { m.model = model; ev({ type: 'model', mid: m.id, model }); }
        ev({ type: 'member', mid: m.id, status: 'idle', stage, end: Date.now() });
        return r.text;
      }
      if (MODEL_MISSING.test(r.error || '') && m.cand.length > 1) {
        m.cand.shift(); m.session = null;
        ev({ type: 'member', mid: m.id, activity: t('{m} недоступна — пробую {n}', { m: model || t('модель по умолчанию'), n: m.cand[0] || t('модель по умолчанию') }) });
        continue;
      }
      m.alive = false;
      ev({ type: 'member', mid: m.id, status: 'error', stage, error: String(r.error || t('ошибка')).slice(0, 300), end: Date.now() });
      return null;
    }
    m.alive = false;
    return null;
  }

  // 1. план ведущего
  ev({ type: 'stage', stage: 'plan' });
  const ctx = [opts.memory ? `USER PREFERENCES (from Synapse):\n${clip(opts.memory, 2500)}` : '', opts.history ? `RECENT CONVERSATION:\n${clip(opts.history, 4000)}` : ''].filter(Boolean).join('\n\n');
  const planOut = await step(lead, 'plan', P.plan(text, members.map(who).join('\n'), ctx), { effort: bigEffort, access: 'read' });
  if (!planOut) throw Object.assign(new Error(t('Ведущий не смог составить план — проверьте агента {a}.', { a: lead.label })), { code: 'team' });
  const plan = clip(stripTail(planOut), 9000);
  const ids = new Set(members.map(m => m.id));
  let tasks = (lastJson(planOut)?.tasks || []).filter(x => x && x.title).slice(0, 10).map((x, i) => ({
    id: /^[\w-]{1,12}$/.test(String(x.id)) ? String(x.id) : `t${i + 1}`,
    title: clip(String(x.title), 140),
    owner: ids.has(String(x.owner)) ? String(x.owner) : lead.id,
    files: (Array.isArray(x.files) ? x.files : []).map(String).filter(f => f && !/(^|[\\/])\.\.([\\/]|$)/.test(f)).slice(0, 30),
    details: clip(String(x.details || ''), 2500),
    after: (Array.isArray(x.after) ? x.after : []).map(String),
    status: 'wait',
  }));
  // уникальные id задач
  const seen = new Set();
  tasks.forEach((x, i) => { if (seen.has(x.id)) x.id = `t${i + 1}x`; seen.add(x.id); });
  if (!tasks.length) tasks = [{ id: 't1', title: clip(text.split('\n')[0], 140), owner: lead.id, files: [], details: text, after: [], status: 'wait' }];
  ev({ type: 'plan', text: plan });
  ev({ type: 'tasks', tasks: tasks.map(({ id, title, owner, files, after, status }) => ({ id, title, owner, files, after, status })) });

  // TEAM.md — общий файл с планом, контрактами и сообщениями
  const teamRel = `${TEAM_DIR.replace(/\\/g, '/')}/TEAM.md`;
  const teamFile = path.join(work, TEAM_DIR, 'TEAM.md');
  const notes = [];
  const writeTeam = () => fs.writeFileSync(teamFile, [
    `# ${t('Команда Synapse')}`, '', `## ${t('Задача')}`, text, '', plan, '',
    `## ${t('Задачи')}`, ...tasks.map(x => `- [${x.status === 'done' ? 'x' : ' '}] ${x.id} · ${x.title} — ${members.find(m => m.id === x.owner)?.label || x.owner}${x.files.length ? ` · ${x.files.join(', ')}` : ''}`),
    '', `## ${t('Сообщения')}`, ...(notes.length ? notes.map(n => `- **${n.from}** (${n.task}): ${n.text.replace(/\n+/g, ' ')}`) : ['—']), '',
  ].join('\n'), 'utf8');
  writeTeam();
  const readNotes = (m, task) => {
    const f = path.join(work, TEAM_DIR, `notes-${m.id}.md`);
    let s = '';
    try { s = fs.readFileSync(f, 'utf8').trim(); fs.rmSync(f, { force: true }); } catch { /* заметок нет */ }
    if (!s) return;
    const n = { from: `${m.label}${m.model ? ` · ${m.model}` : ''}`, mid: m.id, task: task.id, text: clip(s, 1500) };
    notes.push(n);
    ev({ type: 'note', ...n });
  };

  // 2. параллельная работа: у каждого участника своя очередь, задачи ждут свои «after»
  ev({ type: 'stage', stage: 'work' });
  const byId = new Map(tasks.map(x => [x.id, x]));
  const finished = (x) => x.status === 'done' || x.status === 'error';
  const ready = (x) => x.status === 'wait' && x.after.every(d => !byId.has(d) || finished(byId.get(d)));
  const owner = (x) => members.find(m => m.id === x.owner);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let running = 0;
  async function worker(m) {
    for (;;) {
      if (signal.aborted) throw Object.assign(new Error(t('Остановлено')), { code: 'aborted' });
      const mine = tasks.filter(x => x.owner === m.id && x.status === 'wait');
      if (!mine.length) return;
      let task = mine.find(ready);
      // зависимости по кругу или от упавших задач — не ждём вечно
      if (!task && running === 0 && !tasks.some(x => x.status === 'wait' && ready(x))) task = mine[0];
      if (!task) { await sleep(400); continue; }
      task.status = 'run'; running++;
      ev({ type: 'task', id: task.id, status: 'run', owner: m.id, at: Date.now() });
      const out = await step(m, 'work', P.work(m, task, teamRel, `${TEAM_DIR.replace(/\\/g, '/')}/notes-${m.id}.md`), { effort: m.role === ROLE.junior ? null : devEffort, taskId: task.id });
      running--;
      readNotes(m, task);
      if (out) { task.status = 'done'; task.summary = clip(out, 1200); ev({ type: 'task', id: task.id, status: 'done', summary: task.summary, end: Date.now() }); }
      else {
        task.status = 'error';
        ev({ type: 'task', id: task.id, status: 'error', error: t('Не выполнено — доделает ведущий'), end: Date.now() });
        // участник выбыл: его оставшиеся задачи переходят к ведущему (или к другому живому)
        const heir = lead.alive && lead !== m ? lead : members.find(x => x.alive && x !== m);
        for (const x of tasks.filter(y => y.owner === m.id && y.status === 'wait')) {
          if (!heir) break;
          x.owner = heir.id;
          ev({ type: 'task', id: x.id, owner: heir.id });
        }
        if (heir && !members.some(x => x === heir && x._working)) startWorker(heir);
        return;
      }
      writeTeam();
    }
  }
  const workers = [];
  function startWorker(m) { m._working = true; workers.push(worker(m).finally(() => { m._working = false; })); }
  for (const m of members) if (tasks.some(x => x.owner === m.id)) startWorker(m);
  for (let i = 0; i < workers.length; i++) await workers[i]; // список может расти, пока ждём
  writeTeam();
  if (!members.some(m => m.alive)) throw Object.assign(new Error(t('В Команде не осталось участников — все агенты завершились с ошибкой.')), { code: 'team' });

  // 3. сборка ведущим
  const integrator = lead.alive ? lead : members.find(m => m.alive && m.role !== ROLE.junior) || members.find(m => m.alive);
  ev({ type: 'stage', stage: 'integrate' });
  const status = tasks.map(x => `- ${x.id} ${x.title} (${owner(x)?.label || x.owner}): ${x.status === 'done' ? `done — ${clip(x.summary, 400)}` : 'NOT DONE'}`).join('\n');
  let finalText = await step(integrator, 'integrate', P.integrate(status, notes.map(n => `- ${n.from} (${n.task}): ${n.text}`).join('\n')), { effort: bigEffort });
  finalText = finalText || tasks.filter(x => x.summary).map(x => x.summary).join('\n\n');

  // 4. ревью другой моделью и исправления
  const reviewer = R.review ? members.find(m => m.alive && m !== integrator && m.role !== ROLE.junior) : null;
  if (reviewer) {
    ev({ type: 'stage', stage: 'review' });
    const files = changes(snap, work).map(f => fileDiff(cwd, work, f));
    const diff = clip(files.map(f => `### ${f.rel} (${f.kind})\n${f.diff || ''}`).join('\n\n'), 40000);
    const out = await step(reviewer, 'review', P.review(text, diff || '(no changes)'), { effort: 'high', access: 'read' });
    const j = lastJson(out) || {};
    const issues = Array.isArray(j.issues) ? j.issues.slice(0, 12).map(String) : [];
    ev({ type: 'review', mid: reviewer.id, ok: j.ok === true || !issues.length, issues, note: clip(stripTail(out), 1500) });
    if (issues.length && integrator.alive) {
      ev({ type: 'stage', stage: 'fix' });
      const fixed = await step(integrator, 'fix', P.fix(issues.map(x => `- ${x}`).join('\n')), { effort: devEffort });
      if (fixed) finalText = fixed;
    }
  }

  // 5. итог
  ev({ type: 'stage', stage: 'result' });
  const files = changes(snap, work).map(f => fileDiff(cwd, work, f));
  ev({ type: 'result', runId, dir: work,
    files: files.map(f => ({ rel: f.rel, kind: f.kind, add: f.add || 0, del: f.del || 0, diff: clip(f.diff, 12000) })),
    usage: Object.fromEntries(members.map(m => [m.id, m.usage])) });
  return { text: finalText, usage: total, lead: integrator, runId };
}

module.exports = { run, roster, P };
