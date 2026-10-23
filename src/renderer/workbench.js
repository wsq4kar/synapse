// Рабочее место вкладки «Код»: дерево файлов + предпросмотр + терминал.
(function () {
  let H; // помощники из app.js
  const $ = (s, r = document) => r.querySelector(s);
  const S = {
    open: false, visible: false, chat: null,
    root: null,            // { id, path }
    trees: new Map(),      // rootId -> { expanded:Set, cache:Map(rel -> entries), selected }
    preview: null,         // { rootId, rel, data, mode: 'view'|'code' }
    terms: new Map(),      // rootId -> { out: [], cwd, running, history:[], hi, shell, started }
  };
  const t = (s, v) => H.t(s, v);
  const ic = (n) => H.icon(n);
  const esc = (s) => H.esc(s);

  // ---------- разметка ----------
  function mount() {
    const el = document.createElement('aside');
    el.className = 'workbench';
    el.id = 'workbench';
    el.innerHTML = `
      <div class="wb-resize" id="wbResize" title="${t('Потяните, чтобы изменить ширину')}"></div>
      <div class="wb-inner">
        <section class="wb-files">
          <div class="wb-head">
            <span class="wb-title">${ic('folder')}<span>${t('Файлы')}</span></span>
            <span class="wb-root mono" id="wbRoot"></span>
            <div class="wb-actions">
              <button class="icon-btn xs" id="wbTreeToggle" title="${t('Скрыть список файлов')}">${ic('panel')}</button>
              <button class="icon-btn xs" id="wbRefresh" title="${t('Обновить')}">${ic('refresh')}</button>
              <button class="icon-btn xs" id="wbReveal" title="${t('Открыть в проводнике')}">${ic('folderOpen')}</button>
              <button class="icon-btn xs" id="wbClose" title="${t('Скрыть (Ctrl+J)')}">${ic('x')}</button>
            </div>
          </div>
          <div class="wb-split">
            <div class="wb-tree" id="wbTree" tabindex="0"></div>
            <div class="wb-preview" id="wbPreview"></div>
          </div>
        </section>
        <div class="wb-hsplit" id="wbHSplit"></div>
        <section class="wb-term" id="wbTerm">
          <div class="wb-head">
            <span class="wb-title">${ic('terminal')}<span>${t('Терминал')}</span></span>
            <span class="wb-root" id="termShell"></span>
            <div class="wb-actions">
              <button class="icon-btn xs" id="termStop" title="${t('Остановить (Ctrl+C)')}">${ic('stop')}</button>
              <button class="icon-btn xs" id="termClear" title="${t('Очистить (Ctrl+L)')}">${ic('eraser')}</button>
              <button class="icon-btn xs" id="termRestart" title="${t('Перезапустить')}">${ic('refresh')}</button>
            </div>
          </div>
          <div class="term-out mono" id="termOut"></div>
          <label class="term-in mono">
            <span class="term-prompt" id="termPrompt"></span>
            <input id="termInput" spellcheck="false" autocomplete="off" placeholder="${t('Введите команду')}">
            <span class="term-busy" id="termBusy"><i></i><i></i><i></i></span>
          </label>
        </section>
      </div>`;
    $('#app').appendChild(el);
    bind();
  }

  // ---------- размеры ----------
  // Список файлов можно спрятать, а превью — развернуть на всю панель (без файлов и терминала)
  function setTreeHidden(v, save = true) {
    const wb = document.getElementById('workbench');
    if (!wb) return;
    wb.classList.toggle('tree-hidden', v);
    const b = document.getElementById('wbTreeToggle');
    if (b) { b.classList.toggle('on', v); b.title = v ? t('Показать список файлов') : t('Скрыть список файлов'); }
    if (save) H.saveSettings({ workbench: { ...(H.settings().workbench || {}), treeHidden: v } });
  }
  function setPreviewMax(v) {
    const wb = document.getElementById('workbench');
    if (!wb) return;
    wb.classList.toggle('pv-max', v);
    renderPreview();
  }
  function applySize() {
    const w = H.settings().workbench || {};
    setTreeHidden(!!w.treeHidden, false);
    document.documentElement.style.setProperty('--wb-w', `${Math.round(w.width || 640)}px`);
    document.documentElement.style.setProperty('--wb-split', String(w.split || 0.56));
  }
  function drag(handle, onMove, onEnd) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('wb-dragging');
      const move = (ev) => onMove(ev);
      const up = () => { handle.removeEventListener('pointermove', move); document.body.classList.remove('wb-dragging'); onEnd(); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  }

  // ---------- видимость ----------
  async function sync(chat) {
    S.chat = chat;
    S.open = !!H.settings().workbench?.open;
    // Файлы и терминал есть у любого чата с папкой: во вкладке «Код» всегда, в обычном — когда агент уже что-то сделал
    const avail = !!chat && (chat.kind === 'code' || !!chat.cwd);
    S.visible = S.open && avail;
    $('#app').classList.toggle('wb-open', S.visible);
    const btn = $('#workBtn');
    if (btn) { btn.classList.toggle('hidden', !avail); btn.classList.toggle('on', S.visible); }
    if (!S.visible) return;
    const key = `${chat.id}|${chat.cwd || ''}`;
    if (S.key === key && S.root) return;
    S.key = key;
    const r = await H.api.ws.open(chat.id, chat.cwd || null);
    if (S.root?.id !== r.id) {
      S.root = r;
      if (!S.trees.has(r.id)) S.trees.set(r.id, { expanded: new Set(), cache: new Map(), selected: null });
      await loadDir('');
      renderTree();
      const tr = S.trees.get(r.id);
      if (tr.selected) openFile(tr.selected, true); else renderPreview();
      ensureTerm();
    }
    $('#wbRoot').textContent = shortPath(r.path);
    $('#wbRoot').title = r.path;
  }
  async function toggle(focusTerm) {
    const open = !S.visible;
    await H.saveSettings({ workbench: { ...(H.settings().workbench || {}), open } });
    await sync(S.chat);
    if (open && focusTerm) setTimeout(() => $('#termInput')?.focus(), 250);
  }

  function shortPath(p) {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
  }

  // ---------- дерево ----------
  const tree = () => S.trees.get(S.root.id);
  async function loadDir(rel) { tree().cache.set(rel, await H.api.ws.list(S.root.id, rel)); }

  const EXT_IC = { html: 'globe', htm: 'globe', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', mp4: 'video', webm: 'video', md: 'file' };
  function fileIcon(e) {
    if (e.dir) return ic(tree().expanded.has(e.rel) ? 'folderOpen' : 'folder');
    const ext = e.name.split('.').pop().toLowerCase();
    return ic(EXT_IC[ext] || (/^(js|ts|tsx|jsx|py|lua|luau|json|css|cs|go|rs|cpp|c|java|php|sh|ps1)$/.test(ext) ? 'fileCode' : 'file'));
  }
  function renderTree() {
    const tr = tree();
    const rows = [];
    let i = 0;
    const walk = (rel, depth) => {
      for (const e of tr.cache.get(rel) || []) {
        rows.push(`<button class="tr-row ${e.dir ? 'dir' : ''} ${tr.selected === e.rel ? 'sel' : ''} ${e.heavy ? 'heavy' : ''}" data-rel="${esc(e.rel)}" data-dir="${e.dir ? 1 : 0}" style="--d:${depth};--i:${Math.min(i++, 30)}" title="${esc(e.rel)}">
          ${e.dir ? `<span class="tr-chev ${tr.expanded.has(e.rel) ? 'open' : ''}">${ic('chevronRight')}</span>` : '<span class="tr-chev"></span>'}
          ${fileIcon(e)}<span class="tr-name">${esc(e.name)}</span></button>`);
        if (e.dir && tr.expanded.has(e.rel)) walk(e.rel, depth + 1);
      }
    };
    walk('', 0);
    $('#wbTree').innerHTML = rows.length ? rows.join('') : `<div class="wb-empty">${ic('folder')}<span>${t('Папка пуста — агент положит файлы сюда')}</span></div>`;
  }
  async function toggleDir(rel) {
    const tr = tree();
    if (tr.expanded.has(rel)) tr.expanded.delete(rel);
    else { tr.expanded.add(rel); await loadDir(rel); }
    renderTree();
  }
  async function refresh() {
    if (!S.visible || !S.root) return;
    const tr = tree();
    await loadDir('');
    for (const rel of [...tr.expanded]) await loadDir(rel).catch(() => tr.expanded.delete(rel));
    renderTree();
    if (S.preview?.rootId === S.root.id) openFile(S.preview.rel, true);
  }

  // ---------- предпросмотр ----------
  async function openFile(rel, keepMode) {
    const tr = tree();
    tr.selected = rel;
    const data = await H.api.ws.read(S.root.id, rel);
    if (data.kind === 'dir' || data.kind === 'error') { tr.selected = null; S.preview = null; renderTree(); renderPreview(); return; }
    const mode = keepMode && S.preview?.rel === rel ? S.preview.mode : (['html', 'markdown', 'svg'].includes(data.kind) ? 'view' : 'code');
    S.preview = { rootId: S.root.id, rel, data, mode, v: Date.now() };
    renderTree();
    renderPreview();
  }
  function fmtSize(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
  function codeHtml(text, lang) {
    let html;
    try { html = lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : (text.length < 60000 ? hljs.highlightAuto(text).value : esc(text)); }
    catch { html = esc(text); }
    const lines = text.split('\n').length;
    return `<div class="pv-code"><div class="pv-gutter">${Array.from({ length: Math.min(lines, 20000) }, (_, i) => i + 1).join('\n')}</div><pre><code class="hljs">${html}</code></pre></div>`;
  }
  function renderPreview() {
    const el = $('#wbPreview');
    const p = S.preview;
    if (!p || p.rootId !== S.root?.id) {
      el.innerHTML = `<div class="wb-empty">${ic('eye')}<span>${t('Выберите файл, чтобы посмотреть его')}</span></div>`;
      return;
    }
    const d = p.data;
    const canToggle = ['html', 'markdown', 'svg'].includes(d.kind);
    const head = `<div class="pv-head">
      <span class="pv-name" title="${esc(d.path)}">${esc(d.name)}</span><span class="pv-size">${fmtSize(d.size)}${d.truncated ? ` · ${t('показано начало')}` : ''}</span>
      ${canToggle ? `<div class="seg xs"><button data-pv-mode="view" class="${p.mode === 'view' ? 'on' : ''}">${t('Просмотр')}</button><button data-pv-mode="code" class="${p.mode === 'code' ? 'on' : ''}">${t('Код')}</button></div>` : ''}
      ${d.kind === 'html' ? `<button class="icon-btn xs" data-pv-reload title="${t('Перезагрузить')}">${ic('refresh')}</button>` : ''}
      <button class="icon-btn xs" data-pv-ext title="${t('Открыть в программе по умолчанию')}">${ic('external')}</button>
      <button class="icon-btn xs" data-pv-max title="${document.getElementById('workbench')?.classList.contains('pv-max') ? t('Свернуть (Esc)') : t('Развернуть превью')}">${ic(document.getElementById('workbench')?.classList.contains('pv-max') ? 'minimize' : 'maximize')}</button>
    </div>`;
    let body = '';
    const src = `${d.url}?v=${p.v}`;
    if (d.kind === 'image') body = `<div class="pv-media checker"><img src="${src}" alt=""></div>`;
    else if (d.kind === 'video') body = `<div class="pv-media"><video src="${src}" controls playsinline></video></div>`;
    else if (d.kind === 'audio') body = `<div class="pv-media"><audio src="${src}" controls></audio></div>`;
    else if (d.kind === 'pdf') body = `<iframe class="pv-frame" src="${src}"></iframe>`;
    else if (d.kind === 'binary') body = `<div class="wb-empty">${ic('file')}<span>${t('Двоичный файл — откройте его в программе')}</span></div>`;
    else if (d.kind === 'html' && p.mode === 'view') body = `<iframe class="pv-frame white" src="${src}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"></iframe>`;
    else if (d.kind === 'svg' && p.mode === 'view') body = `<div class="pv-media checker"><img src="${src}" alt=""></div>`;
    else if (d.kind === 'markdown' && p.mode === 'view') body = `<div class="pv-md md">${DOMPurify.sanitize(marked.parse(d.text))}</div>`;
    else body = codeHtml(d.text, d.lang);
    el.innerHTML = head + `<div class="pv-body">${body}</div>`;
  }

  // ---------- терминал ----------
  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r(?!\n)/g;
  function term() { return S.root ? S.terms.get(S.root.id) : null; }
  async function ensureTerm(force) {
    const id = S.root.id;
    let tm = S.terms.get(id);
    if (tm && tm.started && !force) { renderTerm(); return; }
    if (!tm) { tm = { out: [], cwd: S.root.path, running: true, history: loadHistory(), hi: -1, shell: '' }; S.terms.set(id, tm); }
    tm.running = true;
    renderTerm();
    try {
      const r = await H.api.term.start(id, id);
      tm.shell = r.shell; tm.started = true;
    } catch (e) {
      push(id, 'err', `${e.message}\n`);
      tm.running = false;
    }
    renderTerm();
  }
  function loadHistory() { try { return JSON.parse(localStorage.getItem('synapse.termHistory') || '[]'); } catch { return []; } }
  function saveHistory(h) { try { localStorage.setItem('synapse.termHistory', JSON.stringify(h.slice(-200))); } catch { /* */ } }

  function push(rootId, stream, text) {
    const tm = S.terms.get(rootId);
    if (!tm) return;
    const clean = String(text).replace(ANSI, '');
    if (!clean) return;
    const last = tm.out[tm.out.length - 1];
    if (last && last.s === stream) last.t += clean; else tm.out.push({ s: stream, t: clean });
    let total = tm.out.reduce((a, x) => a + x.t.length, 0);
    while (total > 300000 && tm.out.length > 1) total -= tm.out.shift().t.length;
    if (rootId === S.root?.id) scheduleRender();
  }
  let raf = 0;
  function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderTerm(); }); }
  function promptText(tm) {
    const p = tm.cwd.length > 42 ? shortPath(tm.cwd).replace(/\//g, H.settings().platform === 'win32' ? '\\' : '/') : tm.cwd;
    return H.settings().platform === 'win32' ? `PS ${p}>` : `${p} $`;
  }
  function renderTerm() {
    const tm = term();
    if (!tm) return;
    const out = $('#termOut');
    const stick = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    out.innerHTML = tm.out.map(x => x.s === 'cmd'
      ? `<div class="t-cmd"><span class="t-prompt">${esc(x.p)}</span> ${esc(x.t)}</div>`
      : `<span class="t-${x.s}">${esc(x.t)}</span>`).join('') || `<div class="t-hint">${t('Терминал открыт в папке чата. Команды выполняются в {shell}.', { shell: tm.shell || 'PowerShell' })}</div>`;
    if (stick) out.scrollTop = out.scrollHeight;
    $('#termPrompt').textContent = promptText(tm);
    $('#termShell').textContent = tm.shell || '';
    $('#wbTerm').classList.toggle('running', !!tm.running);
  }
  async function runCmd(cmd) {
    const tm = term();
    if (!tm) return;
    if (/^\s*(cls|clear)\s*$/i.test(cmd)) { tm.out = []; renderTerm(); return; }
    tm.out.push({ s: 'cmd', t: cmd, p: promptText(tm) });
    if (cmd.trim()) { tm.history = tm.history.filter(h => h !== cmd).concat(cmd); saveHistory(tm.history); }
    tm.hi = -1;
    tm.running = true;
    renderTerm();
    const ok = await H.api.term.run(S.root.id, cmd);
    if (!ok) { await ensureTerm(true); await H.api.term.run(S.root.id, cmd); }
  }
  async function stopTerm() {
    const tm = term();
    if (!tm) return;
    tm.out.push({ s: 'err', t: '^C\n' });
    tm.started = false;
    await H.api.term.kill(S.root.id);
    await ensureTerm(true);
  }
  function onTermEvent(ev) {
    const tm = S.terms.get(ev.termId);
    if (!tm) return;
    if (ev.stream === 'done') { tm.cwd = ev.cwd || tm.cwd; tm.running = false; if (ev.termId === S.root?.id) { renderTerm(); refresh(); } return; }
    if (ev.stream === 'exit') { tm.started = false; tm.running = false; if (ev.termId === S.root?.id) renderTerm(); return; }
    push(ev.termId, ev.stream, ev.text);
  }

  // ---------- события ----------
  function bind() {
    $('#wbTree').addEventListener('click', (e) => {
      const r = e.target.closest('.tr-row');
      if (!r) return;
      if (r.dataset.dir === '1') toggleDir(r.dataset.rel); else openFile(r.dataset.rel);
    });
    $('#wbTree').addEventListener('dblclick', (e) => {
      const r = e.target.closest('.tr-row');
      if (r && r.dataset.dir === '0') H.api.ws.openExternal(S.root.id, r.dataset.rel);
    });
    $('#wbTreeToggle').addEventListener('click', () => setTreeHidden(!document.getElementById('workbench').classList.contains('tree-hidden')));
    document.getElementById('workbench').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('workbench').classList.contains('pv-max')) { e.stopPropagation(); setPreviewMax(false); }
    });
    $('#wbPreview').addEventListener('click', (e) => {
      if (e.target.closest('[data-pv-max]')) { setPreviewMax(!document.getElementById('workbench').classList.contains('pv-max')); return; }
      const m = e.target.closest('[data-pv-mode]');
      if (m && S.preview) { S.preview.mode = m.dataset.pvMode; renderPreview(); return; }
      if (e.target.closest('[data-pv-reload]') && S.preview) { S.preview.v = Date.now(); renderPreview(); return; }
      if (e.target.closest('[data-pv-ext]') && S.preview) H.api.ws.openExternal(S.root.id, S.preview.rel);
    });
    $('#wbRefresh').addEventListener('click', refresh);
    $('#wbReveal').addEventListener('click', () => H.api.ws.reveal(S.root.id, S.preview?.rel || ''));
    $('#wbClose').addEventListener('click', () => toggle());
    $('#termClear').addEventListener('click', () => { const tm = term(); if (tm) { tm.out = []; renderTerm(); } });
    $('#termStop').addEventListener('click', stopTerm);
    $('#termRestart').addEventListener('click', async () => { const tm = term(); if (tm) { tm.out = []; tm.started = false; } await H.api.term.kill(S.root.id); ensureTerm(true); });
    $('#termOut').addEventListener('mouseup', () => { if (!getSelection().toString()) $('#termInput').focus(); });
    const input = $('#termInput');
    input.addEventListener('keydown', (e) => {
      const tm = term();
      if (!tm) return;
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; runCmd(v); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const h = tm.history;
        if (!h.length) return;
        tm.hi = e.key === 'ArrowUp' ? (tm.hi < 0 ? h.length - 1 : Math.max(0, tm.hi - 1)) : (tm.hi < 0 ? -1 : tm.hi + 1);
        if (tm.hi >= h.length) tm.hi = -1;
        input.value = tm.hi < 0 ? '' : h[tm.hi];
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && input.selectionStart === input.selectionEnd && !getSelection().toString()) { e.preventDefault(); stopTerm(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyL') { e.preventDefault(); tm.out = []; renderTerm(); }
    });
    drag($('#wbResize'), (ev) => {
      const w = Math.max(380, Math.min(window.innerWidth - 700, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty('--wb-w', `${w}px`);
    }, () => H.saveSettings({ workbench: { ...(H.settings().workbench || {}), width: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--wb-w'), 10) } }));
    drag($('#wbHSplit'), (ev) => {
      const box = $('#workbench .wb-inner').getBoundingClientRect();
      const f = Math.max(0.2, Math.min(0.85, (ev.clientY - box.top) / box.height));
      document.documentElement.style.setProperty('--wb-split', String(f));
    }, () => H.saveSettings({ workbench: { ...(H.settings().workbench || {}), split: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-split')) } }));
    H.api.term.onEvent(onTermEvent);
    H.api.ws.onChanged((d) => { if (d.id === S.root?.id) refresh(); });
  }

  window.Workbench = {
    init(helpers) { H = helpers; mount(); applySize(); },
    sync, toggle, refresh,
    openPath(rel) { if (S.visible) openFile(rel); },
    // Открыть файл по абсолютному пути (из шагов агента или «Прогресса»): раскрыть панель, дерево и предпросмотр
    async openAbs(abs) {
      if (!S.chat) return false;
      if (!S.visible) {
        await H.saveSettings({ workbench: { ...(H.settings().workbench || {}), open: true } });
        await sync(S.chat);
      }
      if (!S.root) return false;
      const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
      const root = norm(S.root.path), file = norm(abs);
      const win = H.settings().platform === 'win32';
      const inside = win ? file.toLowerCase().startsWith(root.toLowerCase() + '/') : file.startsWith(root + '/');
      if (!inside) return false;
      const rel = file.slice(root.length + 1);
      const tr = tree();
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        tr.expanded.add(dir);
        await loadDir(dir).catch(() => {});
      }
      await openFile(rel);
      return true;
    },
    get visible() { return S.visible; },
  };
})();
