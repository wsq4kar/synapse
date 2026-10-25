/* Synapse — интерфейс */
const api = window.synapse;
const t = (s, v) => I18N.t(s, v);
// «Изображение · модель» → переводим часть до точки
const tl = (label) => String(label || '').replace(/^([^·]+?)(\s·|$)/, (_, a, b) => t(a) + b);
const { icon, hydrate } = window.Icons;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const plural = (n, [one, few, many]) => { if (I18N.lang === 'en') return n === 1 ? one : few; const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const fmtSec = (s) => I18N.lang === 'en' ? (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`) : (s < 60 ? `${s} ${t('с')}` : `${Math.floor(s / 60)} ${t('мин')} ${s % 60} ${t('с')}`);
const shortPath = (p) => (p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || p;
const ULTRA_RE = /(^|[^\p{L}\d])(ultrathink|ultra|ультра)(?=$|[^\p{L}\d])/giu;

const MODES = {
  auto:  { get label() { return t('Авто'); }, icon: 'sparkles', get hint() { return t('сам выберет'); } },
  chat:  { get label() { return t('Чат'); }, icon: 'message', hint: 'Gemini' },
  code:  { get label() { return t('Код'); }, icon: 'code', get hint() { return t('агент в папке'); } },
  image: { get label() { return t('Изображение'); }, icon: 'image', hint: 'Nano Banana' },
  video: { get label() { return t('Видео'); }, icon: 'video', hint: 'Veo' },
};
// Сервисы: значок грузится с официального сайта (favicon), без сети — буква
const PROVIDERS = {
  claude: { name: 'Claude Code', domain: 'claude.ai', mono: 'C' },
  codex: { name: 'Codex', domain: 'openai.com', mono: 'O' },
  antigravity: { name: 'Antigravity', domain: 'antigravity.google', mono: 'A' },
  opencode: { name: 'OpenCode', domain: 'opencode.ai', mono: 'oc' },
  gemini: { name: 'Gemini', domain: 'gemini.google.com', mono: 'G' },
  openrouter: { name: 'OpenRouter', domain: 'openrouter.ai', mono: 'OR' },
  'gemini-cli': { name: 'Gemini CLI', domain: 'gemini.google.com', mono: 'G' }, // старые сообщения
};
function provIcon(id, cls = '') {
  const p = PROVIDERS[id];
  if (!p) return `<span class="prov-ic auto ${cls}">${icon('sparkles')}</span>`;
  return `<img class="prov-ic ${cls}" src="https://www.google.com/s2/favicons?domain=${p.domain}&sz=64" data-mono="${p.mono}" alt="" draggable="false">`;
}
// исполнитель по сохранённому сообщению
const provOf = (m) => m.executor === 'gemini' || !m.executor ? (m.route === 'code' ? null : 'gemini') : m.executor;
// красивое имя модели: gemini-2.5-flash → Gemini 2.5 Flash, gpt-5-codex → GPT-5 Codex
function prettyModel(id) {
  if (!id) return '';
  if (/\//.test(id)) return prettyModel(String(id).split('/').pop().replace(/-free$/i, '')) + (/-free$/i.test(id) ? ' · free' : '');
  const c = String(id).match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?$/i);
  if (c) return c[1].charAt(0).toUpperCase() + c[1].slice(1) + ' ' + c[2] + (c[3] ? '.' + c[3] : '');
  const g = String(id).match(/^gpt-([\d.]+)(?:-(.+))?$/i);
  if (g) return 'GPT-' + g[1] + (g[2] ? ' ' + g[2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');
  return String(id).replace(/-(preview|latest|exp)(-[\d-]+)?$/i, '').split('-')
    .map(w => /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const MODEL_ID = /^~?[\w.\-:]+(\/~?[\w.\-:]+){0,2}$/;
const listModels = (str) => String(str || '').split(',').map(x => x.trim()).filter(x => MODEL_ID.test(x));
// Модели агента: свои из настроек → обнаруженные самим CLI (Antigravity) → models.json
function agentModels(a) {
  const own = listModels(state.settings.cliModels?.[a.id]);
  const found = (a.models || []).filter(x => MODEL_ID.test(x));
  const file = state.settings.catalog?.agents?.[a.id] || [];
  return [...new Set([...own, ...(found.length ? found : file)])];
}
// Модели OpenRouter для меню чата: выбранные в настройках + список из models.json
function orChatModels() {
  const c = state.settings.catalog?.openrouter || {}, o = state.settings.openrouter || {};
  return [...new Set([o.chat || c.chat, o.chatUltra || c.chatUltra, ...(c.list || [])].filter(Boolean))];
}
// Сессии агентов в чате (старые чаты: claudeSession / opencodeSession)
function chatSessions(chat) {
  const s = { ...(chat.sessions || {}) };
  if (!s.claude && chat.claudeSession) s.claude = chat.claudeSession;
  if (!s.opencode && chat.opencodeSession) s.opencode = chat.opencodeSession;
  return s;
}
function resetSessions(chat) { chat.sessions = {}; chat.claudeSession = null; chat.opencodeSession = null; }
let geminiModelsCache = null;
async function geminiChatModels() {
  if (!geminiModelsCache && state.settings.hasKey) {
    try {
      const ver = (id) => parseFloat((id.match(/-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      geminiModelsCache = (await api.models.list())
        .filter(m => m.methods.includes('generateContent') && /^gemini-[\d.]+-(pro|flash)(-lite)?(-preview)?$/i.test(m.id))
        .map(m => m.id).sort((a, b) => ver(b) - ver(a));
    } catch { geminiModelsCache = []; }
  }
  return geminiModelsCache || [];
}

const ROUTE_ICON = { chat: 'message', code: 'code', image: 'image', video: 'video' };
const ROUTE_NAME = { get chat() { return t('Чат'); }, get code() { return t('Код'); }, get image() { return t('Изображение'); }, get video() { return t('Видео'); } };

const state = {
  settings: null, agents: [], chats: [], projects: [], limits: loadLimits(), tunnel: null,
  cache: new Map(),
  view: { type: 'chat', id: null },
  hist: [], hpos: -1,
  tab: 'chat', mode: 'auto',
  attachments: [],
  tasks: new Map(),   // taskId -> { chatId, msgId, started }
  queue: new Map(),   // chatId -> [{ id, text, mode, images, ultra }]
  search: '',
};

let ascii = null, pets = null;
marked.setOptions({ gfm: true, breaks: true });

/* ================= Старт ================= */
async function init() {
  hydrate();
  state.settings = await api.settings.get();
  I18N.set(state.settings.lang);
  document.body.classList.add('platform-' + state.settings.platform);
  applyTheme(state.settings.theme);
  applyLook();
  if (state.settings.sidebarCollapsed) $('#app').classList.add('side-collapsed');
  $('#main').classList.toggle('show-progress', !!state.settings.progressPanel);
  renderAccount();

  ascii = new AsciiField($('#ascii'));
  ascii.setUltra(!!state.settings.ultra);
  pets = new Pets.PetWorld($('#petsLayer'), petBounds);
  Workbench.init({ api, t, icon, esc, toast, saveSettings, settings: () => state.settings });
  applyPets();

  Extensions.init({
    api, t, esc, icon, provIcon, toast, menu, cleanErr, PROVIDERS,
    cwd: () => { const c = state.view.type === 'chat' ? currentChat() : null; return c?.cwd || null; },
    fmtNum: (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)),
  });
  bindUI();
  await Promise.all([refreshChats(), refreshProjects()]);
  newChat('chat', { push: true, focus: true });
  updateKeyBanner();
  detectAgents();
  api.task.onEvent(onTaskEvent);
  api.tunnel.onStatus(onTunnelStatus);
  api.tunnel.status().then(st => { state.tunnel = st; }).catch(() => {});
  setInterval(tickTimers, 1000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => ascii.refreshTheme());
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  ascii?.refreshTheme();
}
const LOOK_DEF = { font: 'system', size: 'm', accent: 'teal', width: 'm', motion: 'system', send: 'enter', bubbles: true };
const look = () => ({ ...LOOK_DEF, ...(state.settings.look || {}) });
const FONT_SIZE = { s: '13.5px', m: '14.5px', l: '16px', xl: '17.5px' };
const COL_W = { s: '680px', m: '780px', l: '980px' };
function applyLook() {
  const l = look(), r = document.documentElement;
  if (l.font && l.font !== 'system') r.dataset.font = l.font; else delete r.dataset.font;
  if (l.accent && l.accent !== 'teal') r.dataset.accent = l.accent; else delete r.dataset.accent;
  r.dataset.bubbles = l.bubbles === false ? 'off' : 'on';
  r.style.setProperty('--chat-fs', FONT_SIZE[l.size] || FONT_SIZE.m);
  r.style.setProperty('--col', COL_W[l.width] || COL_W.m);
  r.classList.toggle('rm', l.motion === 'reduce');
  ascii?.refreshTheme?.();
}
async function setLook(patch) { const sb = $('#settingsBody'), y = sb?.scrollTop || 0; await saveSettings({ look: { ...look(), ...patch } }); applyLook(); await renderSettings(); if (sb) sb.scrollTop = y; }
function applyPets() {
  const p = state.settings.pets || {};
  pets.set(p.enabled ? (p.list || []) : []);
  $('#petsBtn').classList.toggle('on', !!p.enabled);
}
function petBounds() {
  const chatVisible = !$('#viewChat').classList.contains('hidden');
  if (chatVisible) {
    const r = $('#composer').getBoundingClientRect();
    return { floor: r.top + 1, minX: r.left + 16, maxX: r.right - 16, top: 0 };
  }
  const m = $('#main').getBoundingClientRect();
  return { floor: m.bottom - 2, minX: m.left + 24, maxX: m.right - 24, top: 0 };
}
function updateKeyBanner() { $('#keyBanner').classList.toggle('hidden', !!state.settings.hasKey || !!state.settings.hasOrKey || state.tab === 'code'); }

async function detectAgents(force) {
  state.agents = await api.cli.detect(!!force);
  const list = state.agents.map(a => ({ on: a.installed && a.loggedIn !== false, label: a.label + (a.installed && a.loggedIn === false ? ` (${t('нужен вход')})` : '') })).concat([{ on: !!state.settings.hasKey, label: 'Gemini API' }, { on: !!state.settings.hasOrKey, label: 'OpenRouter' }]);
  $('#agentDots').innerHTML = list.map(a => `<i class="${a.on ? 'on' : ''}" title="${esc(a.label)}: ${a.on ? t('готов') : t('нет')}"></i>`).join('');
  renderMeta();
  return state.agents;
}

/* ================= Навигация ================= */
function go(view, { push = true } = {}) {
  if (push) {
    state.hist = state.hist.slice(0, state.hpos + 1);
    const last = state.hist[state.hist.length - 1];
    if (!last || JSON.stringify(last) !== JSON.stringify(view)) { state.hist.push(view); state.hpos = state.hist.length - 1; }
  }
  state.view = view;
  if (view.type === 'chat') {
    const chat = state.cache.get(view.id);
    if (chat) setTab(chat.kind || 'chat', { silent: true });
  }
  closePopovers();
  render();
}
async function histStep(d) {
  const i = state.hpos + d;
  if (i < 0 || i >= state.hist.length) return;
  state.hpos = i;
  const v = state.hist[i];
  if (v.type === 'chat' && !state.cache.has(v.id)) await loadChat(v.id);
  if (v.type === 'chat' && !state.cache.has(v.id)) return histStep(d);
  go(v, { push: false });
}

function setTab(tab, { silent } = {}) {
  state.tab = tab;
  $('#tabs').dataset.on = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#navNew .lbl').textContent = tab === 'code' ? t('Новая сессия') : t('Новый чат');
  $('#recentLabel').textContent = tab === 'code' ? t('Сессии кода') : t('Недавние');
  updateKeyBanner();
  if (!silent) {
    // переключение вкладки — открываем черновик этой вкладки
    newChat(tab);
    return;
  }
  renderSidebar();
}

/* ================= Данные ================= */
async function refreshChats() { state.chats = await api.chats.list(); renderSidebar(); }
async function refreshProjects() { state.projects = await api.projects.list(); renderSidebar(); }
async function loadChat(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const chat = await api.chats.get(id);
  if (chat) { chat.kind = chat.kind || 'chat'; state.cache.set(id, chat); }
  return chat;
}
async function persist(chat) {
  if (!chat.messages.length) return;
  await api.chats.save(JSON.parse(JSON.stringify(chat)));
  const row = { id: chat.id, kind: chat.kind, title: chat.title, updatedAt: Date.now(), pinned: !!chat.pinned, projectId: chat.projectId || null, cwd: chat.cwd || null };
  state.chats = [row, ...state.chats.filter(c => c.id !== chat.id)];
  renderSidebar();
}
const currentChat = () => state.view.type === 'chat' ? state.cache.get(state.view.id) : null;
const projectOf = (chat) => chat?.projectId ? state.projects.find(p => p.id === chat.projectId) : null;
const isRunning = (chatId) => !!chatId && [...state.tasks.values()].some(x => x.chatId === chatId);

function newChat(kind = state.tab, { projectId = null, push = true, focus = true } = {}) {
  const project = projectId ? state.projects.find(p => p.id === projectId) : null;
  // переиспользуем пустой черновик той же вкладки
  let chat = [...state.cache.values()].find(c => c.kind === kind && !c.messages.length && (c.projectId || null) === projectId);
  if (!chat) {
    chat = { id: uid(), kind, title: '', createdAt: Date.now(), messages: [], cwd: project?.folder || null, projectId, executor: null, sessions: {}, todos: [] };
    state.cache.set(chat.id, chat);
  }
  state.mode = kind === 'code' ? 'code' : 'auto';
  go({ type: 'chat', id: chat.id }, { push });
  if (focus) setTimeout(() => $('#input').focus(), 30);
}

async function openChat(id) {
  const chat = await loadChat(id);
  if (!chat) return toast(t('Не удалось открыть чат'), true);
  state.mode = chat.kind === 'code' ? 'code' : 'auto';
  go({ type: 'chat', id });
}

/* ================= Сайдбар ================= */
function renderSidebar() {
  const q = state.search.trim().toLowerCase();
  const match = (x) => !q || (x || '').toLowerCase().includes(q);
  const busy = new Set([...state.tasks.values()].map(x => x.chatId));
  const curId = state.view.type === 'chat' ? state.view.id : null;
  let i = 0;
  const chatRow = (c, cls = '', withIcon = false) => `
    <div class="row-item ${cls} ${c.id === curId ? 'active' : ''}" data-chat="${c.id}" role="button" tabindex="0" style="--i:${Math.min(i++, 20)}">
      ${withIcon ? icon(c.kind === 'code' ? 'code' : 'message') : ''}
      <span class="t">${esc(c.title || t('Без названия'))}</span>
      ${busy.has(c.id) ? '<span class="busy"></span>' : ''}
      <button class="more" data-chat-more="${c.id}" title="${t('Ещё')}">${icon('more')}</button>
    </div>`;

  const pinnedProjects = state.projects.filter(p => p.pinned && match(p.name));
  const pinnedChats = state.chats.filter(c => c.pinned && match(c.title));
  const pinnedHtml = pinnedProjects.map(p => {
    const children = state.chats.filter(c => c.projectId === p.id).slice(0, 4);
    const active = state.view.type === 'project' && state.view.id === p.id;
    return `<div class="row-item ${active ? 'active' : ''}" data-project="${p.id}" role="button" tabindex="0" style="--i:${i++}">${icon('folder')}<span class="t">${esc(p.name)}</span></div>
      ${children.map(c => chatRow(c, 'child')).join('')}`;
  }).join('') + pinnedChats.map(c => chatRow(c, '', true)).join('');
  $('#pinnedSec').classList.toggle('hidden', !pinnedHtml);
  $('#pinnedList').innerHTML = pinnedHtml;

  const recents = state.chats.filter(c => (c.kind || 'chat') === state.tab && !c.pinned && match(c.title)).slice(0, 80);
  $('#recentList').innerHTML = recents.length ? recents.map(c => chatRow(c)).join('')
    : `<div class="list-empty">${q ? t('Ничего не найдено') : state.tab === 'code' ? t('Здесь будут сессии кода') : t('Здесь будут ваши чаты')}</div>`;

  $('#navProjects').classList.toggle('on', state.view.type === 'projects' || state.view.type === 'project');
  $('#navMedia').classList.toggle('on', state.view.type === 'media');
  $('#navStats').classList.toggle('on', state.view.type === 'stats');
  $('#navExt').classList.toggle('on', state.view.type === 'extensions');
  $('#backBtn').disabled = state.hpos <= 0;
  $('#fwdBtn').disabled = state.hpos >= state.hist.length - 1;
}

/* ================= Отрисовка ================= */
let lastPageKey = null;
function render() {
  const v = state.view;
  const main = $('#main');
  main.classList.toggle('tab-code', state.tab === 'code');
  main.classList.toggle('view-chat', v.type === 'chat');
  main.classList.toggle('no-ascii', !state.settings.asciiBg);
  ascii.setShape(state.tab === 'code' ? 'code' : 'logo');
  if (v.type === 'chat') {
    $('#viewChat').classList.remove('hidden');
    $('#viewPage').classList.add('hidden');
    renderChat(true);
  } else {
    $('#viewChat').classList.add('hidden');
    $('#viewPage').classList.remove('hidden');
    main.classList.remove('is-empty');
    main.classList.add('dim-ascii');
    ascii.setDim(true);
    // новая страница открывается сверху, а не с прокруткой предыдущей
    const key = `${v.type}:${v.id || ''}`;
    if (lastPageKey !== key) { $('#viewPage').scrollTop = 0; lastPageKey = key; }
    renderPage();
  }
  renderCrumbs();
  renderSidebar();
  renderProgress();
  Workbench.sync(v.type === 'chat' ? currentChat() : null);
}

function renderCrumbs() {
  const v = state.view;
  const el = $('#crumbs');
  if (v.type === 'chat') {
    const chat = currentChat();
    const p = projectOf(chat);
    const title = chat?.title || (chat?.kind === 'code' ? t('Новая сессия') : t('Новый чат'));
    el.innerHTML = `
      ${p ? `<button class="crumb-link" data-go-project="${p.id}">${esc(p.name)}</button><span class="crumb-sep">/</span>` : ''}
      ${chat?.messages.length
        ? `<button class="crumb-title" id="crumbTitle"><span>${esc(title)}</span>${icon('chevronDown')}</button>`
        : `<span class="crumb-plain">${esc(title)}</span>`}
      ${chat && isRunning(chat.id) ? ('<span class="crumb-dot" title="' + t('Выполняется') + '"></span>') : ''}`;
  } else if (v.type === 'projects') el.innerHTML = `<span class="crumb-plain">${t('Проекты')}</span>`;
  else if (v.type === 'project') {
    const p = state.projects.find(x => x.id === v.id);
    el.innerHTML = `<button class="crumb-link" data-go="projects">${t('Проекты')}</button><span class="crumb-sep">/</span><span class="crumb-plain">${esc(p?.name || '')}</span>`;
  } else if (v.type === 'media') el.innerHTML = `<span class="crumb-plain">${t('Медиа')}</span>`;
  else if (v.type === 'stats') el.innerHTML = `<span class="crumb-plain">${t('Статистика')}</span>`;
  else if (v.type === 'changelog') el.innerHTML = `<span class="crumb-plain">${t('Что нового')}</span>`;
  else if (v.type === 'extensions') el.innerHTML = `<span class="crumb-plain">${t('Расширения')}</span>`;
}

function renderChat(scrollBottom) {
  const chat = currentChat();
  if (!chat) return;
  const empty = !chat.messages.length && !(state.queue.get(chat.id) || []).length;
  const main = $('#main');
  main.classList.toggle('is-empty', empty);
  main.classList.toggle('dim-ascii', !empty);
  ascii.setDim(!empty);
  const h = new Date().getHours();
  const greet = h < 5 ? t('Доброй ночи') : h < 12 ? t('Доброе утро') : h < 18 ? t('Добрый день') : t('Добрый вечер');
  $('#greeting').textContent = state.settings.user ? `${greet}, ${state.settings.user}` : greet;
  $('#heroSub').textContent = chat.kind === 'code'
    ? `${t('Новая сессия кода ·')} ${chat.cwd ? shortPath(chat.cwd) : t('выберите окружение снизу')}`
    : t('Опишите задачу — Synapse сам выберет исполнителя');
  $('#input').placeholder = chat.kind === 'code' ? t('Опишите задачу для агента') : (empty ? t('Опишите задачу или задайте вопрос') : t('Ответить…'));

  const thread = $('#thread');
  thread.innerHTML = '';
  chat.messages.forEach((m, i) => thread.appendChild(renderMessage(m, i === chat.messages.length - 1)));
  for (const q of state.queue.get(chat.id) || []) thread.appendChild(renderQueued(q));
  renderMeta();
  updateSendBtn();
  if (scrollBottom) {
    const sc = $('#scroller');
    sc.scrollTop = sc.scrollHeight;
    sc.querySelectorAll('img').forEach(img => img.complete || img.addEventListener('load', () => { sc.scrollTop = sc.scrollHeight; }, { once: true }));
  }
}

function renderMessage(m, last) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}${last ? ' last' : ''}`;
  el.dataset.id = m.id;
  if (m.role === 'user') {
    const meta = [];
    if (m.mode && m.mode !== 'auto' && m.mode !== 'code') meta.push(`${icon(MODES[m.mode].icon)}${MODES[m.mode].label}`);
    if (m.ultra) meta.push(`<span class="uw">Ultra</span>`);
    if (m.arena) meta.push(`<span class="aw">${icon('swords')}${t('Арена')}</span>`);
    el.innerHTML = `
      ${m.images?.length ? `<div class="user-imgs">${m.images.filter(Boolean).map(src => `<img src="${src}" alt="">`).join('')}</div>` : ''}
      <div class="bubble">${highlightUltra(m.text, false)}</div>
      ${meta.length ? `<div class="user-meta">${meta.join(' · ')}</div>` : ''}`;
  } else fillAssistant(el, m);
  return el;
}

function renderQueued(q) {
  const el = document.createElement('div');
  el.className = 'msg user queued';
  el.innerHTML = `<div class="bubble">${esc(q.text)}</div>
    <div class="queued-bar">${t('В очереди')}
      <button data-send-now="${q.id}">${t('Отправить сейчас')} <kbd>Ctrl ↵</kbd></button>
      <button data-unqueue="${q.id}" title="${t('Убрать')}">${icon('x')}</button></div>`;
  return el;
}

function phaseText(m) {
  if (!m.route) return t('Выбираю исполнителя');
  if (m.route === 'video') return t('Veo собирает видео');
  if (m.route === 'image') return t('Рисую изображение');
  if (m.route === 'code') return `${m.label ? tl(m.label) : t('Агент')} ${t('работает')}`;
  return t('Думаю');
}

function activitySummary(steps) {
  const c = { create: 0, edit: 0, read: 0, run: 0, other: 0 };
  for (const s of steps) c[s.tool in c ? s.tool : 'other']++;
  const parts = [];
  if (c.create) parts.push(`${t('создано')} ${c.create} ${plural(c.create, [t('файл'), t('файла'), t('файлов')])}`);
  if (c.edit) parts.push(`${t('изменено')} ${c.edit}`);
  if (c.read) parts.push(`${t('прочитано')} ${c.read}`);
  if (c.run) parts.push(`${c.run} ${plural(c.run, [t('команда'), t('команды'), t('команд')])}`);
  let s = parts.join(', ');
  if (c.other) s += `${s ? t(' и ещё ') : ''}${c.other} ${plural(c.other, [t('шаг'), t('шага'), t('шагов')])}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fillAssistant(el, m) {
  const running = m.status === 'running';
  const parts = [];
  const badges = [];
  if (m.route) badges.push(m.executor === 'arena' || m.arena
    ? `<span class="badge arena-badge">${icon('swords')}${t('Арена')}</span>`
    : `<span class="badge">${provOf(m) ? provIcon(provOf(m)) : icon(ROUTE_ICON[m.route])}${esc(m.label ? tl(m.label) : ROUTE_NAME[m.route])}</span>`);
  if (m.ultra) badges.push(`<span class="badge ultra"><span>Ultra</span></span>`);
  if (m.reason && !(m.reason === 'выбрано вручную' && currentChat()?.kind === 'code') && !(m.reason === 'Арена' || m.reason === t('Арена'))) badges.push(`<span>${esc(t(m.reason))}</span>`);
  if (badges.length) parts.push(`<div class="route">${badges.join('')}</div>`);

  for (const f of m.fallbacks || []) {
    parts.push(`<div class="fallback">${icon('shuffle')}<div>${esc(f.from)}: ${esc(t(f.reason))} ${t('→ передаю')} ${esc(f.to)}${f.error ? `<small>${esc(f.error)}</small>` : ''}</div>${f.action ? `<button class="btn sm" data-open-settings="net" style="margin-left:auto">${t('Настроить сеть')}</button>` : ''}</div>`);
  }

  const fx = fxOf(m.id);
  if (m.arena) parts.push(arenaHtml(m, running));
  if (m.thinking || (running && m.thinkAt && !m.thinkEnd)) parts.push(thinkHtml(m, running));
  if (m.subs?.length) parts.push(subsHtml(m));

  const steps = m.steps || [];
  if ((running && !m.arena) || steps.length) {
    const cur = [...steps].reverse().find(s => s.status === 'run');
    const head = running
      ? `<span class="dots3"><i></i><i></i><i></i></span><span class="act-text"><span class="shimmer">${esc(cur ? `${t(cur.title)} ${cur.detail || ''}` : phaseText(m))}</span></span><span class="act-time" data-since="${m.at}">${fmtSec(Math.round((Date.now() - m.at) / 1000))}</span>`
      : `<span class="act-text">${esc(activitySummary(steps))}</span>`;
    parts.push(`<div class="activity ${m.open ? 'open' : ''}">
      <button class="act-head" data-toggle-act>${head}${steps.length ? `<span class="chev">${icon('chevronRight')}</span>` : ''}</button>
      ${steps.length ? `<div class="act-list"><div><div class="act-inner">${steps.map(s => `
        <div class="step ${s.status} ${fx.seen.has(s.id) ? '' : 'enter'}"><span class="s-title">${esc(t(s.title))}</span><span class="s-detail" title="${esc(s.detail)}">${esc(s.detail || '')}</span></div>`).join('')}</div></div></div>` : ''}
    </div>`);
  }

  if ((m.route === 'image' || m.route === 'video') && running) {
    parts.push(`<div class="gen-placeholder"><span>${m.route === 'video' ? t('Обычно 1–4 минуты') : t('Несколько секунд')}</span></div>`);
  }
  if (m.files?.length) {
    parts.push(`<div class="media">${m.files.map(f => `
      <div class="media-item">
        ${f.type === 'video' ? `<video src="${f.url}" controls loop playsinline></video>` : `<img src="${f.url}" alt="" data-zoom="${f.url}">`}
        <div class="media-tools">
          <button data-save="${esc(f.path)}" title="${t('Сохранить как…')}">${icon('download')}</button>
          <button data-reveal="${esc(f.path)}" title="${t('Показать в папке')}">${icon('folder')}</button>
        </div>
      </div>`).join('')}</div>`);
  }
  const vtext = visibleText(m);
  if (vtext) parts.push(`<div class="md${running || fx.vis != null ? ' caret' : ''}">${renderMarkdown(vtext)}</div>`);
  // в режиме «Правки файлов» агенту не дают запускать команды — предлагаем разрешить
  if (!running && m.route === 'code' && state.settings.agentAccess !== 'full' && steps.some(s => s.tool === 'run' && s.status === 'error')) {
    parts.push(`<div class="fallback">${icon('alert')}<div>${t('В режиме «Правки файлов» агенту нельзя запускать команды.')}</div><button class="btn sm" data-allow-run style="margin-left:auto">${t('Разрешить и повторить')}</button></div>`);
  }
  if (m.error) parts.push(`<div class="err">${icon('alert')}<span>${esc(m.error)}</span>${m.code === 'no_key' ? `<button class="btn sm" data-open-settings="api">${t('Настройки')}</button>` : ['proxy', 'network', 'region'].includes(m.code) ? `<button class="btn sm" data-open-settings="net">${t('Настроить сеть')}</button>` : ''}</div>`);
  if (!running) {
    parts.push(`<div class="msg-actions">
      ${m.text ? `<button data-copy title="${t('Копировать')}">${icon('copy')}</button>` : ''}
      <button data-retry title="${t('Повторить')}">${icon('retry')}</button>
      ${previewFile(m) ? `<button data-preview="${esc(previewFile(m))}" title="${esc(previewFile(m))}">${icon('eye')}<span>${t('Превью')}</span></button>` : ''}
      ${m.cwd ? `<button data-open-dir="${esc(m.cwd)}" title="${esc(m.cwd)}">${icon('folderOpen')}<span>${t('Папка')}</span></button>` : ''}
      ${m.usage ? usageChip(m.usage) : ''}
      ${m.ms ? `<span class="meta" title="${t('Время выполнения')}">${icon('clock')}${fmtDur(m.ms)}</span>` : ''}
    </div>`);
  }
  el.innerHTML = parts.join('');
  if (m.arena) keepDetails(el, m.id);
  enhanceCode(el);
  applyFx(el.querySelector('.md'), m);
  steps.forEach(s => fx.seen.add(s.id));
  const ti = el.querySelector('.think.live .think-inner');
  if (ti) ti.scrollTop = ti.scrollHeight;
}


/* ================= Арена ================= */
const ARENA_STAGES = [['brief', 'Бриф'], ['plan', 'Планы'], ['debate', 'Спор'], ['build', 'Код'], ['vote', 'Голосование'], ['polish', 'Доработка'], ['result', 'Итог']];
const arenaOn = () => !!state.settings.arena?.on;
function arenaPart(A, pid) { return pid === 'd' ? A.disp : A.parts.find(p => p.id === pid); }
function arenaEvent(m, ev) {
  if (ev.type === 'init') {
    m.arena = { runId: ev.runId, rounds: ev.rounds, stage: 'copy', round: 0, plans: {}, votes: {}, scores: null, winner: null, result: null,
      parts: ev.participants.map(p => ({ ...p, status: 'wait' })), disp: ev.dispatcher ? { ...ev.dispatcher, status: 'wait' } : null };
    return;
  }
  const A = m.arena;
  if (!A) return;
  switch (ev.type) {
    case 'stage': A.stage = ev.stage; if (ev.round) A.round = ev.round; break;
    case 'part': {
      const p = arenaPart(A, ev.pid);
      if (!p) break;
      if (ev.status) { p.status = ev.status; p.stage = ev.stage; if (ev.status === 'run') { p.activity = ''; p.at = ev.at || Date.now(); p.end = null; } }
      if (ev.end) p.end = ev.end;
      if (ev.activity) p.activity = ev.activity;
      if (ev.error) p.error = ev.error;
      break;
    }
    case 'model': { const p = arenaPart(A, ev.pid); if (p) p.model = ev.model; break; }
    case 'brief': A.brief = ev.text; break;
    case 'plan': {
      (A.plans[ev.pid] = A.plans[ev.pid] || []).push({ round: ev.round, text: ev.text, agree: ev.agree, objections: ev.objections || [] });
      const p = arenaPart(A, ev.pid); if (p && ev.round) p.agree = !!ev.agree;
      break;
    }
    case 'consensus': A.consensus = ev.round; break;
    case 'built': { const p = arenaPart(A, ev.pid); if (p) { p.files = ev.files.length; p.summary = ev.summary; } break; }
    case 'vote': A.votes[ev.pid] = { given: ev.given || {}, note: ev.note || '' }; break;
    case 'scores': A.scores = ev.scores; A.winner = ev.winner; break;
    case 'result': A.result = { files: ev.files, variants: ev.variants, dir: ev.dir }; A.runId = ev.runId; break;
  }
}
const arenaName = (p) => p?.model ? prettyModel(p.model) : (p?.label || '');
function arenaStageName(id, A) {
  const s = ARENA_STAGES.find(x => x[0] === id);
  if (!s) return id === 'copy' ? t('Копирую папку') : id;
  return id === 'debate' && A?.round ? `${t(s[1])} ${A.round}/${A.rounds}` : t(s[1]);
}
function diffHtml(d) {
  return `<pre class="ar-diff">${String(d || '').split('\n').map(l => {
    const c = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l === '…' || l.startsWith('@@') ? 'gap' : '';
    return `<span class="${c}">${esc(l) || ' '}</span>`;
  }).join('')}</pre>`;
}
function arenaFilesHtml(files, pre = 'f') {
  if (!files?.length) return `<div class="note">${t('Изменений в файлах нет')}</div>`;
  const K = { add: ['A', t('новый')], mod: ['M', t('изменён')], del: ['D', t('удалён')] };
  return `<div class="ar-files">${files.map(f => `<details class="ar-file ${f.kind}" data-k="${pre}:${esc(f.rel)}">
    <summary><span class="ar-k">${K[f.kind][0]}</span><span class="ar-rel" title="${esc(f.rel)}">${esc(f.rel)}</span>
      <span class="ar-stat">${f.add ? `<i class="a">+${f.add}</i>` : ''}${f.del ? `<i class="d">−${f.del}</i>` : ''}</span><span class="chev">${icon('chevronRight')}</span></summary>
    ${diffHtml(f.diff)}</details>`).join('')}</div>`;
}
function arenaHtml(m, running) {
  const A = m.arena;
  const cur = ARENA_STAGES.findIndex(s => s[0] === A.stage);
  const steps = ARENA_STAGES.map(([id], i) => {
    const st = A.stage === 'result' && !running ? 'done' : i < cur ? 'done' : i === cur ? 'cur' : '';
    const skip = (id === 'debate' && A.parts.length < 2) || (id === 'vote' && A.parts.length < 2) || (id === 'polish' && A.parts.length < 2);
    return skip ? '' : `<span class="ar-st ${st}">${st === 'done' ? icon('check') : ''}${esc(arenaStageName(id, i === cur ? A : null))}</span>`;
  }).join('<i class="ar-sep"></i>');
  const score = (p) => A.scores && A.scores[p.id] != null && A.scores[p.id] >= 0 ? A.scores[p.id] : null;
  const card = (p, i) => {
    const win = A.winner === p.id;
    const st = p.status === 'run' ? 'run' : p.status === 'error' ? 'error' : p.status === 'done' ? 'done' : 'wait';
    const what = p.status === 'run' ? `<span class="shimmer">${esc(arenaStageName(p.stage, A))}</span>${p.activity ? ` · ${esc(t(p.activity.split(' ')[0]))} ${esc(p.activity.split(' ').slice(1).join(' '))}` : ''}`
      : p.status === 'error' ? esc(p.error || t('ошибка')) : p.status === 'done' ? esc(arenaStageName(p.stage, null)) + ' ' + t('готово') : t('ждёт');
    const sc = score(p);
    return `<div class="ar-card ${st} ${win ? 'win' : ''}" style="--i:${i}">
      <div class="ar-top">${provIcon(p.agent)}<b title="${esc(p.model || '')}">${esc(arenaName(p))}</b>
        ${win ? `<span class="ar-crown" title="${t('Победитель')}">${icon('crown')}</span>` : ''}
        ${sc != null ? `<span class="ar-score">${sc.toFixed(1)}</span>` : ''}
        ${p.agree != null && A.stage === 'debate' ? `<span class="ar-agree ${p.agree ? 'yes' : 'no'}" title="${p.agree ? t('Согласен') : t('Есть возражения')}">${icon(p.agree ? 'handshake' : 'alert')}</span>` : ''}</div>
      <div class="ar-what ${st}">${what}</div>
      ${p.files != null ? `<div class="ar-meta">${t('файлов изменено')}: ${p.files}</div>` : ''}
    </div>`;
  };
  const parts = [];
  parts.push(`<div class="ar-head">${icon('swords')}<b>${t('Арена')}</b><span class="dim">${A.parts.length} ${plural(A.parts.length, [t('модель'), t('модели'), t('моделей')])} · ${t('до {n} кругов спора', { n: A.rounds })}</span>
    ${running ? `<span class="act-time" data-since="${m.at}">${fmtSec(Math.round((Date.now() - m.at) / 1000))}</span>` : ''}</div>`);
  parts.push(`<div class="ar-steps">${steps}</div>`);
  if (A.disp) parts.push(`<div class="ar-disp">${provIcon(A.disp.agent)}<span>${t('Диспетчер')}: <b>${esc(arenaName(A.disp))}</b> — ${A.disp.status === 'run' ? `<span class="shimmer">${t('пишет бриф')}</span>` : A.disp.status === 'done' ? t('бриф готов') : A.disp.status === 'error' ? esc(A.disp.error || t('ошибка')) : t('ждёт')}</span></div>`);
  parts.push(`<div class="ar-grid">${A.parts.map(card).join('')}</div>`);
  if (A.consensus) parts.push(`<div class="ar-note">${icon('handshake')}${t('Согласие достигнуто в круге {n}', { n: A.consensus })}</div>`);
  if (A.brief) parts.push(`<details class="ar-sec" data-k="brief"><summary>${icon('file')}${t('Бриф от диспетчера')}<span class="chev">${icon('chevronRight')}</span></summary><div class="md">${renderMarkdown(A.brief)}</div></details>`);
  const planParts = A.parts.filter(p => A.plans[p.id]?.length);
  if (planParts.length) {
    parts.push(`<details class="ar-sec" data-k="plans"><summary>${icon('message')}${t('Планы и спор')}<span class="chev">${icon('chevronRight')}</span></summary>
      ${planParts.map(p => `<details class="ar-sub" data-k="plan:${p.id}"><summary>${provIcon(p.agent)}<b>${esc(arenaName(p))}</b><span class="dim">${A.plans[p.id].length - 1 > 0 ? `${t('кругов')}: ${A.plans[p.id].length - 1}` : t('план')}</span><span class="chev">${icon('chevronRight')}</span></summary>
        ${A.plans[p.id].map(x => `<div class="ar-round"><div class="ar-rh">${x.round ? `${t('Круг')} ${x.round}` : t('Первый план')}${x.round ? `<span class="ar-agree ${x.agree ? 'yes' : 'no'}">${x.agree ? t('согласен') : t('возражает')}</span>` : ''}</div>
          <div class="md">${renderMarkdown(x.text)}</div>
          ${x.objections?.length && !x.agree ? `<ul class="ar-obj">${x.objections.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div>`).join('')}
      </details>`).join('')}
    </details>`);
  }
  const voters = A.parts.filter(p => A.votes?.[p.id]).map(p => p.id);
  if (voters.length) {
    const cols = A.parts.filter(p => A.scores ? p.id in A.scores : true);
    parts.push(`<details class="ar-sec" data-k="votes" ${A.result ? '' : 'open'}><summary>${icon('crown')}${t('Голосование')}<span class="chev">${icon('chevronRight')}</span></summary>
      <table class="ar-votes"><thead><tr><th>${t('Кто оценивает')}</th>${cols.map(p => `<th>${esc(arenaName(p))}</th>`).join('')}</tr></thead><tbody>
      ${voters.map(v => `<tr><td>${esc(arenaName(arenaPart(A, v)))}</td>${cols.map(p => `<td>${p.id === v ? '—' : (A.votes[v].given[p.id] ?? '·')}</td>`).join('')}</tr>`).join('')}
      ${A.scores ? `<tr class="avg"><td>${t('Средняя')}</td>${cols.map(p => `<td>${A.scores[p.id] >= 0 ? A.scores[p.id].toFixed(1) : '—'}</td>`).join('')}</tr>` : ''}
      </tbody></table></details>`);
  }
  if (A.result) {
    const w = arenaPart(A, A.winner);
    const others = (A.result.variants || []).filter(v => v.id !== A.winner && v.alive);
    parts.push(`<div class="ar-result">
      <div class="ar-rhead">${icon('crown')}<span>${t('Лучший вариант')}: <b>${esc(arenaName(w))}</b>${A.scores?.[A.winner] >= 0 ? ` · ${A.scores[A.winner].toFixed(1)}/10` : ''}</span></div>
      ${arenaFilesHtml(A.result.files)}
      ${A.conflicts?.length ? `<div class="fallback">${icon('alert')}<div>${t('После запуска Арены эти файлы изменились в папке')}:<small>${esc(A.conflicts.join(', '))}</small></div><button class="btn sm" data-arena-apply="${A.applyPid || A.winner}" data-force="1" style="margin-left:auto">${t('Всё равно применить')}</button></div>` : ''}
      <div class="ar-actions">
        ${A.applied ? `<span class="ar-applied">${icon('check')}${t('Применено в папку')}${A.applied.pid !== A.winner ? ` (${esc(arenaName(arenaPart(A, A.applied.pid)))})` : ''}</span>`
          : `<button class="btn primary" data-arena-apply="${A.winner}">${icon('check')}${t('Применить')}</button>`}
        <button class="btn" data-arena-open="${A.winner}">${icon('folderOpen')}${t('Папка варианта')}</button>
        ${others.map(v => `<button class="btn ghost" data-arena-variant="${v.id}">${provIcon(arenaPart(A, v.id)?.agent)}${esc(arenaName(arenaPart(A, v.id)))}</button>`).join('')}
      </div>
      ${A.view && A.viewFiles ? `<div class="ar-variant"><div class="ar-rhead">${provIcon(arenaPart(A, A.view)?.agent)}<span>${t('Вариант')} <b>${esc(arenaName(arenaPart(A, A.view)))}</b></span>
          <button class="btn sm" data-arena-apply="${A.view}">${t('Применить этот вариант')}</button><button class="icon-btn sm" data-arena-variant="${A.view}" title="${t('Скрыть')}">${icon('x')}</button></div>
        ${arenaFilesHtml(A.viewFiles, `v${A.view}`)}</div>` : ''}
    </div>`);
  }
  return `<div class="arena ${running ? 'live' : ''}">${parts.join('')}</div>`;
}
// раскрытые разделы карточки не сворачиваются при обновлении
const detOpen = new Map();
function keepDetails(el, mid) {
  el.querySelectorAll('details[data-k]').forEach(d => {
    const k = `${mid}|${d.dataset.k}`;
    if (detOpen.has(k)) d.open = detOpen.get(k);
    d.addEventListener('toggle', () => detOpen.set(k, d.open));
  });
}
// Настройки → Агенты → Арена
async function arenaSettingsHtml() {
  const R = await api.arena.roster().catch(() => null);
  if (!R) return '';
  const cfg = { auto: true, rounds: 3, maxBig: 3, roster: [], ...(state.settings.arena || {}) };
  const inst = new Set(R.agents.filter(a => a.installed).map(a => a.id));
  const chip = (p) => `<span class="ar-chip">${provIcon(p.agent)}${esc(prettyModel(p.model) || p.label)}</span>`;
  const seg = (k, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-ar-k="${k}" data-ar-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const bigs = R.models.filter(m => m.tier === 'big' && inst.has(m.agent));
  const smalls = R.models.filter(m => m.tier === 'small' && inst.has(m.agent));
  const inRoster = (m) => (cfg.roster || []).some(r => r.model === m.model && r.on !== false);
  return `<h3 class="sub-h" style="display:flex;align-items:center;gap:7px">${icon('swords')}${t('Арена')}</h3>
    <p class="hint" style="margin:-4px 0 12px">${t('Маленькая модель пишет бриф, большие предлагают планы, спорят до согласия, каждая пишет свой вариант кода в отдельной копии папки и голосует за лучший. Итог применяется кнопкой. Включается кнопкой «Арена» во вкладке «Код».')}</p>
    <div class="field"><span class="field-label">${t('Состав')}</span>${seg('auto', [['1', t('Авто')], ['0', t('Вручную')]], cfg.auto !== false ? 1 : 0)}</div>
    ${cfg.auto !== false ? `
      <div class="field"><span class="field-label">${t('Участники')}</span><div class="ar-chips">${R.participants.length ? R.participants.map(chip).join('') : `<span class="hint">${t('Нет установленных агентов')}</span>`}</div></div>
      <div class="field"><span class="field-label">${t('Сколько больших моделей')}</span>${seg('maxBig', [['2', '2'], ['3', '3'], ['4', '4']], cfg.maxBig)}</div>`
    : `<div class="field"><span class="field-label">${t('Большие модели')}</span>${bigs.map(m => `<div class="toggle-row" data-ar-model="${esc(m.model)}" data-ar-agent="${m.agent}">${provIcon(m.agent)}
        <span class="tr-text">${esc(prettyModel(m.model))}<small class="mono">${esc(m.model)}</small></span><span class="switch ${inRoster(m) ? 'on' : ''}"></span></div>`).join('') || `<span class="hint">${t('Нет установленных агентов')}</span>`}</div>`}
    <div class="field"><span class="field-label">${t('Диспетчер (пишет бриф)')}</span>
      <select class="input" id="arDisp"><option value="">${t('Авто')} — ${esc(R.dispatcher ? prettyModel(R.dispatcher.model) : '—')}</option>
        ${smalls.map(m => `<option value="${m.agent}|${esc(m.model)}" ${cfg.dispatcher?.model === m.model ? 'selected' : ''}>${esc(PROVIDERS[m.agent]?.name || m.agent)} · ${esc(prettyModel(m.model))}</option>`).join('')}</select></div>
    <div class="field"><span class="field-label">${t('Кругов спора (максимум)')}</span>${seg('rounds', [1, 2, 3, 4, 5].map(n => [String(n), String(n)]), cfg.rounds)}
      <div class="hint">${t('Спор заканчивается раньше, если все модели согласны. Каждый круг расходует лимиты всех участников.')}</div></div>`;
}
async function saveArena(patch) {
  const sb = $('#settingsBody'), y = sb?.scrollTop || 0;
  await saveSettings({ arena: { ...(state.settings.arena || {}), ...patch } });
  await renderSettings();
  if (sb) sb.scrollTop = y;
}

async function arenaAction(tg, m, chat) {
  const A = m?.arena;
  if (!A) return false;
  const ap = tg.closest('[data-arena-apply]');
  if (ap) {
    const pid = ap.dataset.arenaApply;
    ap.disabled = true;
    try {
      const r = await api.arena.apply({ runId: A.runId, pid, force: ap.dataset.force === '1' });
      if (!r.ok) { A.conflicts = r.conflicts; A.applyPid = pid; toast(t('Файлы в папке изменились после запуска — проверьте и подтвердите'), true); }
      else { A.applied = { pid, at: Date.now() }; A.conflicts = null; toast(t('Применено: {n} файлов', { n: r.count })); Workbench.refresh?.(); }
    } catch (e) { toast(cleanErr(e), true); }
    persist(chat); updateMessage(chat.id, m.id);
    return true;
  }
  const op = tg.closest('[data-arena-open]');
  if (op) { await api.arena.open({ runId: A.runId, pid: op.dataset.arenaOpen }); return true; }
  const vr = tg.closest('[data-arena-variant]');
  if (vr) {
    const pid = vr.dataset.arenaVariant;
    if (A.view === pid) { A.view = null; A.viewFiles = null; }
    else { try { A.viewFiles = await api.arena.files({ runId: A.runId, pid }); A.view = pid; } catch (e) { toast(cleanErr(e), true); } }
    updateMessage(chat.id, m.id);
    return true;
  }
  return false;
}

/* ================= Рассуждение и субагенты ================= */
function thinkHtml(m, running) {
  const live = running && !m.thinkEnd;
  const open = m.thinkOpen != null ? m.thinkOpen : live;
  const secs = Math.max(1, Math.round(((m.thinkEnd || Date.now()) - (m.thinkAt || m.at)) / 1000));
  return `<div class="think ${live ? 'live' : ''} ${open ? 'open' : ''}">
    <button class="think-head" data-toggle-think>${icon('brain')}
      <span class="think-title">${live ? `<span class="shimmer">${t('Думаю')}</span>` : t('Рассуждение')}</span>
      <span class="think-time" ${live ? `data-since="${m.thinkAt || m.at}"` : ''}>${live ? fmtSec(secs) : t('{s} с', { s: secs })}</span>
      <span class="chev">${icon('chevronRight')}</span></button>
    <div class="think-body"><div><div class="think-inner">${renderMarkdown(m.thinking)}</div></div></div>
  </div>`;
}
function subsHtml(m) {
  const subs = m.subs;
  const done = subs.filter(s => s.status !== 'run').length;
  return `<div class="subs">
    <div class="subs-head">${icon('users')}<span>${t('Субагенты')}</span><span class="dim">${done}/${subs.length}</span></div>
    <div class="subs-grid">${subs.map((s, i) => {
      const secs = Math.max(0, Math.round(((s.end || Date.now()) - (s.at || m.at)) / 1000));
      const last = (s.steps || []).slice(-3);
      return `<div class="sub ${s.status || 'run'}" style="--i:${i}">
        <div class="sub-top"><span class="sub-dot"></span><b title="${esc(s.title)}">${esc(s.title || s.name)}</b>
          <span class="sub-time" ${s.status === 'run' ? `data-since="${s.at || m.at}"` : ''}>${fmtSec(secs)}</span></div>
        <div class="sub-name">${esc(s.name || '')}${s.steps?.length ? ` · ${t('шагов')}: ${s.steps.length}` : ''}</div>
        ${last.length ? `<div class="sub-steps">${last.map(st => `<div class="sub-step ${st.status}"><span>${esc(t(st.title || ''))}</span> ${esc(st.detail || '')}</div>`).join('')}</div>` : ''}
        ${s.note && s.status !== 'run' ? `<div class="sub-note">${esc(s.note.replace(/\s+/g, ' ').slice(0, 180))}</div>` : ''}
      </div>`;
    }).join('')}</div>
  </div>`;
}
// HTML-файл, созданный агентом в этом ответе — для кнопки «Превью»
function previewFile(m) {
  const s = [...(m.steps || [])].reverse().find(x => x.path && /\.html?$/i.test(x.path) && (x.tool === 'create' || x.tool === 'edit') && x.status !== 'error');
  return s?.path || null;
}

/* ================= Плавная печать ================= */
// Текст догоняет поток плавно, а новые слова проявляются (opacity + blur). Учитывает prefers-reduced-motion.
const fxMap = new Map();
const reduceMotion = () => document.documentElement.classList.contains('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
function fxOf(id) {
  let f = fxMap.get(id);
  if (!f) { f = { vis: null, entries: [], rlen: 0, seen: new Set() }; fxMap.set(id, f); }
  return f;
}
function visibleText(m) {
  const f = fxMap.get(m.id);
  return f && f.vis != null ? (m.text || '').slice(0, f.vis) : (m.text || '');
}
function applyFx(md, m) {
  const f = fxMap.get(m.id);
  if (!md || !f) return;
  const total = md.textContent.length;
  const now = performance.now();
  if (reduceMotion()) { f.rlen = total; return; }
  if (total > f.rlen) f.entries.push({ from: f.rlen, to: total, t: now });
  if (total < f.rlen) f.entries = f.entries.filter(e => e.from < total);
  f.rlen = total;
  f.entries = f.entries.filter(e => now - e.t < 600);
  if (!f.entries.length) return;
  const nodes = [];
  const tw = document.createTreeWalker(md, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) nodes.push(tw.currentNode);
  let pos = 0;
  for (const node of nodes) {
    const start = pos, end = pos + node.data.length;
    pos = end;
    const hits = f.entries.filter(e => e.to > start && e.from < end);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let cur = start;
    for (const e of hits) {
      const a0 = Math.max(e.from, cur), b0 = Math.min(e.to, end);
      if (a0 > cur) frag.append(node.data.slice(cur - start, a0 - start));
      if (b0 > a0) {
        const sp = document.createElement('span');
        sp.className = 'fx';
        sp.style.animationDelay = `${Math.round(e.t - now)}ms`;
        sp.textContent = node.data.slice(a0 - start, b0 - start);
        frag.append(sp);
      }
      cur = Math.max(cur, b0);
    }
    if (cur < end) frag.append(node.data.slice(cur - start));
    node.replaceWith(frag);
  }
}
function updateText(el, m) {
  const md = el.querySelector('.md');
  if (!md) return fillAssistant(el, m);
  md.innerHTML = renderMarkdown(visibleText(m));
  enhanceCode(el);
  applyFx(md, m);
}
let revealRaf = 0;
function kickReveal() { if (!revealRaf) revealRaf = requestAnimationFrame(revealTick); }
function revealTick() {
  revealRaf = 0;
  const chat = currentChat();
  if (!chat) return;
  let more = false;
  for (const m of chat.messages) {
    const f = fxMap.get(m.id);
    if (!f || f.vis == null) continue;
    const text = m.text || '';
    const el = $(`.msg[data-id="${m.id}"]`);
    if (f.vis < text.length) {
      const gap = text.length - f.vis;
      f.vis = Math.min(text.length, f.vis + Math.max(2, Math.ceil(gap / (text.length > 15000 ? 3 : 7))));
      if (f.vis < text.length && /[\uD800-\uDBFF]/.test(text[f.vis - 1])) f.vis++;
      if (el) {
        const sc = $('#scroller');
        const stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
        updateText(el, m);
        if (stick) sc.scrollTop = sc.scrollHeight;
      }
      more = true;
    } else if (m.status !== 'running') {
      f.vis = null;            // дописали — финальная отрисовка с кнопками
      if (el) fillAssistant(el, m);
    }
  }
  if (more) kickReveal();
}
function startReveal(m, prevLen) {
  if (reduceMotion()) return;
  const f = fxOf(m.id);
  if (f.vis == null) {
    f.vis = prevLen;
    const md = $(`.msg[data-id="${m.id}"] .md`);
    f.rlen = md ? md.textContent.length : 0;
  }
  kickReveal();
}
function updateThink(m) {
  const el = $(`.msg[data-id="${m.id}"]`);
  const inner = el?.querySelector('.think-inner');
  if (!inner) return updateMessage(currentChat()?.id, m.id);
  inner.innerHTML = renderMarkdown(m.thinking);
  inner.scrollTop = inner.scrollHeight;
}

/* ================= Токены, контекст, лимиты ================= */
function fmtTok(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n < 1e4 ? (n / 1000).toFixed(1) : Math.round(n / 1000)) + 'k';
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
}
function fmtDur(ms) {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} ${t('с')}`;
  if (s < 60) return `${Math.round(s)} ${t('с')}`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m < 60 ? `${m} ${t('мин')} ${r} ${t('с')}` : `${Math.floor(m / 60)} ${t('ч')} ${m % 60} ${t('мин')}`;
}
// Всего прошло через модель (с кэшем) — и только новые токены. Агенты за одно сообщение делают десятки запросов,
// каждый раз заново отправляя переписку; повторная часть идёт из кэша и почти не тратит лимиты.
const usageIn = (u) => (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
const usageNew = (u) => (u.input || 0) + (u.cacheWrite || 0);
function usageChip(u) {
  const lines = [
    `${t('Новые входные')}: ${usageNew(u).toLocaleString(I18N.locale)}`,
    u.cacheWrite ? `  ${t('из них запись в кэш')}: ${u.cacheWrite.toLocaleString(I18N.locale)}` : '',
    u.cacheRead ? `${t('Повторно из кэша')}: ${u.cacheRead.toLocaleString(I18N.locale)} — ${t('почти не тратит лимиты')}` : '',
    u.cacheRead ? `${t('Всего прошло через модель')}: ${usageIn(u).toLocaleString(I18N.locale)}` : '',
    `${t('Выход')}: ${(u.output || 0).toLocaleString(I18N.locale)}`,
    u.thinking ? `  ${t('размышления')}: ${u.thinking.toLocaleString(I18N.locale)}` : '',
    u.turns > 1 ? `${t('Шагов модели')}: ${u.turns}` : '',
    u.startupMs != null ? `${t('Запуск CLI')}: ${fmtDur(u.startupMs)}` : '',
    u.firstMs != null ? `${t('До первого ответа')}: ${fmtDur(u.firstMs)}` : '',
    u.apiMs ? `${t('Работа модели')}: ${fmtDur(u.apiMs)}` : '',
    u.retries ? `${t('Повторов запроса')}: ${u.retries}` : '',
    u.model ? `${t('Модель')}: ${u.model}` : '',
    u.listCost ? `${t('По ценам API')}: $${u.listCost.toFixed(3)} (${t('по подписке не списывается')})` : '',
  ].filter(Boolean).join('\n');
  return `<span class="meta tok" title="${esc(lines)}">${icon('arrowUp')}${fmtTok(usageNew(u))}<span class="tok-sep"></span>${icon('arrowDown')}${fmtTok(u.output)}</span>`;
}

function loadLimits() { try { return JSON.parse(localStorage.getItem('synapse.limits') || '{}'); } catch { return {}; } }
function setLimits(provider, data) {
  state.limits = { ...loadLimits(), [provider]: data };
  try { localStorage.setItem('synapse.limits', JSON.stringify(state.limits)); } catch { /* приватный режим */ }
  if ($('#ctxPop').classList.contains('open')) renderCtxPop();
  renderCtx();
}

function renderCtx() {
  const chat = currentChat();
  const c = chat?.context;
  const ring = $('#ringBtn');
  const frac = c?.used && c?.window ? Math.min(1, c.used / c.window) : 0;
  ring.querySelector('.arc').style.strokeDashoffset = String(47.1 * (1 - frac));
  ring.classList.toggle('warn', frac >= 0.7 && frac < 0.9);
  ring.classList.toggle('full', frac >= 0.9);
  const lim = Object.values(state.limits || {}).flatMap(p => p.windows || []).filter(w => typeof w.used === 'number');
  const maxLim = lim.length ? Math.max(...lim.map(w => w.used)) : 0;
  ring.classList.toggle('lim', maxLim >= 0.8);
  ring.title = c?.used
    ? `${t('Контекст')}: ${fmtTok(c.used)}${c.window ? ` ${t('из')} ${fmtTok(c.window)} · ${Math.round(frac * 100)}%` : ''}`
    : t('Контекст и лимиты');
}

function limitName(id) {
  return { five_hour: t('5 часов'), seven_day: t('Неделя'), seven_day_opus: t('Неделя · Opus'), seven_day_sonnet: t('Неделя · Sonnet'), primary: t('Основной'), secondary: t('Недельный') }[id] || id;
}
function fmtReset(ts) {
  if (!ts) return '';
  const d = ts - Date.now();
  if (d <= 0) return t('уже сброшен');
  const h = Math.floor(d / 3.6e6), mi = Math.floor((d % 3.6e6) / 6e4);
  const when = new Date(ts).toLocaleString(I18N.locale, h >= 24 ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  return `${t('сброс')} ${when} · ${t('через')} ${h >= 24 ? `${Math.floor(h / 24)} ${t('д')} ${h % 24} ${t('ч')}` : h ? `${h} ${t('ч')} ${mi} ${t('мин')}` : `${mi} ${t('мин')}`}`;
}
function meter(frac, cls = '') {
  const p = Math.max(0, Math.min(1, frac || 0));
  return `<div class="meter ${cls} ${p >= 0.9 ? 'full' : p >= 0.7 ? 'warn' : ''}"><i style="--p:${p}"></i></div>`;
}
function renderCtxPop() {
  const chat = currentChat();
  const c = chat?.context;
  const msgs = (chat?.messages || []).filter(m => m.usage);
  const sum = msgs.reduce((a, m) => ({ i: a.i + usageNew(m.usage), c: a.c + (m.usage.cacheRead || 0), o: a.o + (m.usage.output || 0) }), { i: 0, c: 0, o: 0 });
  const frac = c?.used && c?.window ? c.used / c.window : null;
  const lims = state.limits || {};
  const prov = (id, name) => {
    const L = lims[id];
    if (!L?.windows?.length) return '';
    return `<div class="cp-sec"><div class="cp-title">${provIcon(id)}${esc(name)}${L.status && L.status !== 'allowed' ? `<span class="cp-flag">${esc(L.status === 'rejected' ? t('лимит исчерпан') : t('близко к лимиту'))}</span>` : ''}</div>
      ${L.windows.map(w => `<div class="cp-row"><span>${esc(limitName(w.id))}</span><b>${typeof w.used === 'number' ? Math.round(w.used * 100) + '%' : '—'}</b></div>
        ${meter(w.used)}<div class="cp-sub">${typeof w.used === 'number' ? `${t('осталось')} ${Math.max(0, 100 - Math.round(w.used * 100))}% · ` : ''}${esc(fmtReset(w.resetsAt))}</div>`).join('')}
      <div class="cp-sub dim">${t('обновлено')} ${new Date(L.at).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })}</div></div>`;
  };
  const codexOn = state.agents.some(x => x.id === 'codex' && x.installed);
  const codexHtml = prov('codex', 'Codex') || (codexOn ? `<div class="cp-sec"><div class="cp-title">${provIcon('codex')}Codex</div><div class="cp-sub">${state.codexLimitsErr ? esc(state.codexLimitsErr) : t('Загружаю…')}</div></div>` : '');
  const limHtml = prov('claude', 'Claude') + codexHtml
    + (codexOn ? `<div class="cp-sec cp-actions"><button class="btn sm" id="codexLimRefresh">${icon('refresh')}${t('Обновить лимиты Codex')}</button></div>` : '');
  $('#ctxPop').innerHTML = `
    <div class="cp-sec"><div class="cp-title">${icon('brain')}${t('Контекстное окно')}</div>
      ${c?.used ? `<div class="cp-row"><span>${fmtTok(c.used)}${c.window ? ` ${t('из')} ${fmtTok(c.window)}` : ''}</span><b>${frac != null ? Math.round(frac * 100) + '%' : ''}</b></div>
        ${frac != null ? meter(frac) : ''}
        <div class="cp-sub">${c.model ? esc(prettyModel(c.model)) : ''}${c.compactAt ? ` · ${t('автосжатие при')} ${fmtTok(c.compactAt)}` : ''}</div>`
      : `<div class="cp-sub">${t('Появится после первого ответа')}</div>`}
    </div>
    ${msgs.length ? `<div class="cp-sec"><div class="cp-title">${icon('list')}${t('Токены за чат')}</div>
      <div class="cp-row"><span>${t('Новые входные')}</span><b>${fmtTok(sum.i)}</b></div>
      <div class="cp-row"><span>${t('Выход')}</span><b>${fmtTok(sum.o)}</b></div>
      ${sum.c ? `<div class="cp-row"><span>${t('Повторно из кэша')}</span><b class="dim">${fmtTok(sum.c)}</b></div>` : ''}
      <div class="cp-sub">${t('Ответов')}: ${msgs.length}</div></div>` : ''}
    ${limHtml || `<div class="cp-sec"><div class="cp-title">${icon('zap')}${t('Лимиты подписки')}</div><div class="cp-sub">${t('Claude Code сообщает их после первого запроса.')}</div></div>`}`;
}
// Лимиты Codex: читаем у самого Codex (это не запрос к модели и ничего не тратит)
let codexLimBusy = false;
async function refreshCodexLimits(force) {
  if (codexLimBusy || !state.agents.some(x => x.id === 'codex' && x.installed)) return;
  const L = state.limits?.codex;
  if (!force && L && Date.now() - L.at < 5 * 60 * 1000) return;
  codexLimBusy = true;
  try {
    const r = await api.limits.codex();
    if (r.ok) { state.codexLimitsErr = null; setLimits('codex', { windows: r.windows, plan: r.plan, at: Date.now() }); }
    else { state.codexLimitsErr = `${t('Не удалось получить лимиты')}: ${r.error}`; if ($('#ctxPop').classList.contains('open')) renderCtxPop(); }
  } finally { codexLimBusy = false; }
}

function toggleCtxPop() {
  const pop = $('#ctxPop');
  if (pop.classList.contains('open')) return pop.classList.remove('open');
  closePopovers();
  renderCtxPop();
  pop.classList.add('open');
  refreshCodexLimits(false);
  const r = $('#ringBtn').getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - h - 8) + 'px';
}

function renderMarkdown(text) { return DOMPurify.sanitize(marked.parse(text)); }
function enhanceCode(root) {
  root.querySelectorAll('.md pre > code').forEach(code => {
    const pre = code.parentElement;
    if (pre.parentElement.classList.contains('codeblock')) return;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
    try {
      if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent, { language: lang }).value;
      else if (code.textContent.length < 20000) code.innerHTML = hljs.highlightAuto(code.textContent).value;
    } catch { /* без подсветки */ }
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    wrap.innerHTML = `<div class="codeblock-head"><span>${esc(lang || t('код'))}</span><button data-copy-code>${icon('copy')}<span>${t('Копировать')}</span></button></div>`;
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
  });
  root.querySelectorAll('.md a').forEach(a => { a.target = '_blank'; a.rel = 'noreferrer'; });
}

const pending = new Map();
function updateMessage(chatId, msgId) {
  if (state.view.type !== 'chat' || chatId !== state.view.id || pending.has(msgId)) return;
  pending.set(msgId, requestAnimationFrame(() => {
    pending.delete(msgId);
    const m = state.cache.get(chatId)?.messages.find(x => x.id === msgId);
    const el = $(`.msg[data-id="${msgId}"]`);
    if (!m || !el) return;
    const sc = $('#scroller');
    const stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
    fillAssistant(el, m);
    if (stick) sc.scrollTop = sc.scrollHeight;
    renderProgress();
  }));
}
function tickTimers() {
  $$('.act-time[data-since], .think-time[data-since], .sub-time[data-since]').forEach(el => { el.textContent = fmtSec(Math.round((Date.now() - Number(el.dataset.since)) / 1000)); });
}

/* ================= Панель прогресса ================= */
function renderProgress() {
  const body = $('#progressBody');
  const chat = currentChat();
  const running = chat && isRunning(chat.id);
  $('#ringBtn').classList.toggle('busy', !!running);
  $('#progressBtn').classList.toggle('on', !!state.settings.progressPanel);
  if (!chat || !chat.messages.length) {
    body.innerHTML = `<div class="pg-empty">${t('Здесь появится план агента, исполнители и изменённые файлы.')}</div>`;
    return;
  }
  const last = [...chat.messages].reverse().find(m => m.role === 'assistant');
  let todo = '';
  if (chat.todos?.length) {
    todo = chat.todos.map(td => `<div class="todo ${td.status}">${esc(td.text)}</div>`).join('');
  } else if (last) {
    const st = last.status;
    const phases = [
      [t('Выбор исполнителя'), last.route ? 'completed' : 'in_progress'],
      [`${last.label ? tl(last.label) : t('Исполнитель')} ${t('выполняет')}`, !last.route ? 'pending' : st === 'running' ? 'in_progress' : st === 'error' ? 'error' : 'completed'],
      [t('Результат'), st === 'done' ? 'completed' : st === 'error' ? 'error' : 'pending'],
    ];
    todo = phases.map(([tx, s]) => `<div class="todo ${s}">${esc(tx)}</div>`).join('');
  }
  const execs = [...new Map(chat.messages.filter(m => m.role === 'assistant' && m.label).map(m => [tl(m.label), m])).entries()];
  const files = [...new Set(chat.messages.flatMap(m => (m.steps || []).filter(s => s.path && (s.tool === 'create' || s.tool === 'edit')).map(s => s.path)))];
  const media = chat.messages.reduce((n, m) => n + (m.files?.length || 0), 0);
  const atts = chat.messages.reduce((n, m) => n + (m.images?.length || 0), 0);
  body.innerHTML = `
    <div class="pg-sec">${t('План')}</div>${todo}
    <div class="pg-sec">${t('В этой сессии')}</div>
    ${execs.map(([l, m]) => `<div class="pg-row">${provOf(m) ? provIcon(provOf(m)) : icon('terminal')}<span class="k">${esc(l)}</span></div>`).join('')}
    ${chat.cwd ? `<button class="pg-row" data-open-dir="${esc(chat.cwd)}">${icon('folder')}<span class="k">${t('Папка')}</span><span class="v">${esc(chat.cwd)}</span></button>` : ''}
    ${atts ? `<div class="pg-row">${icon('paperclip')}<span class="k">${t('Вложения')}</span><span class="v">${atts}</span></div>` : ''}
    ${media ? `<button class="pg-row" data-go="media">${icon('images')}<span class="k">${t('Медиа')}</span><span class="v">${media}</span></button>` : ''}
    ${files.length ? `<div class="pg-sec">${t('Изменённые файлы')}</div>${files.slice(0, 10).map(f => `<button class="pg-row" data-preview="${esc(f)}" title="${esc(f)}">${icon('file')}<span class="k" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.split(/[\\/]/).slice(-2).join('/'))}</span></button>`).join('')}` : ''}`;
}

/* ================= Отправка и очередь ================= */
function hasUltraWord(text) { ULTRA_RE.lastIndex = 0; return ULTRA_RE.test(text); }

function submit({ now = false } = {}) {
  const input = $('#input');
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  const chat = currentChat();
  if (!chat) return;
  const item = { id: uid(), text, mode: chat.kind === 'code' ? 'code' : state.mode, images: state.attachments, ultra: !!state.settings.ultra || hasUltraWord(text), arena: chat.kind === 'code' && arenaOn() };
  input.value = ''; state.attachments = []; renderAttachments(); syncInput();
  bump();
  if (isRunning(chat.id)) {
    const q = state.queue.get(chat.id) || [];
    if (now) q.unshift(item); else q.push(item);
    state.queue.set(chat.id, q);
    renderChat(true);
    if (now) stop(chat.id);
    return;
  }
  run(chat, item);
}
function bump() { const c = $('#composer'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }

async function run(chat, item, { retry = false } = {}) {
  const prevAssistant = [...chat.messages].reverse().find(m => m.role === 'assistant' && m.route);
  const history = chat.messages.filter(m => m.text).map(m => ({ role: m.role, text: m.text }));
  if (retry && history.at(-1)?.role === 'user') history.pop();
  const userMsg = { id: uid(), role: 'user', text: item.text, mode: item.mode, ultra: item.ultra, arena: !!item.arena, images: item.images.map(a => a.thumb), at: Date.now() };
  const aMsg = { id: uid(), role: 'assistant', status: 'running', text: '', steps: [], fallbacks: [], files: [], ultra: item.ultra, at: Date.now() };
  if (!retry) chat.messages.push(userMsg);
  chat.messages.push(aMsg);
  chat.todos = [];
  if (!chat.title) chat.title = (item.text || t('Изображение')).replace(/\s+/g, ' ').slice(0, 64);
  if (currentChat() === chat) { renderChat(true); renderCrumbs(); }
  persist(chat);
  pets.react('start');
  try {
    const taskId = await api.task.run({
      chatId: chat.id, text: item.text || t('Опиши изображение'), mode: item.mode, ultra: item.ultra, effort: state.settings.effort, team: chat.kind === 'code' && !!state.settings.team, arena: !!item.arena,
      executor: chat.executor || null, agentModel: chat.agentModel || null, chatModel: chat.chatModel || null,
      images: item.images.map(a => ({ mime: a.mime, data: a.data })),
      cwd: chat.cwd, history, sessions: chatSessions(chat), lastRoute: prevAssistant?.route || null,
    });
    state.tasks.set(taskId, { chatId: chat.id, msgId: aMsg.id, started: Date.now() });
    const early = earlyEvents.get(taskId);
    if (early) { earlyEvents.delete(taskId); for (const ev of early) await onTaskEvent(ev); }
    renderSidebar(); renderCrumbs(); updateSendBtn(); renderProgress();
  } catch (e) {
    Object.assign(aMsg, { status: 'error', error: cleanErr(e) });
    if (currentChat() === chat) renderChat();
    persist(chat);
  }
}

// События, пришедшие раньше, чем task.run вернул номер задачи
const earlyEvents = new Map();
async function onTaskEvent(ev) {
  const tk = state.tasks.get(ev.taskId);
  if (!tk) {
    const list = earlyEvents.get(ev.taskId) || [];
    if (list.length < 500) list.push(ev);
    earlyEvents.set(ev.taskId, list);
    setTimeout(() => earlyEvents.delete(ev.taskId), 30000);
    return;
  }
  const chat = state.cache.get(tk.chatId);
  const m = chat?.messages.find(x => x.id === tk.msgId);
  if (!m) return;
  switch (ev.kind) {
    case 'route': m.route = ev.route; m.reason = ev.reason; break;
    case 'executor': m.executor = ev.executor; m.label = ev.label; break;
    case 'cwd': m.cwd = ev.cwd; if (!chat.cwd) { chat.cwd = ev.cwd; if (currentChat() === chat) renderMeta(); } break;
    case 'delta': case 'text': {
      const prev = (m.text || '').length;
      m.text = ev.kind === 'delta' ? (m.text || '') + ev.text : ev.text;
      if (m.thinkAt && !m.thinkEnd) { m.thinkEnd = Date.now(); updateMessage(tk.chatId, tk.msgId); }
      if (currentChat() === chat && state.view.type === 'chat') { startReveal(m, prev); if ($(`.msg[data-id="${m.id}"] .md`)) return; }
      break;
    }
    case 'thinking': {
      const first = !m.thinking && !(ev.start && m.thinkAt);
      m.thinking = ev.text;
      if (!m.thinkAt) m.thinkAt = Date.now();
      if (!first && currentChat() === chat) { updateThink(m); return; }
      break;
    }
    case 'subagent': {
      m.subs = m.subs || [];
      let s = m.subs.find(x => x.id === ev.id);
      if (!s) { s = { id: ev.id, status: 'run', steps: [], at: ev.at || Date.now() }; m.subs.push(s); }
      for (const k of ['status', 'name', 'title', 'at', 'end', 'note']) if (ev[k] != null) s[k] = ev[k];
      // фоновый субагент: Task вернулся сразу, а работа идёт дальше — время считаем по последнему шагу
      if ((ev.step || ev.note) && !ev.status) s.end = Date.now();
      if (ev.step) {
        const st = s.steps.find(x => x.id === ev.step.id);
        if (st) Object.assign(st, Object.fromEntries(Object.entries(ev.step).filter(([, v]) => v)));
        else s.steps.push({ title: t('Шаг'), ...ev.step });
      }
      break;
    }
    case 'arena': arenaEvent(m, ev); break;
    case 'todos': chat.todos = ev.todos; break;
    case 'context': chat.context = { used: ev.used, window: ev.window || chat.context?.window || null, compactAt: ev.compactAt || null, model: ev.model || null, at: Date.now() }; if (currentChat() === chat) renderCtx(); break;
    case 'limits': setLimits(ev.provider, { status: ev.status, windows: ev.windows, at: ev.at || Date.now() }); break;
    case 'fallback': m.fallbacks.push({ from: ev.from, to: ev.to, reason: ev.reason, error: ev.error }); m.text = ''; m.steps = []; break;
    case 'step': {
      const s = m.steps.find(x => x.id === ev.id);
      const patch = Object.fromEntries(Object.entries({ status: ev.status, title: ev.title, detail: ev.detail, tool: ev.tool, path: ev.path }).filter(([, v]) => v));
      if (s) Object.assign(s, patch);
      else m.steps.push({ id: ev.id || uid(), title: t('Шаг'), detail: '', tool: 'other', ...patch });
      break;
    }
    case 'done':
      m.status = 'done';
      m.text = ev.text || m.text;
      if (ev.files) m.files = ev.files;
      if (ev.usage) m.usage = ev.usage;
      if (ev.context) { chat.context = { ...chat.context, ...ev.context, at: Date.now() }; if (currentChat() === chat) renderCtx(); }
      if (ev.sessionId && ev.executor && PROVIDERS[ev.executor]) chat.sessions = { ...chatSessions(chat), [ev.executor]: ev.sessionId };
      m.steps.forEach(s => { if (s.status === 'run') s.status = 'done'; });
      if (m.thinking && !m.thinkEnd) m.thinkEnd = Date.now();
      (m.subs || []).forEach(s => { if (s.status === 'run') { s.status = 'done'; s.end = s.end || Date.now(); } });
      if (chat.todos?.length) chat.todos = chat.todos.map(x => ({ ...x, status: x.status === 'in_progress' ? 'completed' : x.status }));
      break;
    case 'error':
      m.status = 'error';
      m.error = ev.error;
      m.code = ev.code || null;
      m.steps.forEach(s => { if (s.status === 'run') s.status = 'error'; });
      break;
  }
  if (ev.kind === 'done' || ev.kind === 'error') {
    m.ms = Date.now() - tk.started;
    state.tasks.delete(ev.taskId);
    if (m.route === 'chat' && m.status === 'done' && !m.text) m.error = t('Пустой ответ модели');
    await persist(chat);
    const stopped = ev.code === 'aborted';
    pets.react(ev.kind === 'done' || stopped ? 'done' : 'error');
    if (currentChat() !== chat) toast(`${ev.kind === 'done' ? t('Готово') : t('Ошибка')}: ${chat.title}`, ev.kind !== 'done');
    else { renderChat(); kickReveal(); }
    renderSidebar(); renderCrumbs(); renderProgress(); updateSendBtn();
    afterDone(chat, m, ev.kind === 'done');
    if (ev.kind === 'error' && ev.code === 'no_key') { state.settings = await api.settings.get(); updateKeyBanner(); }
    const q = state.queue.get(chat.id);
    if (q?.length) { const next = q.shift(); if (!q.length) state.queue.delete(chat.id); run(chat, next); }
    return;
  }
  updateMessage(tk.chatId, tk.msgId);
}

// Готово: открыть предпросмотр созданной страницы и сообщить, если окно не в фокусе
function afterDone(chat, m, ok) {
  if (m.executor === 'codex') refreshCodexLimits(true);
  const html = ok ? previewFile(m) : null;
  if (html && currentChat() === chat && state.settings.autoPreview !== false) {
    if (!chat.cwd && m.cwd) chat.cwd = m.cwd;
    Workbench.sync(chat).then(() => Workbench.openAbs(html));
  }
  if (!document.hasFocus() && state.settings.notify !== false && 'Notification' in window) {
    try {
      const n = new Notification(ok ? t('Готово') : t('Ошибка'), { body: `${chat.title || ''}${m.ms ? ` · ${fmtDur(m.ms)}` : ''}`, silent: false });
      n.onclick = () => { window.focus(); go({ type: 'chat', id: chat.id }); };
    } catch { /* уведомления недоступны */ }
  }
}

function stop(chatId = currentChat()?.id) {
  for (const [tid, x] of state.tasks) if (x.chatId === chatId) api.task.cancel(tid);
}
function sendNow(qid) {
  const chat = currentChat();
  const q = state.queue.get(chat.id) || [];
  const i = q.findIndex(x => x.id === qid);
  if (i < 0) return;
  const [item] = q.splice(i, 1);
  if (isRunning(chat.id)) { q.unshift(item); stop(chat.id); }
  else { if (!q.length) state.queue.delete(chat.id); run(chat, item); }
}
function retry(msgId) {
  const chat = currentChat();
  const idx = chat.messages.findIndex(m => m.id === msgId);
  const user = chat.messages.slice(0, idx).reverse().find(m => m.role === 'user');
  if (!user) return;
  chat.messages.splice(idx, 1);
  run(chat, { text: user.text, mode: user.mode || 'auto', images: [], ultra: !!user.ultra, arena: !!user.arena }, { retry: true });
}

/* ================= Композер ================= */
function highlightUltra(text, live = true) {
  ULTRA_RE.lastIndex = 0;
  let out = '', last = 0, m;
  while ((m = ULTRA_RE.exec(text))) {
    const start = m.index + m[1].length;
    out += esc(text.slice(last, start));
    out += [...m[2]].map((ch, i) => `<span class="rainbow-letter" style="--i:${i}">${esc(ch)}</span>`).join('');
    last = start + m[2].length;
  }
  out += esc(text.slice(last));
  return live ? out + '​' : out;
}
function syncInput() {
  const ta = $('#input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.34) + 'px';
  $('#hl').innerHTML = highlightUltra(ta.value);
  $('#hl').scrollTop = ta.scrollTop;
  const word = hasUltraWord(ta.value);
  $('#composer').classList.toggle('ultra', !!state.settings.ultra || word);
  if (word && !syncInput.wasWord) {
    const r = $('#composer').getBoundingClientRect();
    ascii.burst(r.left + r.width / 2, r.top);
    pets.react('ultra');
  }
  syncInput.wasWord = word;
  updateSendBtn();
}
function updateSendBtn() {
  const btn = $('#sendBtn');
  const chat = currentChat();
  const running = isRunning(chat?.id);
  const hasText = !!$('#input').value.trim() || state.attachments.length > 0;
  btn.classList.toggle('running', running && !hasText);
  btn.disabled = !running && !hasText;
  btn.title = running ? (hasText ? t('В очередь (Enter) · сразу — Ctrl+Enter') : t('Остановить (Esc)')) : t('Отправить (Enter)');
}

function renderMeta() {
  const chat = currentChat();
  if (!chat || !state.settings) return;
  const code = chat.kind === 'code';
  const env = $('#envBtn');
  env.querySelector('.mb-lbl').textContent = chat.cwd ? shortPath(chat.cwd) : (code ? t('Новая папка') : t('Папка'));
  env.classList.toggle('set', !!chat.cwd);
  env.title = chat.cwd || t('Рабочая папка для агента');
  const mode = $('#modeBtn');
  if (code) {
    mode.innerHTML = `<span class="mb-lbl">${state.settings.agentAccess === 'full' ? t('Полный доступ') : t('Правки файлов')}</span>`;
    mode.classList.toggle('set', state.settings.agentAccess === 'full');
  } else {
    mode.innerHTML = `${icon(MODES[state.mode].icon)}<span class="mb-lbl">${MODES[state.mode].label}</span>`;
    mode.classList.toggle('set', state.mode !== 'auto');
  }
  const mb = $('#agentBtn');
  let prov = null, label = t('Авто');
  if (code || !chat.chatModel) {
    if (chat.executor) { prov = chat.executor; label = chat.agentModel ? prettyModel(chat.agentModel) : PROVIDERS[prov].name; }
    else if (code) { const first = state.settings.codeExecutors.map(id => state.agents.find(a => a.id === id)).find(a => a?.installed); prov = first?.id || null; label = first?.label || t('Агент'); }
  }
  if (!code && chat.chatModel) { const or = /^or:/.test(chat.chatModel); prov = or ? 'openrouter' : 'gemini'; label = prettyModel(or ? chat.chatModel.slice(3) : chat.chatModel); }
  mb.innerHTML = `${provIcon(prov)}<span class="mb-lbl">${esc(label)}</span>`;
  mb.title = t('Модель');
  $('#ultraBtn').classList.toggle('on', !!state.settings.ultra);
  renderEffort();
  renderCtx();
  const tb = $('#teamBtn');
  tb.classList.toggle('hidden', !code);
  tb.classList.toggle('on', !!state.settings.team);
  const ab = $('#arenaBtn');
  ab.classList.toggle('hidden', !code);
  ab.classList.toggle('on', arenaOn());
  ab.querySelector('.mb-lbl').textContent = t('Арена');
  ab.title = t('Арена: большие модели планируют, спорят, пишут свои варианты и голосуют за лучший. Тратит намного больше лимитов.');
  $('#composer').classList.toggle('arena-on', code && arenaOn());
  if (state.view.type === 'chat') Workbench.sync(chat);
  $('#composer').classList.toggle('ultra', !!state.settings.ultra || hasUltraWord($('#input').value));
  $('#metaHint').textContent = code
    ? (chat.cwd || t('Агент работает в отдельной папке внутри Synapse'))
    : t('Synapse может ошибаться — проверяйте результат');
}

/* effort */
const EFFORTS = [
  { id: 'auto', bars: 0, label: 'Авто', hint: 'как настроено в агенте' },
  { id: 'low', bars: 1, label: 'Низкий', hint: 'быстро и экономно' },
  { id: 'medium', bars: 2, label: 'Средний', hint: 'баланс' },
  { id: 'high', bars: 3, label: 'Высокий', hint: 'думает тщательнее' },
  { id: 'xhigh', bars: 4, label: 'Очень высокий', hint: 'сложные задачи' },
  { id: 'max', bars: 5, label: 'Максимум', hint: 'без ограничений, дольше' },
];
function curEffort() {
  if (state.settings.ultra) return EFFORTS.at(-1);
  return EFFORTS.find(e => e.id === state.settings.effort) || EFFORTS[0];
}
function barsHtml(n) { return `<span class="bars" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`; }
function renderEffort() {
  const b = $('#effortBtn');
  if (!b) return;
  const e = curEffort();
  $$('.bars i', b).forEach((el, i) => { el.classList.toggle('on', i < e.bars); el.style.setProperty('--d', `${i * 40}ms`); });
  b.querySelector('.mb-lbl').textContent = t(e.label);
  b.classList.toggle('set', e.id !== 'auto');
  b.classList.toggle('ultra', !!state.settings.ultra);
  b.dataset.level = e.bars;
}
async function setEffort(id) {
  const patch = { effort: id };
  if (state.settings.ultra && id !== 'max') patch.ultra = false;
  state.settings = await api.settings.set(patch);
  if (patch.ultra === false) ascii.setUltra(false);
  renderMeta();
  const b = $('#effortBtn');
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
}
function effortMenu() {
  const cur = curEffort().id;
  menu($('#effortBtn'), [
    { label: t('Effort — сколько думать') },
    ...EFFORTS.map(e => ({ iconHtml: barsHtml(e.bars), text: t(e.label), hint: t(e.hint), sel: cur === e.id, act: () => setEffort(e.id) })),
    '-',
    { label: t('Claude Code и Codex — напрямую, Gemini — бюджет размышлений. Ultra = Максимум.') },
  ], { align: 'right' });
}
function cycleEffort() {
  const i = EFFORTS.findIndex(e => e.id === curEffort().id);
  setEffort(EFFORTS[(i + 1) % EFFORTS.length].id);
  toast(`Effort: ${t(EFFORTS[(i + 1) % EFFORTS.length].label)}`);
}

async function toggleUltra() {
  const on = !state.settings.ultra;
  state.settings = await api.settings.set({ ultra: on });
  renderMeta();
  ascii.setUltra(on);
  if (on) {
    const b = $('#ultraBtn').getBoundingClientRect();
    sparks(b.left + b.width / 2, b.top + b.height / 2);
    const c = $('#composer').getBoundingClientRect();
    ascii.burst(c.left + c.width / 2, c.top);
    pets.react('ultra');
    bump();
  }
}
function sparks(x, y) {
  if (reduceMotion()) return;
  const colors = ['#ff7a8a', '#ffb86b', '#ffe66b', '#7dffb5', '#6bd6ff', '#b98bff'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
    const d = 30 + Math.random() * 50;
    s.style.left = x + 'px'; s.style.top = y + 'px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d - 20}px`);
    s.style.setProperty('--rot', `${Math.random() * 360}deg`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 950);
  }
}

/* вложения */
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) { toast(`${f.name}${t(': можно прикреплять только изображения')}`, true); continue; }
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name}${t(': больше 20 МБ')}`, true); continue; }
    if (state.attachments.length >= 6) { toast(t('Не больше 6 изображений'), true); break; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    state.attachments.push({ name: f.name, mime: f.type, data: dataUrl.split(',')[1], thumb: await thumb(dataUrl) });
  }
  renderAttachments(); updateSendBtn();
}
function thumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}
function renderAttachments() {
  $('#attachments').innerHTML = state.attachments.map((a, i) => `<div class="att"><img src="${a.thumb}" alt=""><button data-rm-att="${i}" title="${t('Убрать')}">${icon('x')}</button></div>`).join('');
}

/* ================= Меню ================= */
let popClose = null;
function menu(anchor, items, { align = 'left', onClose } = {}) {
  const el = $('#menu');
  let n = 0;
  el.innerHTML = items.map((it, idx) => {
    if (it === '-') return '<div class="menu-sep"></div>';
    if (it.label && !it.act) return `<div class="menu-label">${esc(it.label)}</div>`;
    return `<button class="menu-item ${it.sel ? 'sel' : ''} ${it.danger ? 'danger' : ''}" data-i="${idx}" ${it.disabled ? 'disabled' : ''} style="--i:${n++}">
      ${it.iconHtml || (it.icon ? icon(it.icon) : '')}<span class="mi-text">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}${it.check !== false ? `<span class="mi-check">${icon('check')}</span>` : ''}</button>`;
  }).join('');
  closePopovers();
  el.classList.add('open');
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let top = r.top - mh - 6, origin = 'bottom';
  if (top < 8) { top = r.bottom + 6; origin = 'top'; }
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  Object.assign(el.style, { top: top + 'px', left: left + 'px' });
  el.style.setProperty('--origin', `${origin} ${align}`);
  popClose = onClose || null;
  el.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    const it = items[Number(b.dataset.i)];
    closePopovers();
    it.act?.(e);
  };
}
function closePopovers() {
  $('#menu').classList.remove('open');
  $('#ctxPop')?.classList.remove('open');
  if (popClose) { const f = popClose; popClose = null; f(); }
}

function plusMenu() {
  const chat = currentChat();
  menu($('#plusBtn'), [
    { icon: 'image', text: t('Прикрепить изображение'), check: false, act: () => $('#fileInput').click() },
    { icon: 'folder', text: chat.cwd ? t('Сменить папку…') : t('Выбрать папку…'), check: false, act: pickFolder },
    ...(chat.cwd ? [{ icon: 'x', text: t('Отвязать папку'), check: false, act: () => setCwd(null) }] : []),
  ]);
}
async function envMenu() {
  const chat = currentChat();
  const recent = await api.recentFolders();
  const p = projectOf(chat);
  const folders = [...new Set([...(p?.folder ? [p.folder] : []), ...(chat.cwd ? [chat.cwd] : []), ...recent])].slice(0, 8);
  menu($('#envBtn'), [
    { label: t('Окружение') },
    { icon: 'laptop', text: t('Новая папка в Synapse'), sel: !chat.cwd, act: () => setCwd(null) },
    ...folders.map(f => ({ icon: 'folder', text: shortPath(f), hint: f.length > 36 ? '…' + f.slice(-32) : f, sel: chat.cwd === f, act: () => setCwd(f) })),
    '-',
    { icon: 'folderOpen', text: t('Выбрать папку…'), check: false, act: pickFolder },
  ]);
}
function modeMenu() {
  const chat = currentChat();
  if (chat.kind === 'code') {
    const a = state.settings.agentAccess;
    return menu($('#modeBtn'), [
      { label: t('Права агента') },
      { icon: 'pencil', text: t('Правки файлов'), hint: t('безопасно'), sel: a !== 'full', act: () => setAccess('edits') },
      { icon: 'zap', text: t('Полный доступ'), hint: t('любые команды'), sel: a === 'full', act: () => setAccess('full') },
    ]);
  }
  menu($('#modeBtn'), [
    { label: t('Кому отдать задачу') },
    ...Object.entries(MODES).map(([k, v]) => ({ icon: v.icon, text: v.label, hint: v.hint, sel: state.mode === k, act: () => { state.mode = k; renderMeta(); $('#input').focus(); } })),
  ]);
}
async function agentMenu() {
  const chat = currentChat();
  const code = chat.kind === 'code';
  const agents = state.agents.length ? state.agents : await detectAgents();
  const pickAgent = (id, model) => { chat.executor = id; chat.agentModel = model; if (!code) chat.chatModel = null; resetSessions(chat); renderMeta(); persist(chat); };
  const items = [
    { label: t('Модель') },
    { icon: 'sparkles', text: t('Авто'), hint: t('Synapse выберет'), sel: !chat.executor && !chat.chatModel, act: () => { chat.executor = null; chat.agentModel = null; chat.chatModel = null; renderMeta(); persist(chat); } },
  ];
  for (const a of agents) {
    items.push('-', { label: a.label + (a.installed ? '' : ` · ${t('не установлен')}`) });
    items.push({ iconHtml: provIcon(a.id), text: t('По умолчанию'), disabled: !a.installed, sel: chat.executor === a.id && !chat.agentModel, act: () => pickAgent(a.id, null) });
    for (const m of agentModels(a)) {
      items.push({ iconHtml: provIcon(a.id), text: prettyModel(m), hint: m, disabled: !a.installed, sel: chat.executor === a.id && chat.agentModel === m, act: () => pickAgent(a.id, m) });
    }
  }
  if (!code) {
    const gm = [...new Set([state.settings.models.chat, state.settings.models.chatUltra, ...(await geminiChatModels())])].slice(0, 8);
    if (state.settings.hasKey) {
      items.push('-', { label: t('Gemini · чат') });
      for (const m of gm) items.push({ iconHtml: provIcon('gemini'), text: prettyModel(m), hint: m, sel: chat.chatModel === m, act: () => { chat.chatModel = m; renderMeta(); persist(chat); } });
    }
    if (state.settings.hasOrKey) {
      items.push('-', { label: t('OpenRouter · чат') });
      for (const m of orChatModels()) items.push({ iconHtml: provIcon('openrouter'), text: prettyModel(m), hint: m, sel: chat.chatModel === `or:${m}`, act: () => { chat.chatModel = `or:${m}`; renderMeta(); persist(chat); } });
    }
  }
  items.push('-', { icon: 'settings', text: t('Настроить модели…'), check: false, act: () => openSettings('agents') });
  menu($('#agentBtn'), items, { align: 'right' });
}
async function setAccess(v) { state.settings = await api.settings.set({ agentAccess: v }); renderMeta(); if (v === 'full') toast(t('Полный доступ: агент сможет выполнять любые команды')); }
async function pickFolder() { const d = await api.pickFolder(); if (d) setCwd(d); }
function setCwd(dir) {
  const chat = currentChat();
  chat.cwd = dir; resetSessions(chat);
  renderChat(); persist(chat);
}

function chatMenu(id, anchor) {
  const meta = state.chats.find(c => c.id === id) || state.cache.get(id);
  anchor.classList?.add('open');
  menu(anchor, [
    { icon: 'pencil', text: t('Переименовать'), check: false, act: () => renameChat(id) },
    { icon: 'pin', text: meta?.pinned ? t('Открепить') : t('Закрепить'), check: false, act: () => togglePin(id) },
    { icon: 'moveTo', text: t('В проект…'), check: false, act: () => moveMenu(id, anchor) },
    { icon: 'folderOpen', text: t('Открыть папку'), check: false, act: async () => { const c = await loadChat(id); if (c?.cwd) api.open(c.cwd); else toast(t('У чата нет рабочей папки')); } },
    '-',
    { icon: 'trash', text: t('Удалить'), danger: true, check: false, act: () => deleteChat(id) },
  ], { onClose: () => anchor.classList?.remove('open') });
}
function moveMenu(id, anchor) {
  setTimeout(async () => {
    const chat = await loadChat(id);
    menu(anchor, [
      { label: t('Переместить в проект') },
      { icon: 'x', text: t('Без проекта'), sel: !chat.projectId, act: () => moveTo(chat, null) },
      ...state.projects.map(p => ({ icon: 'folder', text: p.name, sel: chat.projectId === p.id, act: () => moveTo(chat, p.id) })),
      '-',
      { icon: 'plus', text: t('Новый проект…'), check: false, act: () => go({ type: 'projects', create: true, moveChat: id }) },
    ]);
  }, 10);
}
async function moveTo(chat, projectId) {
  chat.projectId = projectId;
  const p = projectOf(chat);
  if (p?.folder && !chat.cwd) chat.cwd = p.folder;
  await persist(chat);
  render();
  toast(p ? `${t('Перемещено в «')}${p.name}»` : t('Убрано из проекта'));
}
async function togglePin(id) {
  const chat = await loadChat(id);
  chat.pinned = !chat.pinned;
  await persist(chat);
}
async function renameChat(id) {
  const chat = await loadChat(id);
  const target = state.view.id === id && $('#crumbTitle') ? $('#crumbTitle span') : $(`.row-item[data-chat="${id}"] .t`);
  if (!target) return;
  inlineEdit(target, chat.title, async (v) => { chat.title = v; await persist(chat); renderCrumbs(); });
}
function inlineEdit(el, value, onSave) {
  const input = document.createElement('input');
  input.className = 'input';
  input.style.cssText = 'height:26px;width:260px;padding:0 8px';
  input.value = value || '';
  const prev = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    const v = input.value.trim();
    el.innerHTML = prev;
    if (save && v && v !== value) onSave(v); else renderSidebar();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
}
async function deleteChat(id) {
  stop(id);
  state.queue.delete(id);
  await api.chats.remove(id);
  state.cache.delete(id);
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.view.type === 'chat' && state.view.id === id) newChat(state.tab);
  else renderSidebar();
  toast(t('Удалено'));
}

/* ================= Страницы ================= */
async function renderPage() {
  const v = state.view;
  const el = $('#viewPage');
  const when = (ts) => new Date(ts).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short' });
  if (v.type === 'projects') {
    el.innerHTML = `<div class="page-inner">
      <div class="page-head"><h1>${t('Проекты')}</h1><span class="grow"></span><button class="btn primary" id="newProjBtn">${icon('plus')}${t('Новый проект')}</button></div>
      <div id="projForm"></div>
      <div class="cards">
        ${state.projects.map((p, i) => {
          const n = state.chats.filter(c => c.projectId === p.id).length;
          return `<button class="card" data-go-project="${p.id}" style="--i:${i}">
            <b>${icon('folder')}${esc(p.name)}</b>
            <span class="sub">${esc(p.folder || t('без папки'))}</span>
            <span class="foot">${n} ${plural(n, [t('чат'), t('чата'), t('чатов')])} · ${when(p.updatedAt || p.createdAt)}${p.pinned ? t(' · закреплён') : ''}</span>
          </button>`;
        }).join('')}
        <button class="card new" id="newProjCard" style="--i:${state.projects.length}">${icon('plusSquare')}<span>${t('Новый проект')}</span></button>
      </div></div>`;
    const showForm = () => {
      let folder = null;
      $('#projForm').innerHTML = `<div class="inline-form">
        <input class="input" id="projName" placeholder="${t('Название проекта')}" style="flex:1">
        <button class="btn" id="projFolder">${icon('folder')}<span>${t('Папка')}</span></button>
        <button class="btn primary" id="projCreate">${t('Создать')}</button>
        <button class="icon-btn" id="projCancel">${icon('x')}</button></div>`;
      $('#projName').focus();
      $('#projFolder').onclick = async () => { const d = await api.pickFolder(); if (d) { folder = d; $('#projFolder span').textContent = shortPath(d); if (!$('#projName').value) $('#projName').value = shortPath(d); } };
      $('#projCancel').onclick = () => { $('#projForm').innerHTML = ''; };
      const create = async () => {
        const name = $('#projName').value.trim();
        if (!name) return toast(t('Введите название'), true);
        const p = await api.projects.save({ id: uid(), name, folder, pinned: true });
        await refreshProjects();
        if (v.moveChat) { const c = await loadChat(v.moveChat); if (c) await moveTo(c, p.id); }
        go({ type: 'project', id: p.id });
      };
      $('#projCreate').onclick = create;
      $('#projName').onkeydown = (e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') $('#projCancel').click(); };
    };
    $('#newProjBtn').onclick = showForm;
    $('#newProjCard').onclick = showForm;
    if (v.create) showForm();
  }
  if (v.type === 'project') {
    const p = state.projects.find(x => x.id === v.id);
    if (!p) return go({ type: 'projects' });
    const chats = state.chats.filter(c => c.projectId === p.id);
    el.innerHTML = `<div class="page-inner">
      <div class="page-head">
        <h1 id="projTitle">${esc(p.name)}</h1>
        <button class="icon-btn" id="projMore" title="${t('Ещё')}">${icon('more')}</button>
        <span class="grow"></span>
        <button class="btn" id="projNewCode">${icon('code')}${t('Сессия кода')}</button>
        <button class="btn primary" id="projNewChat">${icon('plus')}${t('Новый чат')}</button>
      </div>
      <div class="row" style="margin:-6px 0 18px">
        <button class="meta-btn ${p.folder ? 'set' : ''}" id="projFolderBtn">${icon('folder')}<span class="mb-lbl">${esc(p.folder || t('Привязать папку проекта'))}</span></button>
      </div>
      ${chats.length ? `<div class="list">${chats.map(c => `<button class="li" data-chat="${c.id}">${icon(c.kind === 'code' ? 'code' : 'message')}<span class="t">${esc(c.title || t('Без названия'))}</span><span class="when">${when(c.updatedAt)}</span></button>`).join('')}</div>`
        : `<div class="empty-page">${t('В проекте пока нет чатов. Новые чаты будут работать в папке проекта.')}</div>`}
    </div>`;
    $('#projNewChat').onclick = () => newChat('chat', { projectId: p.id });
    $('#projNewCode').onclick = () => newChat('code', { projectId: p.id });
    $('#projFolderBtn').onclick = async () => { const d = await api.pickFolder(); if (d) { await api.projects.save({ ...p, folder: d }); await refreshProjects(); renderPage(); } };
    $('#projMore').onclick = (e) => menu(e.currentTarget, [
      { icon: 'pencil', text: t('Переименовать'), check: false, act: () => inlineEdit($('#projTitle'), p.name, async (name) => { await api.projects.save({ ...p, name }); await refreshProjects(); render(); }) },
      { icon: 'pin', text: p.pinned ? t('Открепить') : t('Закрепить'), check: false, act: async () => { await api.projects.save({ ...p, pinned: !p.pinned }); await refreshProjects(); } },
      ...(p.folder ? [{ icon: 'folderOpen', text: t('Открыть папку'), check: false, act: () => api.open(p.folder) }] : []),
      '-',
      { icon: 'trash', text: t('Удалить проект'), danger: true, check: false, act: async () => { await api.projects.remove(p.id); await Promise.all([refreshProjects(), refreshChats()]); state.cache.forEach(c => { if (c.projectId === p.id) c.projectId = null; }); go({ type: 'projects' }); toast(t('Проект удалён, чаты сохранены')); } },
    ]);
  }
  if (v.type === 'stats') return renderStats(el);
  if (v.type === 'changelog') {
    const md = await api.changelog();
    el.innerHTML = `<div class="page-inner narrow"><div class="page-head"><h1>${t('Что нового')}</h1><span class="grow"></span><span class="dim">Synapse ${esc(state.settings.version)}</span></div>
      <div class="md changelog">${md ? DOMPurify.sanitize(marked.parse(md.replace(/^# .*\n/, ''))) : `<p class="dim">${t('Список изменений не найден.')}</p>`}</div></div>`;
    return;
  }
  if (v.type === 'extensions') return Extensions.render(el);
  if (v.type === 'media') {
    const items = await api.media();
    el.innerHTML = `<div class="page-inner">
      <div class="page-head"><h1>${t('Медиа')}</h1><span class="grow"></span><span style="color:var(--muted);font-size:13px">${items.length} ${plural(items.length, [t('файл'), t('файла'), t('файлов')])}</span></div>
      ${items.length ? `<div class="gallery">${items.map((f, i) => `
        <div class="g-item" style="--i:${Math.min(i, 20)}">
          ${f.type === 'video' ? `<video src="${f.url}" controls loop playsinline></video>` : `<img src="${f.url}" alt="" data-zoom="${f.url}" loading="lazy">`}
          <button class="g-cap" data-chat="${f.chatId}">${icon('message')}<span>${esc(f.chatTitle || t('Чат'))}</span></button>
        </div>`).join('')}</div>`
        : `<div class="empty-page">${t('Здесь появятся изображения и видео, которые вы создадите.')}</div>`}
    </div>`;
  }
}

/* ================= Статистика ================= */
// Как профиль в Codex: токены за всё время, рекорды, серии, тепловая карта активности
const fmtBig = (n) => {
  n = Number(n) || 0;
  const en = I18N.lang === 'en';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + (en ? 'B' : ' млрд');
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + (en ? 'M' : ' млн');
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + (en ? 'K' : ' тыс');
  return String(n);
};
const fmtLong = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return fmtSec(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} ${t('ч')} ${m} ${t('мин')}` : fmtSec(s);
};
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let statsMode = 'days';
const EFFORT_NAME = { auto: 'Авто', low: 'Низкий', medium: 'Средний', high: 'Высокий', xhigh: 'Очень высокий', max: 'Максимум' };

function heatmapHtml(st) {
  // 53 недели, столбец = неделя (пн..вс), как в GitHub / Codex
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 7 * 52 - ((today.getDay() + 6) % 7));
  const cols = [];
  const months = [];
  let cum = 0;
  for (let w = 0; w < 53; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      if (day > today) { col.push(null); continue; }
      const k = dayStr(day);
      const v = st.days[k]?.tokens || 0;
      cum += v;
      col.push({ k, v, tasks: st.days[k]?.tasks || 0, cum });
      if (d === 0 && day.getDate() <= 7) months.push({ w, label: day.toLocaleDateString(I18N.locale, { month: 'short' }) });
    }
    cols.push(col);
  }
  if (statsMode === 'cumulative') {
    const pts = cols.flat().filter(Boolean);
    const max = Math.max(1, pts.at(-1)?.cum || 0);
    const W = 1000, H = 150;
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1) * W).toFixed(1)},${(H - p.cum / max * (H - 8) - 4).toFixed(1)}`).join(' ');
    return `<svg class="cum-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('Нарастающим итогом')}">
      <path class="cum-area" d="${path} L${W},${H} L0,${H} Z"/><path class="cum-line" d="${path}" vector-effect="non-scaling-stroke"/></svg>
      <div class="hm-months">${months.map(m => `<span style="left:${(m.w / 53 * 100).toFixed(2)}%">${esc(m.label)}</span>`).join('')}</div>`;
  }
  const vals = statsMode === 'weeks' ? cols.map(c => c.reduce((a, x) => a + (x?.v || 0), 0)) : cols.flat().filter(Boolean).map(x => x.v);
  const max = Math.max(1, ...vals);
  const lvl = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil(v / max * 4)));
  const body = statsMode === 'weeks'
    ? cols.map((c, w) => { const v = vals[w]; const first = c.find(Boolean); return `<div class="hm-col week"><i class="l${lvl(v)}" style="--d:${w}" title="${first ? esc(first.k) : ''} · ${fmtBig(v)} ${t('токенов')}"></i></div>`; }).join('')
    : cols.map((c, w) => `<div class="hm-col">${c.map(x => (x ? `<i class="l${lvl(x.v)}" style="--d:${w}" title="${esc(x.k)} · ${fmtBig(x.v)} ${t('токенов')} · ${x.tasks} ${plural(x.tasks, [t('задача'), t('задачи'), t('задач')])}"></i>` : '<i class="none"></i>')).join('')}</div>`).join('');
  return `<div class="heatmap ${statsMode}">${body}</div>
    <div class="hm-months">${months.map(m => `<span style="left:${(m.w / 53 * 100).toFixed(2)}%">${esc(m.label)}</span>`).join('')}</div>
    <div class="hm-legend">${t('Меньше')}<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>${t('Больше')}</div>`;
}

async function renderStats(el) {
  const st = await api.stats();
  const name = state.settings.user || 'user';
  const execName = (id) => PROVIDERS[id]?.name || ({ arena: t('Арена'), chat: t('Чат'), code: t('Код'), image: t('Изображения'), video: t('Видео') }[id] || id);
  const byEx = Object.entries(st.byExecutor).sort((a, b) => b[1].tokens - a[1].tokens || b[1].tasks - a[1].tasks);
  const maxEx = Math.max(1, ...byEx.map(([, v]) => v.tokens));
  const cells = [
    [fmtBig(st.total), t('Токены за всё время')],
    [fmtBig(st.maxDay.tokens), t('Максимум токенов за день')],
    [st.longest ? fmtLong(st.longest.ms) : '—', t('Самая длительная задача')],
    [`${st.streak.best} ${plural(st.streak.best, [t('день'), t('дня'), t('дней')])}`, t('Самая длинная серия')],
    [`${st.streak.current} ${plural(st.streak.current, [t('день'), t('дня'), t('дней')])}`, t('Текущая серия')],
  ];
  el.innerHTML = `<div class="page-inner narrow stats-page">
    <div class="profile">
      <span class="avatar xl">${esc(name.slice(0, 1).toUpperCase())}</span>
      <h1>${esc(name)}</h1>
      <button class="btn sm name-edit" id="nameEdit">${icon('pencil')}${t('Изменить')}</button>
      <span class="dim">${st.first ? t('С нами с {d}', { d: new Date(st.first).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('Здесь появится ваша статистика')}</span>
    </div>
    <div class="stat-strip">${cells.map(([v, l], i) => `<div class="ss-cell" style="--i:${i}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>

    <section class="st-sec">
      <div class="st-head"><h3>${t('Активность токенов')}</h3><span class="grow"></span>
        <div class="seg-text">${[['days', t('По дням')], ['weeks', t('По неделям')], ['cumulative', t('Нарастающим итогом')]].map(([k, l]) => `<button data-stats-mode="${k}" class="${statsMode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="hm-wrap">${heatmapHtml(st)}</div>
    </section>

    <section class="st-sec">
      <div class="st-head"><h3>${t('Исполнители')}</h3></div>
      ${byEx.length ? `<div class="ex-bars">${byEx.map(([id, v], i) => `<div class="ex-row" style="--i:${i}">
        <span class="ex-name">${provIcon(PROVIDERS[id] ? id : null)}${esc(execName(id))}</span>
        <span class="ex-bar"><i style="--w:${(v.tokens / maxEx * 100).toFixed(1)}%"></i></span>
        <span class="ex-val">${fmtBig(v.tokens)}<small>${v.tasks} ${plural(v.tasks, [t('задача'), t('задачи'), t('задач')])}</small></span></div>`).join('')}</div>`
        : `<div class="st-empty">${t('Пока нет задач — статистика появится после первой.')}</div>`}
    </section>

    ${st.models.length ? `<section class="st-sec">
      <div class="st-head"><h3>${t('Любимые модели')}</h3></div>
      <div class="model-list">${st.models.map((m, i) => `<div class="ml-row" style="--i:${i}">${provIcon(PROVIDERS[m.executor] ? m.executor : null)}<span class="ml-name">${esc(prettyModel(m.id))}<small class="mono">${esc(m.id)}</small></span><span class="ml-val">${fmtBig(m.tokens)}</span></div>`).join('')}</div>
    </section>` : ''}

    <section class="st-sec">
      <div class="st-head"><h3>${t('Статистика')}</h3></div>
      <div class="kv">
        <div><span>${t('Всего задач')}</span><b>${st.tasks}${st.tasks ? ` · ${Math.round(st.ok / st.tasks * 100)}% ${t('успешно')}` : ''}</b></div>
        <div><span>${t('Новые токены / из кэша')}</span><b>${fmtBig(st.fresh)} / ${fmtBig(st.cache)}</b></div>
        <div><span>${t('Токены рассуждений')}</span><b>${fmtBig(st.thinking)}</b></div>
        <div><span>${t('Наиболее частый уровень рассуждений')}</span><b>${st.effort ? `${t(EFFORT_NAME[st.effort.level] || st.effort.level)} · ${st.effort.share}%` : '—'}</b></div>
        <div><span>${t('Режим Ultra')}</span><b>${st.ultra ? `${st.ultra} ${plural(st.ultra, [t('раз'), t('раза'), t('раз')])}` : t('Не используется')}</b></div>
        <div><span>${t('Запусков Арены')}</span><b>${st.arena}</b></div>
        <div><span>${t('Активных дней')}</span><b>${st.activeDays}</b></div>
        ${st.cost ? `<div><span>${t('Стоимость по прайсу API')}</span><b>$${st.cost.toFixed(2)}</b></div>` : ''}
      </div>
      <div class="hint">${t('Считается на этом компьютере по ответам агентов и API. По подписке вы платите фиксированно — прайс показан для сравнения.')}</div>
    </section>
  </div>`;
  el.querySelectorAll('[data-stats-mode]').forEach(b => b.addEventListener('click', () => { statsMode = b.dataset.statsMode; renderStats(el); }));
  el.querySelector('#nameEdit')?.addEventListener('click', editNameInline);
  el.querySelector('.profile h1')?.addEventListener('dblclick', editNameInline);
}

/* ================= Имя пользователя ================= */
function renderAccount() {
  $('#accName').textContent = state.settings.user || 'user';
  $('#avatar').textContent = (state.settings.user || 'S')[0].toUpperCase();
}
async function saveName(v) {
  v = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  await saveSettings({ displayName: v === state.settings.osUser ? '' : v });
  renderAccount();
  toast(t('Имя сохранено'));
}
// Редактирование имени прямо на странице статистики
function editNameInline() {
  const h = $('.profile h1');
  if (!h || h.querySelector('input')) return;
  const cur = state.settings.user || '';
  h.innerHTML = `<input class="input name-input" maxlength="40" value="${esc(cur)}" placeholder="${esc(state.settings.osUser || '')}" spellcheck="false">`;
  const inp = h.querySelector('input');
  inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save && inp.value.trim() !== cur) await saveName(inp.value);
    if (state.view.type === 'stats') renderStats($('#viewPage'));
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}

/* ================= Меню аккаунта ================= */
// Как в Claude: настройки, статистика, язык, что нового, справка
function accountMenu() {
  const s = state.settings;
  menu($('#accountBtn'), [
    { label: s.user || 'user' },
    { icon: 'settings', text: t('Настройки'), hint: 'Ctrl ,', check: false, act: () => openSettings() },
    { icon: 'chart', text: t('Статистика'), check: false, act: () => go({ type: 'stats' }) },
    { icon: 'pencil', text: t('Изменить имя'), check: false, act: async () => { if (state.view.type !== 'stats') go({ type: 'stats' }); setTimeout(editNameInline, 350); } },
    { icon: 'globe', text: t('Язык'), hint: I18N.lang === 'en' ? 'English' : 'Русский', check: false, act: () => languageMenu() },
    '-',
    { icon: 'bot', text: t('Агенты и модели'), check: false, act: () => openSettings('agents') },
    { icon: 'key', text: t('Ключи API'), check: false, act: () => openSettings('api') },
    '-',
    { icon: 'sparkles', text: t('Что нового'), hint: s.version, check: false, act: () => go({ type: 'changelog' }) },
    { icon: 'help', text: t('Справка и ошибки'), check: false, act: () => window.open('https://github.com/wsq4kar/synapse/issues') },
    { icon: 'info', text: t('О программе'), check: false, act: () => openSettings('about') },
  ]);
}
async function setLang(l) {
  if (l === I18N.lang) return;
  await saveSettings({ lang: l });
  applyLang();
}
function languageMenu() {
  menu($('#accountBtn'), [
    { label: t('Язык') },
    { text: 'Русский', sel: I18N.lang === 'ru', act: () => setLang('ru') },
    { text: 'English', sel: I18N.lang === 'en', act: () => setLang('en') },
  ]);
}

/* ================= Настройки ================= */
let stab = 'api';
// Слова для поиска по настройкам (RU + EN)
const SETTINGS_WORDS = {
  api: 'gemini openrouter ключ key api модель model чат chat изображения image видео video veo nano banana маршрутизатор router',
  agents: 'агент agent claude codex antigravity opencode модели models путь path арена arena порядок order вход login папка folder',
  memory: 'память memory обо мне about claude.md скиллы skills коннекторы connectors mcp плагины plugins',
  look: 'тема theme тёмная dark светлая light шрифт font размер size цвет color accent акцент анимации motion язык language ascii пузыри',
  pets: 'питомцы pets',
  net: 'сеть network прокси proxy ssh vpn firewall брандмауэр туннель tunnel',
  log: 'журнал log история history задачи tasks',
  about: 'о программе about версия version клавиши shortcuts',
};
let modelsCache = null;
let orModelsCache = null;
function openSettings(tab = stab) { stab = tab; $('#settingsModal').classList.add('open'); renderSettings(); }
function closeSettings() { $('#settingsModal').classList.remove('open'); }
async function saveSettings(patch) { state.settings = await api.settings.set(patch); return state.settings; }
function cleanErr(e) { return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

function lookHtml() {
  const l = look();
  const seg = (k, opts) => `<div class="seg${k === 'font' ? ' font-seg' : ''}">${opts.map(([v, label, extra]) =>
    `<button data-look-k="${k}" data-look-v="${v}" class="${String(l[k]) === String(v) ? 'on' : ''}"${extra ? ` style="${extra}"` : ''}>${label}</button>`).join('')}</div>`;
  const ACC = [['teal', '#0f9b7f'], ['blue', '#3b82f6'], ['violet', '#8b5cf6'], ['pink', '#e0498f'], ['orange', '#ea6c1a'], ['red', '#dc4a4a'], ['graphite', '#64676f']];
  return `<div class="field"><span class="field-label">${t('Шрифт')}</span>${seg('font', [
      ['system', t('Системный'), '--f:var(--font)'], ['rounded', t('Скруглённый'), '--f:var(--font-round)'],
      ['serif', t('С засечками'), '--f:ui-serif,Georgia,serif'], ['mono', t('Моноширинный'), '--f:var(--mono)'], ['readable', t('Для чтения'), '--f:Verdana,Tahoma,sans-serif']])}</div>
    <div class="field"><span class="field-label">${t('Размер текста')}</span>${seg('size', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']])}</div>
    <div class="field"><span class="field-label">${t('Цвет акцента')}</span><div class="swatches">${ACC.map(([k, c]) =>
      `<button class="swatch ${l.accent === k ? 'on' : ''}" style="--sw:${c}" data-look-k="accent" data-look-v="${k}" title="${k}"></button>`).join('')}</div></div>
    <div class="field"><span class="field-label">${t('Ширина переписки')}</span>${seg('width', [['s', t('Узкая')], ['m', t('Обычная')], ['l', t('Широкая')]])}</div>
    <div class="field"><span class="field-label">${t('Анимации')}</span>${seg('motion', [['system', t('Как в системе')], ['reduce', t('Минимум')]])}</div>
    <div class="field"><span class="field-label">${t('Отправка сообщения')}</span>${seg('send', [['enter', 'Enter'], ['ctrl', 'Ctrl + Enter']])}</div>
    <div class="toggle-row" data-look-toggle="bubbles"><span class="switch ${l.bubbles !== false ? 'on' : ''}"></span>
      <span class="tr-text">${t('Пузыри у моих сообщений')}<small>${t('Если выключить, ваши сообщения будут простым текстом')}</small></span></div>
    <div class="field-label" style="margin-top:14px">${t('Предпросмотр')}</div>
    <div class="look-preview"><b>Synapse</b> — ${t('так будет выглядеть текст в переписке. Код, ответы и рассуждения используют этот шрифт и размер.')}<br><span class="lp-chip">${t('Акцент')}</span></div>`;
}

// OpenRouter: ключ и модели (пустое поле — модель из models.json)
function orSettingsHtml(s) {
  const def = s.catalog?.openrouter || {}, own = s.openrouter || {};
  const field = (k, label, hint, filter) => `<div class="field"><label>${label}</label>
    <input class="input mono" data-or-model="${k}" list="orList-${k}" value="${esc(own[k] || '')}" placeholder="${esc(def[k] || '')}" spellcheck="false">
    <datalist id="orList-${k}">${(orModelsCache || []).filter(filter).slice(0, 400).map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</datalist>
    <div class="hint">${hint}</div></div>`;
  const text = m => m.output.includes('text');
  return `<h2 class="or-h">${provIcon('openrouter')}OpenRouter</h2>
    <p class="lead">${t('Сотни моделей — Claude, GPT, Gemini, DeepSeek, Kimi и другие — по одному ключу. Если ключа Gemini нет, чат, маршрутизатор и изображения работают через OpenRouter. Модели openrouter/… получает и агент OpenCode.')}</p>
    <div class="field"><label>${t('Ключ API')}</label>
      <div class="row"><input class="input mono" id="orKeyInput" type="password" placeholder="${s.hasOrKey ? t('Ключ сохранён — введите новый, чтобы заменить') : 'sk-or-…'}" spellcheck="false" autocomplete="off">
        <button class="btn" id="orKeyShow">${icon('eye')}</button><button class="btn primary" id="orKeySave">${t('Сохранить')}</button></div>
      <div class="hint"><a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a> → Create key. ${t('Хранится только на этом компьютере в зашифрованном виде.')} ${s.hasOrKey ? ('<a href="#" id="orKeyRemove" style="color:var(--danger)">' + t('Удалить ключ') + '</a>') : ''}</div></div>
    <div class="row" style="margin:-4px 0 20px">
      <button class="btn" id="orKeyTest" ${s.hasOrKey ? '' : 'disabled'}>${icon('check')}${t('Проверить ключ')}</button>
      <button class="btn" id="orLoadModels">${icon('refresh')}${t('Список моделей')}</button></div>
    <div class="grid2">
      ${field('chat', t('Чат'), t('Пусто — модель по умолчанию'), text)}
      ${field('chatUltra', t('Чат · Ultra'), t('Старшая модель для режима Ultra'), text)}
      ${field('router', t('Маршрутизатор'), t('Быстрая и дешёвая модель'), text)}
      ${field('image', t('Изображения'), t('Модель с выходом «изображение»'), m => m.output.includes('image'))}
    </div>`;
}

async function renderSettings() {
  $$('#settingsNav [data-stab]').forEach(b => b.classList.toggle('active', b.dataset.stab === stab));
  const body = $('#settingsBody');
  const s = state.settings;
  let html = '';
  if (stab === 'api') {
    const pick = (field, label, hint, filter) => {
      const val = s.models[field];
      const opts = modelsCache ? modelsCache.filter(filter) : [];
      if (opts.length && !opts.some(o => o.id === val)) opts.unshift({ id: val });
      return `<div class="field"><label>${label}</label>
        ${opts.length ? `<select class="select" data-model="${field}">${opts.map(o => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.id)}</option>`).join('')}</select>`
          : `<input class="input mono" data-model="${field}" value="${esc(val)}" spellcheck="false">`}
        <div class="hint">${hint}</div></div>`;
    };
    const gen = m => m.methods.includes('generateContent');
    html = `<h2>Gemini API</h2>
      <p class="lead">${t('Ключ Google AI Studio — для чата, изображений и видео. Хранится только на этом компьютере в зашифрованном виде.')}</p>
      <div class="field"><label>${t('Ключ API')}</label>
        <div class="row"><input class="input mono" id="keyInput" type="password" placeholder="${s.hasKey ? t('Ключ сохранён — введите новый, чтобы заменить') : 'AIza…'}" spellcheck="false" autocomplete="off">
          <button class="btn" id="keyShow">${icon('eye')}</button><button class="btn primary" id="keySave">${t('Сохранить')}</button></div>
        <div class="hint">${t('aistudio.google.com → Get API key. После сохранения модели подберутся автоматически.')} ${s.hasKey ? ('<a href="#" id="keyRemove" style="color:var(--danger)">' + t('Удалить ключ') + '</a>') : ''}</div></div>
      <div class="row" style="margin:-4px 0 20px">
        <button class="btn" id="keyTest" ${s.hasKey ? '' : 'disabled'}>${icon('check')}${t('Проверить ключ')}</button>
        <button class="btn" id="loadModels" ${s.hasKey ? '' : 'disabled'}>${icon('refresh')}${t('Список моделей')}</button></div>
      <button class="net-link" data-goto-stab="net">${icon('globe')}<span>${t('Сеть')}: <b>${esc(netModeLabel(s.net))}</b></span>${icon('chevronRight')}</button>
      <div class="grid2">
        ${pick('chat', t('Чат'), t('Обычные ответы'), gen)}
        ${pick('chatUltra', t('Чат · Ultra'), t('Старшая модель для режима Ultra'), gen)}
        ${pick('router', t('Маршрутизатор'), t('Решает, кому отдать задачу'), gen)}
        ${pick('image', t('Изображения'), t('Nano Banana и др.'), m => gen(m) && /image/i.test(m.id))}
        ${pick('video', t('Видео'), t('Veo, быстрая модель'), m => /veo/i.test(m.id))}
        ${pick('videoUltra', t('Видео · Ultra'), t('Veo, максимальное качество'), m => /veo/i.test(m.id))}
      </div>
      <div class="field"><span class="field-label">${t('Формат видео')}</span>
        <div class="seg">${['16:9', '9:16'].map(a => `<button data-aspect="${a}" class="${s.videoAspect === a ? 'on' : ''}">${a}</button>`).join('')}</div></div>
      ${orSettingsHtml(s)}`;
  }
  if (stab === 'agents') {
    if (!state.agents.length) await detectAgents();
    const order = s.codeExecutors.filter(id => state.agents.some(a => a.id === id));
    html = `<h2>${t('Агенты для кода')}</h2>
      <p class="lead">${t('Synapse запускает официальные CLI на этом компьютере под вашим входом. Если первый не справился или упёрся в лимит — задача переходит к следующему.')}</p>
      <div class="field-label">${t('Порядок')}</div>
      <div>${order.map((id, i) => { const a = state.agents.find(x => x.id === id); const where = a.path || (a.installed ? a.bin : ''); return `<div class="agent-card ${a.installed ? 'ok' : 'missing'}">
        <div class="ag-top">
          <span class="num">${i + 1}</span>
          <div class="ag-main"><div class="ag-name">${provIcon(id)}${esc(a.label)}<span class="status-dot ${a.installed ? 'on' : ''}"></span>
            <span class="ag-ver">${a.installed ? esc(a.version) : (a.error ? esc(a.error) : t('не найден'))}</span>
            ${a.installed && a.loggedIn === true ? `<span class="auth-pill ok">${icon('check')}${t('вход выполнен')}</span>` : ''}
            ${a.installed && a.loggedIn === false ? `<span class="auth-pill bad">${t('нужен вход')}</span><button class="btn sm" data-cli-login="${id}">${t('Войти')}</button>` : ''}
          </div></div>
          <button class="icon-btn sm" data-move="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="${t('Выше')}">${icon('chevronUp')}</button>
          <button class="icon-btn sm" data-move="${id}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} title="${t('Ниже')}">${icon('chevronDown')}</button>
        </div>
        <div class="ag-field"><span class="ag-lbl">${t('Путь')}</span>
          <input class="input mono" data-cli-path="${id}" value="${esc(s.cliPaths[id] || '')}" placeholder="${esc(where || t('Авто — ищу в стандартных местах'))}" spellcheck="false">
          <button class="btn sm" data-cli-browse="${id}">${icon('folderOpen')}${t('Обзор…')}</button>
          ${s.cliPaths[id] ? `<button class="icon-btn sm" data-cli-reset="${id}" title="${t('Сбросить — искать автоматически')}">${icon('x')}</button>` : ''}
        </div>
        ${!s.cliPaths[id] && a.installed && where ? `<div class="ag-found">${icon('check')}${t('Найден автоматически')}: <span class="mono">${esc(where)}</span></div>` : ''}
        ${!a.installed ? `<div class="ag-found warn">${t('Укажите файл {f} или папку с ним — или установите CLI и нажмите «Проверить снова».', { f: a.bin && /[\\/]/.test(a.bin) ? a.bin.split(/[\\/]/).pop() : (a.bin || id) })}</div>` : ''}
        ${agentModels(a).length ? `<div class="ag-models">${agentModels(a).map(m => `<span class="chip" title="${esc(m)}">${esc(prettyModel(m))}</span>`).join('')}</div>` : ''}
        <div class="ag-field"><span class="ag-lbl">${t('Ещё')}</span>
          <input class="input mono" data-cli-models="${id}" value="${esc(s.cliModels?.[id] || '')}" placeholder="${t('свои модели через запятую — необязательно')}" spellcheck="false"></div>
      </div>`; }).join('')}</div>
      <div class="row" style="margin:6px 0 20px"><button class="btn" id="redetect">${icon('refresh')}${t('Проверить снова')}</button>
        <button class="btn" id="catalogRefresh" title="${t('Списки моделей берутся из файла models.json и обновляются с GitHub')}">${icon('download')}${t('Обновить списки моделей')}</button></div>
      <div class="toggle-row" id="smartToggle"><span class="switch ${s.smartRouting ? 'on' : ''}"></span>
        <span class="tr-text">${t('Умный выбор исполнителя')}<small>${t('Если по словам задача неясна, Synapse коротко спрашивает Gemini или OpenRouter')}</small></span></div>
      <div class="field" style="margin-top:16px"><label>${t('Папка для новых сессий')}</label>
        <div class="row"><input class="input mono" id="wsRoot" value="${esc(s.workspaceRoot)}" spellcheck="false"><button class="btn" id="wsPick">${icon('folder')}${t('Выбрать')}</button></div>
        <div class="hint">${t('Если окружение не выбрано, агент работает в отдельной подпапке здесь.')}</div></div>
      ${await arenaSettingsHtml()}`;
  }
  if (stab === 'net') {
    const n = s.net || {};
    const mode = n.mode || 'system';
    html = `<h2>${t('Сеть')}</h2>
      <p class="lead">${t('Как нейросети выходят в интернет: Gemini, OpenRouter, Claude Code, Codex, Antigravity и OpenCode.')}</p>
      <div class="seg net-seg" style="margin-bottom:16px">
        ${[['system', 'monitor', t('Как в Windows')], ['http', 'globe', t('HTTP-прокси')], ['ssh', 'key', t('SSH-сервер')]].map(([k, ic, lbl]) => `<button data-net-mode="${k}" class="${mode === k ? 'on' : ''}">${icon(ic)}${lbl}</button>`).join('')}
      </div>
      ${mode === 'system' ? `<div class="hint" style="margin:-4px 0 18px">${t('Без настроек: Gemini берёт системный прокси Windows, агенты ходят напрямую. Если Google не пускает из вашего региона и SSH-сервер настроен — Synapse сам переключится на него.')}</div>` : ''}
      ${mode === 'http' ? `
        <div class="field"><label>${t('Адрес HTTP-прокси')}</label>
          <input class="input mono" id="netHttp" value="${esc(n.http || '127.0.0.1:10801')}" placeholder="127.0.0.1:10801" spellcheck="false">
          <div class="hint">${t('Например, HTTP-порт v2rayN, Nekoray или Clash. Его получают все нейросети и их команды (npm, git, curl).')}</div></div>
        <div class="toggle-row" id="netStrict"><span class="switch ${n.strict !== false ? 'on' : ''}"></span>
          <span class="tr-text">${t('Строгий режим')}<small>${t('Если прокси не отвечает, запросы не уходят вовсе — никакого обхода напрямую.')}</small></span></div>` : ''}
      ${mode === 'ssh' ? tunnelCard(s, true) : ''}
      <div class="row" style="margin:14px 0 6px"><button class="btn" id="netTest">${icon('zap')}${t('Проверить связь')}</button></div>
      <div id="netResult" class="net-result"></div>
      <h3 class="sub-h">${t('Жёсткий запрет прямого выхода')}</h3>
      <div id="fwBox" class="fw-box"><div class="hint">${t('Загрузка…')}</div></div>`;
  }
  if (stab === 'memory') {
    const mem = await api.memory.get();
    const env = mem.env;
    const listChips = (arr, max = 40) => arr.slice(0, max).map(x => `<span class="chip">${esc(x)}</span>`).join('') + (arr.length > max ? `<span class="chip dim">+${arr.length - max}</span>` : '');
    html = `<h2>${t('Память и контекст')}</h2>
      <p class="lead">${t('Чтобы нейросети знали вас: что передать им о себе, и что подключено в Claude Code.')}</p>
      <div class="toggle-row" id="memToggle"><span class="switch ${s.memoryEnabled !== false ? 'on' : ''}"></span>
        <span class="tr-text">${t('Передавать «Обо мне» нейросетям')}<small>${t('Claude Code — в системный промпт, Gemini и OpenRouter — в системную инструкцию, Codex, Antigravity и OpenCode — в начало новой сессии.')}</small></span></div>
      <div class="field"><label>${t('Обо мне')}</label>
        <textarea class="input mem-text" id="memText" rows="9" spellcheck="true" placeholder="${t('Например: меня зовут…, пишу по-русски, коротко и по делу. Делаю игры на Roblox и сервер RAGE MP. В интерфейсах — SVG-иконки вместо эмодзи…')}">${esc(mem.text)}</textarea>
        <div class="hint"><span id="memCount">${mem.text.length}</span> / 12000 · ${t('Хранится только на этом компьютере. Можно скопировать сюда память из claude.ai (Настройки → Память).')}</div></div>
      <h3 class="sub-h">${t('Claude Code')}</h3>
      <div class="toggle-row" id="connToggle"><span class="switch ${s.allowConnectors !== false ? 'on' : ''}"></span>
        <span class="tr-text">${t('Скиллы и коннекторы без подтверждения')}<small>${t('В режиме «Правки файлов» Claude Code сможет пользоваться скиллами, коннекторами claude.ai и MCP. Иначе их вызовы блокируются — подтвердить некому.')}</small></span></div>
      <div class="env-card">
        <div class="env-row"><span>${icon('file')}${t('Личная память CLAUDE.md')}</span>
          <span class="mono dim">${mem.claudeMd.size == null ? t('нет файла') : `${mem.claudeMd.size} B`}</span>
          <button class="btn sm" id="openClaudeMd">${icon('external')}${mem.claudeMd.size == null ? t('Создать') : t('Открыть')}</button></div>
        ${env ? `
          <div class="env-row"><span>${icon('globe')}${t('Коннекторы и MCP')}</span><span class="dim">${env.mcp.filter(x => x.status === 'connected').length} / ${env.mcp.length} ${t('подключено')}</span></div>
          <div class="chips">${env.mcp.map(x => `<span class="chip ${x.status === 'connected' ? 'ok' : 'bad'}" title="${esc(x.status)}">${esc(x.name)}</span>`).join('') || `<span class="dim">${t('нет')}</span>`}</div>
          <div class="env-row"><span>${icon('sparkles')}${t('Скиллы')}</span><span class="dim">${env.skills.length}</span></div>
          <div class="chips">${listChips(env.skills) || `<span class="dim">${t('нет')}</span>`}</div>
          <div class="env-row"><span>${icon('paw')}${t('Плагины')}</span><span class="dim">${env.plugins.length}</span></div>
          <div class="chips">${listChips(env.plugins) || `<span class="dim">${t('нет')}</span>`}</div>
          <div class="hint">${t('По данным последнего запуска')} · Claude Code ${esc(env.version || '')} · ${new Date(env.at).toLocaleString(I18N.locale)}</div>`
        : `<div class="hint">${t('Список скиллов и коннекторов появится после первой задачи Claude Code.')}</div>`}
      </div>`;
  }
  if (stab === 'look') {
    html = `<h2>${t('Внешний вид')}</h2><p class="lead">${t('Тема, шрифт, цвета и поведение.')}</p>
      <div class="field"><label>${t('Ваше имя')}</label>
        <input class="input" id="nameInput" maxlength="40" value="${esc(s.displayName || '')}" placeholder="${esc(s.osUser || '')}" spellcheck="false">
        <div class="hint">${t('Показывается в панели слева и на странице статистики. Пусто — имя пользователя Windows.')}</div></div>
      <div class="field"><span class="field-label">${t('Язык')}</span><div class="seg">
        <button data-lang="ru" class="${I18N.lang === 'ru' ? 'on' : ''}">Русский</button>
        <button data-lang="en" class="${I18N.lang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="field"><span class="field-label">${t('Тема')}</span><div class="seg">
        <button data-theme="system" class="${s.theme === 'system' ? 'on' : ''}">${icon('monitor')}${t('Системная')}</button>
        <button data-theme="light" class="${s.theme === 'light' ? 'on' : ''}">${icon('sun')}${t('Светлая')}</button>
        <button data-theme="dark" class="${s.theme === 'dark' ? 'on' : ''}">${icon('moon')}${t('Тёмная')}</button></div></div>
      <div class="toggle-row" id="asciiToggle"><span class="switch ${s.asciiBg ? 'on' : ''}"></span>
        <span class="tr-text">${t('Живой ASCII-фон')}<small>${t('Анимированное поле символов на пустом экране; в переписке приглушается')}</small></span></div>
      ${lookHtml()}`;
  }
  if (stab === 'pets') {
    const p = s.pets || { enabled: true, list: [] };
    const desc = { dumpling: t('Пельмешек из теста, радуется готовым задачам'), bot: t('Маленький робот с мигающей антенной'), slime: t('Слизень с листиком, прыгает вместо ходьбы') };
    html = `<h2>${t('Питомцы')}</h2><p class="lead">${t('Бегают по полю ввода, засыпают, когда вы отошли, и радуются готовым задачам. Клик — подпрыгнут, можно перетаскивать мышью.')}</p>
      <div class="toggle-row" id="petsToggle"><span class="switch ${p.enabled ? 'on' : ''}"></span><span class="tr-text">${t('Показывать питомцев')}</span></div>
      <div class="field-label" style="margin-top:16px">${t('Кто живёт в приложении')}</div>
      ${Object.entries(Pets.PETS).map(([k, d]) => `<div class="toggle-row" data-pet="${k}">
        <img src="${pets.preview(k)}" alt=""><span class="tr-text">${esc(t(d.name))}<small>${desc[k] || ''}</small></span>
        <span class="switch ${p.list?.includes(k) ? 'on' : ''}"></span></div>`).join('')}`;
  }
  if (stab === 'log') {
    const rows = await api.usage();
    const by = (r) => rows.filter(x => x.route === r).length;
    html = `<h2>${t('Журнал')}</h2><p class="lead">${t('Последние задачи. Хранится локально.')}</p>
      <div class="stats"><div class="stat"><b>${by('chat')}</b><span>${t('чат')}</span></div><div class="stat"><b>${by('code')}</b><span>${t('код')}</span></div>
        <div class="stat"><b>${by('image') + by('video')}</b><span>${t('медиа')}</span></div><div class="stat"><b>${rows.filter(r => r.ok === false).length}</b><span>${t('ошибок')}</span></div></div>
      ${rows.length ? `<table class="log-table"><thead><tr><th>${t('Время')}</th><th>${t('Тип')}</th><th>${t('Исполнитель')}</th><th>${t('Длительность')}</th><th>${t('Итог')}</th></tr></thead><tbody>
        ${rows.slice(0, 120).map(r => `<tr><td>${new Date(r.t).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${ROUTE_NAME[r.route] || esc(r.route)}${r.ultra ? ' · Ultra' : ''}</td><td>${esc(r.model || r.executor || '—')}</td><td>${fmtSec(Math.round((r.ms || 0) / 1000))}</td>
          <td class="${r.ok === false ? 'bad' : ''}" title="${esc(r.error || '')}">${r.ok === false ? t('ошибка') : t('готово')}</td></tr>`).join('')}</tbody></table>` : ('<div class="note">' + t('Пока пусто.') + '</div>')}`;
  }
  if (stab === 'about') {
    html = `<h2>Synapse ${esc(s.version)}</h2><p class="lead">${t('Локальный ИИ-агент, который сам решает, кому отдать задачу.')}</p>
      <div class="note">${t('Код и файлы — Claude Code, Codex, Antigravity или OpenCode на этом компьютере, под вашим входом. Чат и изображения — Gemini API или OpenRouter по вашему ключу, видео — Gemini API.')}</div>
      <div class="note">${t('Рассчитано на личное использование на одном компьютере: подписки предназначены только для их владельца.')}</div>
      <div class="note">${t('Клавиши: Ctrl+N — новый, Ctrl+1/2 — чат/код, Ctrl+K — поиск, Ctrl+U — Ultra, Ctrl+. — прогресс, Ctrl+B — панель, Alt+←/→ — назад/вперёд, Ctrl+Enter — отправить сразу.')}</div>
      <div class="row"><button class="btn" id="openData">${icon('folderOpen')}${t('Папка с сессиями')}</button></div>`;
  }
  body.innerHTML = html;
  [...body.children].forEach((el, i) => el.style.setProperty('--i', i));
  bindSettings(body);
}

/* ================= Сеть ================= */
function netModeLabel(n) {
  const m = n?.mode || 'system';
  return m === 'http' ? `${t('HTTP-прокси')} ${n.http || ''}` : m === 'ssh' ? t('SSH-сервер') : t('Как в Windows');
}
function bindNet(body) {
  if (!body.querySelector('.net-seg')) return;
  const saveNet = async (patch) => { state.settings = await api.settings.set({ net: { ...(state.settings.net || {}), ...patch } }); };
  body.querySelectorAll('[data-net-mode]').forEach(b => b.addEventListener('click', async () => { await saveNet({ mode: b.dataset.netMode }); renderSettings(); }));
  body.querySelector('#netHttp')?.addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (!/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.\-]+):\d{1,5}$/.test(v.replace(/^https?:\/\//, '').replace(/\/$/, ''))) return toast(t('Укажите адрес в виде 127.0.0.1:10801'), true);
    await saveNet({ http: v.replace(/^https?:\/\//, '').replace(/\/$/, '') });
    toast(t('Сохранено'));
  });
  body.querySelector('#netStrict')?.addEventListener('click', async (e) => {
    const on = !(state.settings.net?.strict !== false);
    await saveNet({ strict: on });
    e.currentTarget.querySelector('.switch').classList.toggle('on', on);
  });
  body.querySelector('#netTest')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const box = $('#netResult');
    box.innerHTML = `<div class="hint">${t('Проверяю…')}</div>`;
    try {
      const r = await api.net.test();
      box.innerHTML = r.checks.map(c => `<div class="net-check ${c.ok ? 'ok' : 'bad'}">${icon(c.ok ? 'check' : 'x')}<span>${esc(c.name)}</span><span class="dim">${c.ok ? (c.ms != null ? `${c.ms} ${t('мс')}` : 'OK') : esc(c.error || t('не отвечает'))}</span></div>`).join('');
    } catch (err) { box.innerHTML = `<div class="tn-err">${esc(cleanErr(err))}</div>`; }
    b.disabled = false;
  });
  renderFirewall();
}
async function renderFirewall() {
  const box = $('#fwBox');
  if (!box) return;
  const st = await api.fw.status();
  if (!st.supported) { box.innerHTML = `<div class="hint">${t('Доступно в Windows: правила брандмауэра запрещают Synapse, Claude Code и Codex выходить в интернет мимо прокси.')}</div>`; return; }
  const on = st.rules.length > 0;
  box.innerHTML = `
    <div class="hint" style="margin-bottom:10px">${t('Правила брандмауэра Windows разрешат этим программам только локальные адреса — то есть только ваш прокси. Нужны права администратора.')}</div>
    ${st.targets.map(x => `<div class="net-check ${x.ok ? (on ? 'ok' : '') : 'dim'}">${icon(x.ok ? (on ? 'check' : 'circle') : 'info')}<span>${esc(x.label)}</span><span class="dim mono" title="${esc(x.exe || '')}">${esc(x.ok ? (x.exe || '').split(/[\\/]/).pop() : x.why)}</span></div>`).join('')}
    <div class="row" style="margin-top:12px">
      <button class="btn ${on ? '' : 'primary'}" id="fwApply">${icon('zap')}${on ? t('Обновить правила') : t('Запретить прямой выход')}</button>
      ${on ? `<button class="btn" id="fwRemove">${icon('x')}${t('Снять запрет')}</button>` : ''}
      <span class="tn-pill ${on ? 'ok' : ''}"><i></i>${on ? t('включён: правил {n}', { n: st.rules.length }) : t('выключен')}</span>
    </div>`;
  const act = async (fn, okMsg) => {
    toast(t('Windows попросит подтвердить права администратора'));
    const r = await fn();
    toast(r.ok ? okMsg : (r.error || t('Не удалось')), !r.ok);
    renderFirewall();
  };
  $('#fwApply')?.addEventListener('click', () => act(api.fw.apply, t('Готово: напрямую эти программы больше не выйдут')));
  $('#fwRemove')?.addEventListener('click', () => act(api.fw.remove, t('Запрет снят')));
}

/* ================= Память ================= */
function bindMemory(body) {
  const ta = body.querySelector('#memText');
  if (!ta) return;
  let timer = null;
  ta.addEventListener('input', () => {
    $('#memCount').textContent = ta.value.length;
    clearTimeout(timer);
    timer = setTimeout(async () => { await api.memory.set(ta.value); }, 500);
  });
  ta.addEventListener('blur', async () => { clearTimeout(timer); await api.memory.set(ta.value); });
  body.querySelector('#memToggle')?.addEventListener('click', async (e) => {
    const on = state.settings.memoryEnabled === false;
    state.settings = await api.settings.set({ memoryEnabled: on });
    e.currentTarget.querySelector('.switch').classList.toggle('on', on);
  });
  body.querySelector('#connToggle')?.addEventListener('click', async (e) => {
    const on = state.settings.allowConnectors === false;
    state.settings = await api.settings.set({ allowConnectors: on });
    e.currentTarget.querySelector('.switch').classList.toggle('on', on);
  });
  body.querySelector('#openClaudeMd')?.addEventListener('click', async () => { await api.memory.openClaudeMd(); setTimeout(renderSettings, 800); });
}

/* ================= Gemini через SSH-сервер ================= */
function tunnelPill(st) {
  const s = st?.state || 'off';
  const map = {
    off: ['', t('выключено')], connecting: ['busy', t('подключаюсь…')],
    up: ['ok', t('подключено')], error: ['bad', t('ошибка')],
  };
  const [cls, text] = map[s] || map.off;
  return `<span class="tn-pill ${cls}"><i></i>${text}</span>`;
}
function tunnelCard(s, embedded) {
  const tn = s.tunnel || {};
  const st = state.tunnel;
  return `<div class="tunnel-card ${tn.enabled || embedded ? 'on' : ''} ${embedded ? 'embedded' : ''}" id="tunnelCard">
    <div class="toggle-row" id="tunnelToggle" ${embedded ? 'hidden' : ''}><span class="switch ${tn.enabled ? 'on' : ''}"></span>
      <span class="tr-text">${t('Gemini через мой SSH-сервер')}<small>${t('Запросы к Google выходят в интернет с вашего сервера, а не с этого ПК. Ключ API на сервер не передаётся.')}</small></span>
      <span id="tunnelPill">${tunnelPill(st)}</span></div>
    <div class="tn-body"><div class="tn-inner">
      <div class="tn-grid">
        <div class="field"><label>${t('Сервер')}</label><input class="input mono" data-tn="host" value="${esc(tn.host || '')}" placeholder="203.0.113.10" spellcheck="false"></div>
        <div class="field sm"><label>${t('Порт')}</label><input class="input mono" data-tn="port" value="${esc(tn.port || 22)}" inputmode="numeric" spellcheck="false"></div>
        <div class="field"><label>${t('Пользователь')}</label><input class="input mono" data-tn="user" value="${esc(tn.user || 'root')}" spellcheck="false"></div>
      </div>
      <div class="field"><label>${t('Файл SSH-ключа')}</label>
        <div class="row"><input class="input mono" data-tn="key" value="${esc(tn.key || '')}" placeholder="${esc(st?.key || t('Авто — ищу в папке .ssh'))}" spellcheck="false">
          <button class="btn" id="tnPick">${icon('folderOpen')}${t('Обзор…')}</button>
          <button class="btn" id="tnTest">${icon('zap')}${t('Проверить')}</button></div>
        <div class="hint" id="tnMsg">${st?.state === 'error' && st.error ? `<span class="tn-err">${esc(st.error)}</span>` : st?.state === 'up' ? `${t('Туннель работает, запросы идут через')} ${esc(st.host || tn.host)}` : t('Публичный ключ должен быть в ~/.ssh/authorized_keys на сервере. Нужен ключ без пароля и «Клиент OpenSSH» в Windows (есть по умолчанию в 10/11).')}</div></div>
    </div></div></div>`;
}
function bindTunnel(body) {
  const card = body.querySelector('#tunnelCard');
  if (!card) return;
  const save = async (patch) => { state.settings = await api.settings.set({ tunnel: { ...state.settings.tunnel, ...patch } }); };
  card.querySelector('#tunnelToggle')?.addEventListener('click', async () => {
    const on = !state.settings.tunnel?.enabled;
    await save({ enabled: on });
    card.classList.toggle('on', on);
    card.querySelector('.switch').classList.toggle('on', on);
    if (on) toast(t('Подключаюсь к серверу…'));
  });
  card.querySelectorAll('[data-tn]').forEach(el => el.addEventListener('change', async () => {
    const k = el.dataset.tn;
    await save({ [k]: k === 'port' ? (parseInt(el.value, 10) || 22) : el.value.trim() });
  }));
  card.querySelector('#tnPick').addEventListener('click', async () => {
    const f = await api.tunnel.pickKey();
    if (f) { await save({ key: f }); card.querySelector('[data-tn="key"]').value = f; }
  });
  card.querySelector('#tnTest').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await api.tunnel.test();
      if (r.ok) toast(r.tunnel ? `${t('Работает: сервер')} ${r.sshMs} ${t('мс')}, Google ${r.googleMs} ${t('мс')}` : `${t('Google отвечает')} · ${r.googleMs} ${t('мс')}`);
      else toast(r.error || t('Не удалось'), true);
    } catch (err) { toast(cleanErr(err), true); }
    b.disabled = false;
  });
}
function onTunnelStatus(st) {
  state.tunnel = st;
  if (state.settings && !!state.settings.tunnel?.enabled !== !!st.enabled) {
    api.settings.get().then(s => { state.settings = s; if (st.enabled) toast(t('Gemini теперь идёт через ваш SSH-сервер')); if ($('#tunnelCard')) renderSettings(); });
  }
  const pill = $('#tunnelPill');
  if (pill) pill.innerHTML = tunnelPill(st);
  const msg = $('#tnMsg');
  if (msg && st.state === 'error' && st.error) msg.innerHTML = `<span class="tn-err">${esc(st.error)}</span>`;
  if (msg && st.state === 'up') msg.textContent = `${t('Туннель работает, запросы идут через')} ${st.host || ''}`;
  renderMeta();
}

function bindSettings(body) {
  const on = (sel, ev, fn) => body.querySelector(sel)?.addEventListener(ev, fn);
  const all = (sel, fn) => body.querySelectorAll(sel).forEach(fn);
  bindTunnel(body);
  bindNet(body);
  all('[data-ar-k]', b => b.addEventListener('click', async () => {
    const k = b.dataset.arK, v = b.dataset.arV;
    if (k === 'auto') {
      const auto = v === '1';
      const patch = { auto };
      // при переходе на «Вручную» начинаем с текущего автосостава
      if (!auto && !(state.settings.arena?.roster || []).length) {
        const R = await api.arena.roster().catch(() => null);
        patch.roster = (R?.participants || []).map(p => ({ agent: p.agent, model: p.model, on: true }));
      }
      return saveArena(patch);
    }
    saveArena({ [k]: Number(v) });
  }));
  all('[data-ar-model]', b => b.addEventListener('click', () => {
    const roster = [...(state.settings.arena?.roster || [])];
    const i = roster.findIndex(r => r.model === b.dataset.arModel);
    if (i >= 0) roster.splice(i, 1); else roster.push({ agent: b.dataset.arAgent, model: b.dataset.arModel, on: true });
    saveArena({ roster });
  }));
  on('#arDisp', 'change', (e) => {
    const [agent, model] = e.target.value ? e.target.value.split('|') : [];
    saveArena({ dispatcher: agent ? { agent, model } : null });
  });
  bindMemory(body);
  all('[data-goto-stab]', el => el.addEventListener('click', () => { stab = el.dataset.gotoStab; renderSettings(); }));
  on('#keyShow', 'click', () => { const i = $('#keyInput'); i.type = i.type === 'password' ? 'text' : 'password'; });
  // OpenRouter
  on('#orKeyShow', 'click', () => { const i = $('#orKeyInput'); i.type = i.type === 'password' ? 'text' : 'password'; });
  on('#orKeySave', 'click', async () => {
    const v = $('#orKeyInput').value.trim();
    if (!v) return toast(t('Вставьте ключ'), true);
    await api.orKey.set(v);
    state.settings = await api.settings.get();
    updateKeyBanner(); detectAgents(); toast(t('Ключ сохранён')); renderSettings();
  });
  on('#orKeyRemove', 'click', async (e) => { e.preventDefault(); await api.orKey.set(''); state.settings = await api.settings.get(); updateKeyBanner(); detectAgents(); renderSettings(); });
  on('#orKeyTest', 'click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await api.orKey.test();
      const spent = r.usage != null ? ` · ${t('потрачено')} $${Number(r.usage).toFixed(2)}${r.limit != null ? ` / $${Number(r.limit).toFixed(2)}` : ''}` : '';
      toast(`${t('Ключ работает')}${r.free ? ` · ${t('бесплатный тариф')}` : ''}${spent}`);
    } catch (err) { toast(cleanErr(err), true); }
    b.disabled = false;
  });
  on('#orLoadModels', 'click', async (e) => { const b = e.currentTarget; b.disabled = true; try { orModelsCache = await api.orModels(); toast(`${t('Загружено моделей:')} ${orModelsCache.length}`); renderSettings(); } catch (err) { toast(cleanErr(err), true); b.disabled = false; } });
  all('[data-or-model]', el => el.addEventListener('change', async () => {
    const v = el.value.trim();
    if (v && !/^~?[\w.\-]+\/[\w.\-]+(:[\w-]+)?$/.test(v)) return toast(t('Некорректное имя модели'), true);
    await saveSettings({ openrouter: { ...(state.settings.openrouter || {}), [el.dataset.orModel]: v } });
    toast(t('Сохранено'));
  }));
  on('#catalogRefresh', 'click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await api.catalog.refresh(); state.settings = await api.settings.get(); toast(t('Списки моделей обновлены')); renderSettings(); } catch (err) { toast(cleanErr(err), true); b.disabled = false; }
  });
  on('#keySave', 'click', async () => {
    const v = $('#keyInput').value.trim();
    if (!v) return toast(t('Вставьте ключ'), true);
    await api.key.set(v);
    state.settings = await api.settings.get();
    updateKeyBanner(); detectAgents(); toast(t('Ключ сохранён')); renderSettings();
  });
  on('#keyRemove', 'click', async (e) => { e.preventDefault(); await api.key.set(''); state.settings = await api.settings.get(); updateKeyBanner(); detectAgents(); renderSettings(); });
  on('#keyTest', 'click', async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await api.key.test(); toast(`${t('Ключ работает · моделей:')} ${r.count}`); } catch (err) { toast(cleanErr(err), true); } b.disabled = false; });
  on('#loadModels', 'click', async (e) => { const b = e.currentTarget; b.disabled = true; try { modelsCache = await api.models.list(); state.settings = await api.settings.get(); toast(`${t('Загружено моделей:')} ${modelsCache.length}`); renderSettings(); } catch (err) { toast(cleanErr(err), true); b.disabled = false; } });
  all('[data-model]', el => el.addEventListener('change', async () => { const v = el.value.trim(); if (!/^[\w.\-]+$/.test(v)) return toast(t('Некорректное имя модели'), true); await saveSettings({ models: { [el.dataset.model]: v } }); toast(t('Сохранено')); }));
  all('[data-aspect]', b => b.addEventListener('click', async () => { await saveSettings({ videoAspect: b.dataset.aspect }); renderSettings(); }));
  all('[data-move]', b => b.addEventListener('click', async () => {
    const o = [...state.settings.codeExecutors]; const i = o.indexOf(b.dataset.move), j = i + Number(b.dataset.dir);
    if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; await saveSettings({ codeExecutors: o }); renderSettings(); renderMeta();
  }));
  const setCliPath = async (id, v) => {
    v = (v || '').trim().replace(/^"(.*)"$/, '$1');
    if (v && !/^[\p{L}\p{N}_.\-:\/\\ ()~+@]+$/u.test(v)) return toast(t('Недопустимые символы в пути'), true);
    await saveSettings({ cliPaths: { ...state.settings.cliPaths, [id]: v } });
    const r = (await detectAgents(true)).find(x => x.id === id);
    renderSettings();
    if (v) toast(r?.installed ? `${r.label}: ${r.version}` : t('По этому пути CLI не отвечает'), !r?.installed);
  };
  all('[data-cli-path]', el => el.addEventListener('change', () => setCliPath(el.dataset.cliPath, el.value)));
  all('[data-cli-browse]', el => el.addEventListener('click', async () => { const f = await api.pickCli(el.dataset.cliBrowse); if (f) setCliPath(el.dataset.cliBrowse, f); }));
  all('[data-cli-login]', el => el.addEventListener('click', async () => { await api.cli.login(el.dataset.cliLogin); toast(t('Войдите в открывшемся терминале, затем нажмите «Проверить снова»')); }));
  all('[data-cli-reset]', el => el.addEventListener('click', () => setCliPath(el.dataset.cliReset, '')));
  all('[data-cli-models]', el => el.addEventListener('change', async () => {
    const v = listModels(el.value).join(', ');
    el.value = v;
    await saveSettings({ cliModels: { ...state.settings.cliModels, [el.dataset.cliModels]: v } });
    toast(t('Сохранено'));
  }));
  on('#redetect', 'click', async () => { await detectAgents(true); renderSettings(); toast(t('Агенты проверены')); });
  on('#smartToggle', 'click', async () => { await saveSettings({ smartRouting: !state.settings.smartRouting }); renderSettings(); });
  on('#wsPick', 'click', async () => { const d = await api.pickFolder(); if (d) { await saveSettings({ workspaceRoot: d }); renderSettings(); } });
  on('#wsRoot', 'change', async (e) => { await saveSettings({ workspaceRoot: e.target.value.trim() }); toast(t('Сохранено')); });
  all('[data-look-k]', b => b.addEventListener('click', () => setLook({ [b.dataset.lookK]: b.dataset.lookV })));
  all('[data-look-toggle]', b => b.addEventListener('click', () => setLook({ [b.dataset.lookToggle]: look()[b.dataset.lookToggle] === false })));
  all('[data-theme]', b => b.addEventListener('click', async () => { await saveSettings({ theme: b.dataset.theme }); applyTheme(b.dataset.theme); renderSettings(); }));
  on('#nameInput', 'change', (e) => saveName(e.target.value || state.settings.osUser));
  all('[data-lang]', b => b.addEventListener('click', async () => {
    if (b.dataset.lang === I18N.lang) return;
    await saveSettings({ lang: b.dataset.lang });
    applyLang();
  }));
  on('#asciiToggle', 'click', async () => { await saveSettings({ asciiBg: !state.settings.asciiBg }); render(); renderSettings(); });
  on('#petsToggle', 'click', async () => { const p = state.settings.pets; await saveSettings({ pets: { ...p, enabled: !p.enabled } }); applyPets(); renderSettings(); });
  all('[data-pet]', el => el.addEventListener('click', async () => {
    const p = state.settings.pets; const k = el.dataset.pet;
    const list = p.list.includes(k) ? p.list.filter(x => x !== k) : [...p.list, k];
    await saveSettings({ pets: { ...p, list, enabled: true } }); applyPets(); renderSettings();
  }));
  on('#openData', 'click', () => api.open(state.settings.workspaceRoot));
}

/* ================= Тосты ================= */
function toast(text, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.innerHTML = `${icon(bad ? 'alert' : 'check')}<span>${esc(text)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, bad ? 5000 : 2600);
}
function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${src}" alt="">`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

// смена языка на лету: статичная разметка + всё динамическое
function applyLang() {
  I18N.set(state.settings.lang);
  setTab(state.tab, { silent: true });
  render();
  renderSettings();
  updateKeyBanner();
}

async function toggleProgress() {
  const on = !state.settings.progressPanel;
  $('#main').classList.toggle('show-progress', on);
  await saveSettings({ progressPanel: on });
  renderProgress();
}

/* ================= События ================= */
function bindUI() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.classList.contains('prov-ic')) {
      const span = document.createElement('span');
      span.className = img.className + ' mono';
      span.textContent = img.dataset.mono || '?';
      img.replaceWith(span);
    }
  }, true);
  const input = $('#input');
  input.addEventListener('input', syncInput);
  input.addEventListener('scroll', () => { $('#hl').scrollTop = input.scrollTop; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (look().send === 'ctrl') { if (ctrl) { e.preventDefault(); submit({}); } return; }
      e.preventDefault(); submit({ now: ctrl });
    }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $('#sendBtn').addEventListener('click', () => {
    if (isRunning(currentChat()?.id) && !input.value.trim() && !state.attachments.length) stop(); else submit();
  });
  $('#plusBtn').addEventListener('click', plusMenu);
  $('#envBtn').addEventListener('click', envMenu);
  $('#modeBtn').addEventListener('click', modeMenu);
  $('#agentBtn').addEventListener('click', agentMenu);
  $('#ultraBtn').addEventListener('click', toggleUltra);
  $('#effortBtn').addEventListener('click', effortMenu);
  $('#teamBtn').addEventListener('click', async () => {
    const on = !state.settings.team;
    state.settings = await api.settings.set({ team: on });
    renderMeta();
    toast(on ? t('Команда: Claude Code будет раздавать части задачи субагентам') : t('Команда выключена'));
    if (on) { const b = $('#teamBtn').getBoundingClientRect(); sparks(b.left + b.width / 2, b.top + b.height / 2); }
  });
  $('#arenaBtn').addEventListener('click', async () => {
    const on = !arenaOn();
    state.settings = await api.settings.set({ arena: { ...(state.settings.arena || {}), on } });
    renderMeta();
    if (on) {
      const r = await api.arena.roster().catch(() => null);
      const who = r?.participants?.map(p => prettyModel(p.model) || p.label).join(', ');
      toast(who ? t('Арена: {who}', { who }) : t('Арена включена'));
      const b = $('#arenaBtn').getBoundingClientRect(); sparks(b.left + b.width / 2, b.top + b.height / 2);
      pets.react('ultra');
    } else toast(t('Арена выключена'));
  });
  $('#ringBtn').addEventListener('click', toggleCtxPop);
  $('#progressBtn').addEventListener('click', toggleProgress);
  $('#workBtn').addEventListener('click', () => Workbench.toggle());
  $('#progressClose').addEventListener('click', toggleProgress);
  $('#fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  $('#attachments').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-att]'); if (b) { state.attachments.splice(Number(b.dataset.rmAtt), 1); renderAttachments(); updateSendBtn(); } });
  $('#keyBanner').addEventListener('click', () => openSettings('api'));

  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== state.tab) setTab(b.dataset.tab); });
  $('#navNew').addEventListener('click', () => newChat(state.tab));
  $('#navProjects').addEventListener('click', () => go({ type: 'projects' }));
  $('#navMedia').addEventListener('click', () => go({ type: 'media' }));
  $('#navStats').addEventListener('click', () => go({ type: 'stats' }));
  // Поиск по настройкам: по названиям разделов и словам внутри них
  $('#settingsSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let first = null;
    $$('#settingsNav [data-stab]').forEach(b => {
      const hit = !q || (b.textContent + ' ' + (SETTINGS_WORDS[b.dataset.stab] || '')).toLowerCase().includes(q);
      b.classList.toggle('filtered', !hit);
      if (hit && !first) first = b;
    });
    $$('#settingsNav .nav-group').forEach(g => g.classList.toggle('hidden', !!q));
    $('#settingsEmpty').classList.toggle('hidden', !!first);
    if (first && $(`#settingsNav [data-stab="${stab}"]`).classList.contains('filtered')) { stab = first.dataset.stab; renderSettings(); }
  });
  $('#navExt').addEventListener('click', () => go({ type: 'extensions' }));
  $('#backBtn').addEventListener('click', () => histStep(-1));
  $('#fwdBtn').addEventListener('click', () => histStep(1));
  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderSidebar(); });
  const toggleSide = () => { const c = !$('#app').classList.contains('side-collapsed'); $('#app').classList.toggle('side-collapsed', c); saveSettings({ sidebarCollapsed: c }); };
  $('#collapseBtn').addEventListener('click', toggleSide);
  $('#expandBtn').addEventListener('click', toggleSide);
  $('#settingsBtn').addEventListener('click', () => openSettings());
  $('#accountBtn').addEventListener('click', (e) => { e.stopPropagation(); accountMenu(); });
  $('#petsBtn').addEventListener('click', async () => { const p = state.settings.pets; await saveSettings({ pets: { ...p, enabled: !p.enabled } }); applyPets(); toast(p.enabled ? t('Питомцы ушли спать') : t('Питомцы вернулись')); });
  $('#settingsNav').addEventListener('click', (e) => { const b = e.target.closest('[data-stab]'); if (b) { stab = b.dataset.stab; renderSettings(); } });
  $$('#settingsModal [data-close]').forEach(el => el.addEventListener('click', closeSettings));

  // делегирование кликов
  document.addEventListener('click', async (e) => {
    const tg = e.target;
    if (tg.closest('#menu, .modal')) return;
    const more = tg.closest('[data-chat-more]');
    if (more) { e.stopPropagation(); return chatMenu(more.dataset.chatMore, more); }
    if (tg.closest('#crumbTitle') && !tg.closest('input')) return chatMenu(state.view.id, $('#crumbTitle'));
    const chatEl = tg.closest('[data-chat]');
    if (chatEl && !tg.closest('input')) return openChat(chatEl.dataset.chat);
    const proj = tg.closest('[data-project], [data-go-project]');
    if (proj) return go({ type: 'project', id: proj.dataset.project || proj.dataset.goProject });
    const g = tg.closest('[data-go]'); if (g) return go({ type: g.dataset.go });
    const od = tg.closest('[data-open-dir]'); if (od) return api.open(od.dataset.openDir);
    const rv = tg.closest('[data-reveal]'); if (rv) return api.reveal(rv.dataset.reveal);
    const sv = tg.closest('[data-save]'); if (sv) { if (await api.saveAs(sv.dataset.save)) toast(t('Сохранено')); return; }
    const z = tg.closest('[data-zoom]'); if (z) return lightbox(z.dataset.zoom);
    const os = tg.closest('[data-open-settings]'); if (os) return openSettings(os.dataset.openSettings);
    const ar = tg.closest('[data-allow-run]');
    if (ar) {
      const mm = currentChat()?.messages.find(x => x.id === tg.closest('.msg')?.dataset.id);
      await setAccess('full');
      if (mm && !isRunning(currentChat().id)) retry(mm.id);
      return;
    }
    const sn = tg.closest('[data-send-now]'); if (sn) return sendNow(sn.dataset.sendNow);
    const uq = tg.closest('[data-unqueue]');
    if (uq) { const q = state.queue.get(currentChat().id) || []; const i = q.findIndex(x => x.id === uq.dataset.unqueue); if (i >= 0) q.splice(i, 1); return renderChat(); }
    const msgEl = tg.closest('.msg');
    const chat = currentChat();
    const m = msgEl && chat?.messages.find(x => x.id === msgEl.dataset.id);
    if (tg.closest('[data-toggle-act]') && m) { m.open = !m.open; tg.closest('.activity').classList.toggle('open', m.open); return; }
    if (tg.closest('#codexLimRefresh')) { const b = tg.closest('#codexLimRefresh'); b.disabled = true; await refreshCodexLimits(true); return; }
    if (tg.closest('[data-toggle-think]') && m) { const box = tg.closest('.think'); m.thinkOpen = !box.classList.contains('open'); box.classList.toggle('open', m.thinkOpen); return; }
    const pv = tg.closest('[data-preview]'); if (pv && chat) { if (!chat.cwd && m?.cwd) chat.cwd = m.cwd; await Workbench.sync(chat); if (!(await Workbench.openAbs(pv.dataset.preview))) api.open(pv.dataset.preview); return; }
    if (tg.closest('[data-copy]') && m) { await navigator.clipboard.writeText(m.text); return toast(t('Скопировано')); }
    const cc = tg.closest('[data-copy-code]');
    if (cc) { await navigator.clipboard.writeText(cc.closest('.codeblock').querySelector('code').textContent); cc.innerHTML = `${icon('check')}<span>${t('Скопировано')}</span>`; setTimeout(() => { cc.innerHTML = `${icon('copy')}<span>${t('Копировать')}</span>`; }, 1500); return; }
    if (m?.arena && await arenaAction(tg, m, chat)) return;
    if (tg.closest('[data-retry]') && m && !isRunning(chat.id)) return retry(m.id);
  });
  document.addEventListener('dblclick', (e) => { const r = e.target.closest('.row-item[data-chat]'); if (r) renameChat(r.dataset.chat); });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu, #ctxPop') && !e.target.closest('.meta-btn, #plusBtn, [data-chat-more], #crumbTitle, #projMore, #ringBtn')) closePopovers(); });
  window.addEventListener('resize', closePopovers);
  window.addEventListener('blur', closePopovers);
  window.addEventListener('mouseup', (e) => { if (e.button === 3) histStep(-1); if (e.button === 4) histStep(1); });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    if (e.key === 'Escape') {
      if ($('.lightbox')) return $('.lightbox').remove();
      if ($('#menu').classList.contains('open')) return closePopovers();
      if ($('#settingsModal').classList.contains('open')) return closeSettings();
      if (isRunning(currentChat()?.id)) return stop();
    }
    if (mod && k === 'n') { e.preventDefault(); newChat(state.tab); }
    if (mod && k === 'k') { e.preventDefault(); $('#searchInput').focus(); }
    if (mod && k === 'b') { e.preventDefault(); $('#collapseBtn').click(); }
    if (mod && k === 'u') { e.preventDefault(); toggleUltra(); }
    if (mod && (k === 'j' || e.code === 'Backquote') && currentChat()?.kind === 'code' && state.view.type === 'chat') { e.preventDefault(); Workbench.toggle(true); }
    if (mod && k === 'e') { e.preventDefault(); cycleEffort(); }
    if (mod && e.key === '.') { e.preventDefault(); toggleProgress(); }
    if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
    if (mod && e.key === '1') { e.preventDefault(); if (state.tab !== 'chat') setTab('chat'); }
    if (mod && e.key === '2') { e.preventDefault(); if (state.tab !== 'code') setTab('code'); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); histStep(-1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); histStep(1); }
  });

  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropOverlay').classList.add('on'); });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropOverlay').classList.remove('on'); });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('#dropOverlay').classList.remove('on'); const f = [...(e.dataTransfer?.files || [])]; if (f.length) addFiles(f); });
}

init().catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:8px;left:8px;color:#ef6b5e;z-index:999">${esc(e.stack || e)}</pre>`); });
