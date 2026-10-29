// Страница «Расширения»: MCP-серверы, коннекторы, скиллы, плагины и маркетплейс.
// Всё пишется в родные конфиги агентов, поэтому работает и в самих CLI.
(() => {
  let H; // помощники из app.js
  const AG = ['claude', 'codex', 'antigravity', 'opencode'];
  const S = {
    tab: 'mcp', mk: 'plugins', mcp: null, conns: null, skills: null, plugins: null, pluginsLoading: false,
    form: null, edit: null, pending: new Set(), sure: null, tests: {}, logins: {},
    reg: { q: '', items: null, next: null, busy: false, open: null },
    pq: '', pm: '', accept: {},
  };
  const t = (s, v) => H.t(s, v);
  const esc = (s) => H.esc(s);
  const icon = (n) => H.icon(n);
  const agentName = (a) => H.PROVIDERS[a]?.name || a;
  let root = null;

  // ---------- общее ----------
  function rerender() {
    if (!root || !document.body.contains(root)) return;
    const page = document.getElementById('viewPage');
    const y = page ? page.scrollTop : 0;
    root.querySelector('.ext-body').innerHTML = bodyHtml();
    if (page) page.scrollTop = y;
  }
  async function act(key, fn, okMsg) {
    if (S.pending.has(key)) return;
    S.pending.add(key); rerender();
    try { const r = await fn(); if (okMsg) H.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
    catch (e) { H.toast(H.cleanErr(e), true); }
    finally { S.pending.delete(key); rerender(); }
  }
  const busy = (key) => S.pending.has(key);
  const spin = (key, label, ic) => (busy(key) ? `<span class="ext-spin"></span>${label ? esc(label) : ''}` : `${ic ? icon(ic) : ''}${label ? esc(label) : ''}`);
  const favicon = (domain, letter) => `<img class="prov-ic ext-fav" src="https://www.google.com/s2/favicons?domain=${esc(domain)}&sz=64" data-mono="${esc(letter)}" alt="" draggable="false">`;
  const installed = () => (S.mcp?.agents || S.plugins?.agents || []).filter(a => a.installed).map(a => a.id);
  function splitCmd(line) {
    const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
    while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }
  function kv(text, sep) {
    const o = {};
    for (const line of String(text || '').split('\n')) {
      const i = line.indexOf(sep);
      if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + sep.length).trim();
    }
    return o;
  }
  const kvText = (o, sep) => Object.entries(o || {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');
  const specLine = (s) => (s.type === 'http' ? s.url : [s.command, ...(s.args || [])].join(' '));
  function agentChecks(name, sel, avail = installed()) {
    return `<div class="ext-agents">${(avail.length ? avail : AG).map(a => `<label class="ext-check ${sel.includes(a) ? 'on' : ''}">
      <input type="checkbox" data-f="${name}" value="${a}" ${sel.includes(a) ? 'checked' : ''}>${H.provIcon(a)}<span>${esc(agentName(a))}</span></label>`).join('')}</div>`;
  }

  // ---------- каркас ----------
  const TABS = [['mcp', 'MCP-серверы', 'plug'], ['connectors', 'Коннекторы', 'zap'], ['skills', 'Скиллы', 'sparkles'], ['plugins', 'Плагины', 'puzzle'], ['market', 'Маркетплейс', 'store']];
  async function render(el) {
    el.innerHTML = `<div class="page-inner ext-page">
      <div class="page-head"><h1>${t('Расширения')}</h1><span class="grow"></span>
        <button class="btn" data-x="reload">${icon('refresh')}${t('Обновить')}</button></div>
      <p class="ext-lead">${t('MCP-серверы, коннекторы, скиллы и плагины для Claude Code, Codex, Antigravity и OpenCode. Synapse пишет их в настройки самих агентов, поэтому они работают и в терминале.')}</p>
      <div class="seg ext-tabs">${TABS.map(([id, l, ic]) => `<button data-tab="${id}" class="${S.tab === id ? 'on' : ''}">${icon(ic)}${t(l)}</button>`).join('')}</div>
      <div class="ext-body"></div></div>`;
    root = el.querySelector('.ext-page');
    bind(root);
    rerender();
    load(S.tab);
  }
  async function load(tab, force) {
    try {
      if ((tab === 'mcp' || tab === 'connectors') && (force || !S.mcp)) { S.mcp = await H.api.ext.mcpList(); rerender(); }
      if (tab === 'connectors' && (force || !S.conns)) { S.conns = await H.api.ext.connectors(); rerender(); }
      if (tab === 'skills' && (force || !S.skills)) { S.skills = await H.api.ext.skills({ cwd: H.cwd() }); rerender(); }
      if ((tab === 'plugins' || (tab === 'market' && S.mk === 'plugins')) && (force || !S.plugins) && !S.pluginsLoading) {
        S.pluginsLoading = true; rerender();
        try { S.plugins = await H.api.ext.plugins(); } finally { S.pluginsLoading = false; rerender(); }
      }
      if (tab === 'market' && S.mk === 'mcp' && !S.reg.items && !S.reg.busy) searchRegistry();
      if (tab === 'market' && S.mk === 'mcp' && !S.mcp) { S.mcp = await H.api.ext.mcpList(); rerender(); }
    } catch (e) { H.toast(H.cleanErr(e), true); }
  }
  function bodyHtml() {
    if (S.tab === 'mcp') return mcpHtml();
    if (S.tab === 'connectors') return connHtml();
    if (S.tab === 'skills') return skillsHtml();
    if (S.tab === 'plugins') return pluginsHtml();
    return marketHtml();
  }
  const loading = () => `<div class="ext-loading"><span class="ext-spin"></span>${t('Загружаю…')}</div>`;

  // ================= MCP =================
  function mcpHtml() {
    if (!S.mcp) return loading();
    const avail = installed();
    const f = S.form?.kind === 'mcp' ? S.form : null;
    const errs = Object.entries(S.mcp.errors || {});
    return `<div class="ext-bar"><p>${t('Серверы, которые дают агентам новые инструменты: доступ к сервисам, базам, браузеру. Включайте каждый сервер отдельно для нужных агентов.')}</p>
        ${f ? '' : `<button class="btn primary" data-x="mcp-new">${icon('plus')}${t('Добавить сервер')}</button>`}</div>
      ${errs.map(([a, m]) => `<div class="note warn">${esc(agentName(a))}: ${esc(m)}</div>`).join('')}
      ${f ? mcpFormHtml(f) : ''}
      ${S.mcp.list.length ? `<div class="ext-list">${S.mcp.list.map((r, i) => mcpRow(r, i, avail)).join('')}</div>`
        : `<div class="empty-page">${t('MCP-серверов пока нет. Добавьте свой или подключите готовый на вкладке «Коннекторы».')}</div>`}`;
  }
  function mcpRow(r, i, avail) {
    const ags = [...new Set([...avail, ...Object.keys(r.agents)])];
    const key = `t:${r.name}`;
    const test = S.tests[r.name];
    const sure = S.sure === `rm:${r.name}`;
    const httpOn = r.spec.type === 'http' ? Object.keys(r.agents).filter(a => r.agents[a] && a !== 'antigravity') : [];
    return `<div class="ext-row" style="--i:${Math.min(i, 16)}">
      <div class="er-head">
        <div class="er-main"><b>${esc(r.name)}</b><span class="chip">${r.spec.type === 'http' ? 'URL' : t('команда')}</span>
          <span class="er-sub mono" title="${esc(specLine(r.spec))}">${esc(specLine(r.spec))}</span></div>
        <div class="er-actions">
          <button class="btn sm" data-x="mcp-test" data-name="${esc(r.name)}" ${busy(key) ? 'disabled' : ''}>${spin(key, t('Проверить'), 'zap')}</button>
          ${httpOn.length ? `<button class="btn sm" data-x="mcp-login-menu" data-name="${esc(r.name)}">${icon('key')}${t('Войти')}</button>` : ''}
          <button class="btn sm ${sure ? 'danger' : 'ghost'}" data-x="mcp-rm" data-name="${esc(r.name)}">${busy(`rm:${r.name}`) ? '<span class="ext-spin"></span>' : icon('trash')}${sure ? t('Точно удалить?') : ''}</button>
        </div>
      </div>
      <div class="er-agents">${ags.map(a => {
        const st = r.agents[a];
        const k = `tg:${r.name}:${a}`;
        return `<button class="ag-chip ${st === true ? 'on' : st === 'off' ? 'paused' : ''}" data-x="mcp-toggle" data-name="${esc(r.name)}" data-agent="${a}" ${busy(k) ? 'disabled' : ''}
          title="${st === true ? t('Включён — нажмите, чтобы убрать') : st === 'off' ? t('Выключен в настройках агента') : t('Не подключён — нажмите, чтобы включить')}">
          ${busy(k) ? '<span class="ext-spin"></span>' : H.provIcon(a)}<span>${esc(agentName(a))}</span><i class="ag-dot"></i></button>`;
      }).join('')}${r.parked ? `<span class="hint">${t('Сейчас ни у кого не включён — описание сохранено в Synapse')}</span>` : ''}</div>
      ${test ? `<div class="er-test ${test.ok ? 'ok' : 'bad'}">${icon(test.ok ? 'check' : 'alert')}<span>${esc(test.ok ? (test.note || t('Работает')) : test.error)}${test.tools?.length ? ` · <span class="mono">${esc(test.tools.slice(0, 12).join(', '))}${test.tools.length > 12 ? '…' : ''}</span>` : ''}</span></div>` : ''}
    </div>`;
  }
  function mcpFormHtml(f) {
    const http = f.type === 'http';
    return `<div class="ext-form" data-form="mcp">
      <div class="ef-grid">
        <div class="field"><label>${t('Имя')}</label><input class="input mono" data-f="name" value="${esc(f.name || '')}" placeholder="my-server" spellcheck="false"></div>
        <div class="field"><label>${t('Как запускать')}</label><div class="seg">
          <button data-f-type="stdio" class="${!http ? 'on' : ''}">${icon('terminal')}${t('Команда на компьютере')}</button>
          <button data-f-type="http" class="${http ? 'on' : ''}">${icon('globe')}${t('Удалённый (URL)')}</button></div></div>
      </div>
      ${http ? `<div class="field"><label>URL</label><input class="input mono" data-f="url" value="${esc(f.url || '')}" placeholder="https://example.com/mcp" spellcheck="false"></div>
        <div class="field"><label>${t('Заголовки')}</label><textarea class="input mono" rows="2" data-f="headers" placeholder="Authorization: Bearer …" spellcheck="false">${esc(f.headers || '')}</textarea>
          <div class="hint">${t('Если сервер входит через OAuth, заголовки не нужны: после добавления нажмите «Войти».')}</div></div>`
      : `<div class="field"><label>${t('Команда')}</label><input class="input mono" data-f="cmd" value="${esc(f.cmd || '')}" placeholder="npx -y @modelcontextprotocol/server-filesystem C:\\Projects" spellcheck="false"></div>
        <div class="field"><label>${t('Переменные окружения')}</label><textarea class="input mono" rows="2" data-f="env" placeholder="API_KEY=…" spellcheck="false">${esc(f.env || '')}</textarea></div>`}
      <div class="field"><label>${t('Для каких агентов')}</label>${agentChecks('agents', f.agents || installed())}</div>
      ${S.tests.__form ? `<div class="er-test ${S.tests.__form.ok ? 'ok' : 'bad'}">${icon(S.tests.__form.ok ? 'check' : 'alert')}<span>${esc(S.tests.__form.ok ? S.tests.__form.note : S.tests.__form.error)}</span></div>` : ''}
      <div class="ef-actions">
        <button class="btn" data-x="form-test" ${busy('ftest') ? 'disabled' : ''}>${spin('ftest', t('Проверить'), 'zap')}</button>
        <span class="grow"></span>
        <button class="btn ghost" data-x="form-cancel">${t('Отмена')}</button>
        <button class="btn primary" data-x="mcp-save" ${busy('fsave') ? 'disabled' : ''}>${spin('fsave', f.edit ? t('Сохранить') : t('Добавить'), 'check')}</button>
      </div></div>`;
  }
  function formSpec(f) {
    if (f.type === 'http') return { type: 'http', url: String(f.url || '').trim(), headers: kv(f.headers, ':') };
    const parts = splitCmd(f.cmd || '');
    return { type: 'stdio', command: parts[0] || '', args: parts.slice(1), env: kv(f.env, '=') };
  }
  function addResults(res) {
    const bad = Object.entries(res).filter(([, r]) => !r.ok);
    const good = Object.entries(res).filter(([, r]) => r.ok).map(([a]) => agentName(a));
    if (bad.length) H.toast(bad.map(([a, r]) => `${agentName(a)}: ${r.error}`).join('\n'), true);
    if (good.length) H.toast(t('Добавлено: {who}', { who: good.join(', ') }));
    return good.length > 0;
  }

  // ================= Коннекторы =================
  function connState(c) {
    if (!S.mcp) return {};
    const row = S.mcp.list.find(r => r.name === c.id) || S.mcp.list.find(r => (c.spec.type === 'http' ? r.spec.url === c.spec.url : (r.spec.args || []).some(x => (c.spec.args || []).includes(x) && /[@/]/.test(x))));
    return row ? { row, on: Object.keys(row.agents).filter(a => row.agents[a] === true) } : {};
  }
  function connHtml() {
    if (!S.conns || !S.mcp) return loading();
    const AUTH = { oauth: ['key', t('вход через браузер')], token: ['key', t('нужен токен')], none: ['check', t('без входа')] };
    const f = S.form?.kind === 'conn' ? S.form : null;
    return `<div class="ext-bar"><p>${t('Готовые подключения к сервисам. Нажмите «Подключить», выберите агентов — и при необходимости войдите в аккаунт.')}</p></div>
      <div class="ext-cards">${S.conns.map((c, i) => {
        const st = connState(c);
        const open = f?.id === c.id;
        return `<div class="ext-card ${st.on?.length ? 'on' : ''} ${open ? 'open' : ''}" style="--i:${i}">
          <div class="ec-top">${favicon(c.domain, c.name[0])}<b>${esc(t(c.name))}</b>${c.local ? `<span class="chip">${t('локально')}</span>` : ''}</div>
          <div class="ec-desc">${esc(t(c.desc))}</div>
          <div class="ec-foot"><span class="ec-auth">${icon(AUTH[c.auth][0])}${AUTH[c.auth][1]}</span>
            ${st.on?.length ? `<span class="ec-on">${st.on.map(a => H.provIcon(a)).join('')}</span>` : ''}
            <button class="btn sm ${st.on?.length ? '' : 'primary'}" data-x="conn-open" data-id="${c.id}">${st.on?.length ? t('Настроить') : t('Подключить')}</button></div>
          ${open ? connFormHtml(c, f, st) : ''}
        </div>`;
      }).join('')}</div>
      <p class="ext-more">${t('Нужен другой сервис? Тысячи серверов есть во вкладке «Маркетплейс» → «MCP-серверы».')}</p>`;
  }
  function connFormHtml(c, f, st) {
    const added = st.on || [];
    const loginable = c.auth === 'oauth' ? added.filter(a => a !== 'antigravity') : [];
    return `<div class="ec-form" data-form="conn">
      ${c.auth === 'token' ? `<div class="field"><label>${t('Токен')}</label><input class="input mono" type="password" data-f="token" value="${esc(f.token || '')}" placeholder="ghp_…" spellcheck="false"><div class="hint">${esc(c.tokenHint || '')}</div></div>` : ''}
      ${c.needsPath ? `<div class="field"><label>${t('Папка')}</label><div class="row"><input class="input mono" data-f="path" value="${esc(f.path || '')}" spellcheck="false"><button class="btn" data-x="conn-pick">${icon('folder')}${t('Выбрать')}</button></div></div>` : ''}
      <div class="field"><label>${t('Для каких агентов')}</label>${agentChecks('agents', f.agents)}</div>
      <div class="ef-actions">
        ${loginable.map(a => `<button class="btn sm" data-x="mcp-login" data-name="${esc(st.row.name)}" data-agent="${a}">${H.provIcon(a)}${t('Войти')}</button>`).join('')}
        <span class="grow"></span>
        <button class="btn ghost sm" data-x="form-cancel">${t('Закрыть')}</button>
        <button class="btn primary sm" data-x="conn-save" data-id="${c.id}" ${busy('csave') ? 'disabled' : ''}>${spin('csave', added.length ? t('Сохранить') : t('Подключить'), 'check')}</button>
      </div>
      ${c.auth === 'oauth' && !added.length ? `<div class="hint">${t('После подключения нажмите «Войти» — откроется окно терминала и браузер для входа в аккаунт.')}</div>` : ''}
    </div>`;
  }

  // ================= Скиллы =================
  function skillsHtml() {
    if (!S.skills) return loading();
    const e = S.edit;
    return `<div class="ext-bar"><p>${t('Скилл — это папка с инструкцией SKILL.md: агент сам подключает её, когда задача подходит под описание. Формат общий для всех агентов.')}</p>
        ${e ? '' : `<button class="btn" data-x="skill-import">${icon('folderOpen')}${t('Импорт из папки')}</button><button class="btn primary" data-x="skill-new">${icon('plus')}${t('Новый скилл')}</button>`}</div>
      ${e ? skillFormHtml(e) : ''}
      ${S.skills.skills.length ? `<div class="ext-list">${S.skills.skills.map((s, i) => {
        const sure = S.sure === `srm:${s.dir}`;
        return `<div class="ext-row" style="--i:${Math.min(i, 16)}">
          <div class="er-head"><div class="er-main"><b>${esc(s.name)}</b><span class="chip" title="${esc(s.dir)}">${esc(s.rootLabel)}</span>
            <span class="er-seen">${s.seenBy.map(a => H.provIcon(a)).join('')}</span></div>
            <div class="er-actions">
              <button class="btn sm" data-x="skill-edit" data-dir="${esc(s.dir)}">${icon('pencil')}${t('Изменить')}</button>
              <button class="btn sm ghost" data-x="skill-copy" data-dir="${esc(s.dir)}" title="${t('Копировать в другую папку')}">${icon('copy')}</button>
              <button class="btn sm ghost" data-x="open" data-path="${esc(s.dir)}" title="${t('Открыть папку')}">${icon('folderOpen')}</button>
              <button class="btn sm ${sure ? 'danger' : 'ghost'}" data-x="skill-rm" data-dir="${esc(s.dir)}">${icon('trash')}${sure ? t('Точно удалить?') : ''}</button></div></div>
          <div class="er-desc">${esc(s.description)}</div></div>`;
      }).join('')}</div>` : `<div class="empty-page">${t('Скиллов пока нет. Создайте первый или установите набор из маркетплейса (например, anthropics/skills).')}</div>`}`;
  }
  function skillFormHtml(e) {
    const roots = S.skills.roots;
    return `<div class="ext-form" data-form="skill">
      <div class="ef-grid">
        <div class="field"><label>${t('Имя')}</label><input class="input mono" data-f="name" value="${esc(e.name || '')}" placeholder="commit-messages" spellcheck="false">
          <div class="hint">${t('Строчные латинские буквы, цифры и дефисы')}</div></div>
        ${e.dir ? `<div class="field"><label>${t('Папка')}</label><div class="input mono ef-ro" title="${esc(e.dir)}">${esc(e.dir)}</div></div>`
          : `<div class="field"><label>${t('Куда сохранить')}</label><div class="ext-agents">${roots.filter(r => ['claude', 'agents'].includes(r.id)).map(r => `<label class="ext-check ${(e.roots || []).includes(r.id) ? 'on' : ''}">
              <input type="checkbox" data-f="roots" value="${r.id}" ${(e.roots || []).includes(r.id) ? 'checked' : ''}><span class="mono">${esc(r.label)}</span><span class="er-seen">${r.seenBy.map(a => H.provIcon(a)).join('')}</span></label>`).join('')}</div></div>`}
      </div>
      <div class="field"><label>${t('Когда применять (описание)')} <span class="dim">${(e.description || '').length}/1024</span></label>
        <textarea class="input" rows="2" data-f="description" placeholder="${t('Например: Use when writing git commit messages for this team')}">${esc(e.description || '')}</textarea></div>
      <div class="field"><label>${t('Инструкция')}</label><textarea class="input mono ef-body" rows="12" data-f="body" spellcheck="false" placeholder="# ${t('Как писать сообщения коммитов')}\n\n1. …">${esc(e.body || '')}</textarea></div>
      ${e.files?.length > 1 ? `<div class="hint">${t('В папке есть ещё файлы')}: <span class="mono">${esc(e.files.filter(x => x !== 'SKILL.md').join(', '))}</span></div>` : ''}
      <div class="ef-actions"><span class="grow"></span>
        <button class="btn ghost" data-x="form-cancel">${t('Отмена')}</button>
        <button class="btn primary" data-x="skill-save" ${busy('ssave') ? 'disabled' : ''}>${spin('ssave', t('Сохранить'), 'check')}</button></div></div>`;
  }

  // ================= Плагины =================
  function pluginsHtml() {
    if (!S.plugins) return loading();
    const c = S.plugins.claude;
    const mkNames = new Set((c.marketplaces || []).map(m => m.name));
    return `<div class="ext-sec"><h3>${H.provIcon('claude')}Claude Code</h3>
        ${!c.ok ? `<div class="note warn">${esc(c.error || t('Недоступно'))}</div>` : `
        ${c.installed.length ? `<div class="ext-list">${c.installed.map((p, i) => {
          const sure = S.sure === `prm:${p.id}`;
          return `<div class="ext-row" style="--i:${i}"><div class="er-head">
            <div class="er-main"><b>${esc(p.id.split('@')[0])}</b><span class="chip">${esc(p.id.split('@')[1] || '')}</span><span class="dim">${esc(p.version || '')}</span>
              ${p.mcp?.length ? `<span class="chip">MCP: ${esc(p.mcp.join(', '))}</span>` : ''}</div>
            <div class="er-actions">
              <button class="switch-btn" data-x="plug-toggle" data-id="${esc(p.id)}" data-on="${p.enabled ? 1 : 0}" title="${p.enabled ? t('Выключить') : t('Включить')}" ${busy(`pt:${p.id}`) ? 'disabled' : ''}><span class="switch ${p.enabled ? 'on' : ''}"></span></button>
              <button class="btn sm ghost" data-x="plug-update" data-id="${esc(p.id)}" title="${t('Обновить')}">${busy(`pu:${p.id}`) ? '<span class="ext-spin"></span>' : icon('refresh')}</button>
              <button class="btn sm ${sure ? 'danger' : 'ghost'}" data-x="plug-rm" data-id="${esc(p.id)}">${busy(`pr:${p.id}`) ? '<span class="ext-spin"></span>' : icon('trash')}${sure ? t('Точно удалить?') : ''}</button></div></div>
            ${[...(p.errors || []), ...(p.notes || [])].map(m => `<div class="er-test bad">${icon('alert')}<span>${esc(m)}</span></div>`).join('')}</div>`;
        }).join('')}</div>` : `<div class="note">${t('Плагинов пока нет — загляните во вкладку «Маркетплейс».')}</div>`}
        <h4>${t('Маркетплейсы')}</h4>
        <div class="ext-list">${(c.marketplaces || []).map(m => `<div class="ext-row"><div class="er-head"><div class="er-main"><b>${esc(m.name)}</b><span class="er-sub mono">${esc(m.repo)}</span></div>
          <div class="er-actions"><button class="btn sm ghost" data-x="mk-update" data-name="${esc(m.name)}" title="${t('Обновить список плагинов')}">${busy(`mu:${m.name}`) ? '<span class="ext-spin"></span>' : icon('refresh')}</button>
          <button class="btn sm ${S.sure === `mrm:${m.name}` ? 'danger' : 'ghost'}" data-x="mk-rm" data-name="${esc(m.name)}">${busy(`mr:${m.name}`) ? '<span class="ext-spin"></span>' : icon('trash')}${S.sure === `mrm:${m.name}` ? t('Точно удалить?') : ''}</button></div></div></div>`).join('')}</div>
        <div class="ext-add"><input class="input mono" data-f="mksrc" placeholder="owner/repo, https://… ${t('или путь к папке')}" spellcheck="false">
          <button class="btn" data-x="mk-add" ${busy('mkadd') ? 'disabled' : ''}>${spin('mkadd', t('Добавить маркетплейс'), 'plus')}</button></div>
        <div class="ext-presets">${S.plugins.markets.filter(m => !mkNames.has(m.name)).map(m => `<button class="ext-preset" data-x="mk-preset" data-src="${esc(m.source)}" title="${esc(t(m.desc))}">${icon('plus')}<span class="mono">${esc(m.source)}</span><small>${esc(t(m.desc))}</small></button>`).join('')}</div>`}
      </div>
      <div class="ext-sec"><h3>${H.provIcon('codex')}Codex</h3>
        ${S.plugins.codex.length ? `<div class="ext-list">${S.plugins.codex.map(p => `<div class="ext-row"><div class="er-head"><div class="er-main"><b>${esc(p.name)}</b><span class="chip">${esc(p.id.split('@')[1] || '')}</span><span class="dim">${esc(p.version)}</span></div>
          <div class="er-actions"><button class="switch-btn" data-x="codex-toggle" data-id="${esc(p.id)}" data-on="${p.enabled ? 1 : 0}"><span class="switch ${p.enabled ? 'on' : ''}"></span></button></div></div>
          ${p.description ? `<div class="er-desc">${esc(p.description)}</div>` : ''}</div>`).join('')}</div>`
          : `<div class="note">${t('Плагины Codex устанавливаются в самом Codex командой /plugins. Здесь их можно включать и выключать.')}</div>`}
      </div>
      <div class="ext-sec"><h3>${H.provIcon('antigravity')}Antigravity</h3>
        ${S.plugins.antigravity.length ? `<div class="ext-list">${S.plugins.antigravity.map(p => `<div class="ext-row"><div class="er-head"><div class="er-main"><b>${esc(p.name)}</b><span class="dim">${esc(p.version)}</span>${p.mcp.length ? `<span class="chip">MCP: ${esc(p.mcp.join(', '))}</span>` : ''}</div>
          <div class="er-actions"><button class="btn sm ghost" data-x="open" data-path="${esc(p.dir)}">${icon('folderOpen')}</button></div></div>${p.description ? `<div class="er-desc">${esc(p.description)}</div>` : ''}</div>`).join('')}</div>`
          : `<div class="note">${t('Плагины Antigravity лежат в ~/.gemini/config/plugins. Пока здесь их можно только посмотреть.')}</div>`}
      </div>`;
  }

  // ================= Маркетплейс =================
  function marketHtml() {
    return `<div class="seg ext-mk">
        <button data-mk="plugins" class="${S.mk === 'plugins' ? 'on' : ''}">${H.provIcon('claude')}${t('Плагины Claude Code')}</button>
        <button data-mk="mcp" class="${S.mk === 'mcp' ? 'on' : ''}">${icon('plug')}${t('MCP-серверы')}</button></div>
      ${S.mk === 'plugins' ? marketPlugins() : marketMcp()}`;
  }
  function marketPlugins() {
    if (!S.plugins) return loading();
    const c = S.plugins.claude;
    if (!c.ok) return `<div class="note warn">${esc(c.error || '')}</div>`;
    const q = S.pq.toLowerCase();
    const mks = [...new Set(c.available.map(p => p.marketplace))];
    const items = c.available.filter(p => (!S.pm || p.marketplace === S.pm) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q)));
    return `<div class="ext-search">${icon('search')}<input class="input" data-f="pq" value="${esc(S.pq)}" placeholder="${t('Поиск плагинов')}">
        <select class="input" data-f="pm"><option value="">${t('Все маркетплейсы')}</option>${mks.map(m => `<option value="${esc(m)}" ${S.pm === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div class="ext-count">${items.length} ${t('плагинов')} · ${c.installed.length} ${t('установлено')}</div>
      <div class="ext-cards">${items.slice(0, 120).map((p, i) => {
        const key = `pi:${p.id}`;
        const need = S.accept[p.id];
        return `<div class="ext-card ${need ? 'open' : ''}" style="--i:${Math.min(i, 20)}">
          <div class="ec-top">${icon('puzzle')}<b>${esc(p.name)}</b>${p.version ? `<span class="dim">${esc(p.version)}</span>` : ''}</div>
          <div class="ec-desc">${esc(p.description || '—')}</div>
          <div class="ec-foot"><span class="ec-auth">${esc(p.marketplace)}${p.installs ? ` · ${H.fmtNum(p.installs)} ${t('установок')}` : ''}</span>
            <button class="btn sm primary" data-x="plug-install" data-id="${esc(p.id)}" ${busy(key) ? 'disabled' : ''}>${spin(key, t('Установить'), 'download')}</button></div>
          ${need ? `<div class="ec-form"><div class="note warn">${t('Маркетплейс просит выполнить команду при установке. Проверьте её:')}<pre class="mono">${esc(need.command)}</pre></div>
            <div class="ef-actions"><span class="grow"></span><button class="btn ghost sm" data-x="plug-noaccept" data-id="${esc(p.id)}">${t('Отмена')}</button>
            <button class="btn sm danger" data-x="plug-install" data-id="${esc(p.id)}" data-accept="${esc(need.sha256)}">${t('Выполнить и установить')}</button></div></div>` : ''}
        </div>`;
      }).join('')}</div>
      ${items.length > 120 ? `<p class="ext-more">${t('Показаны первые 120 — уточните поиск.')}</p>` : ''}
      ${!c.available.length ? `<div class="empty-page">${t('Нет доступных плагинов. Добавьте маркетплейс на вкладке «Плагины».')}</div>` : ''}`;
  }
  async function searchRegistry(more) {
    S.reg.busy = true; rerender();
    try {
      const r = await H.api.ext.registry({ query: S.reg.q, cursor: more ? S.reg.next : null });
      S.reg.items = more ? [...(S.reg.items || []), ...r.items] : r.items;
      S.reg.next = r.next;
      S.reg.error = null;
    } catch (e) { S.reg.error = H.cleanErr(e); S.reg.items = S.reg.items || []; }
    finally { S.reg.busy = false; rerender(); }
  }
  function marketMcp() {
    const items = S.reg.items;
    const f = S.form?.kind === 'reg' ? S.form : null;
    return `<div class="ext-search">${icon('search')}<input class="input" data-f="rq" value="${esc(S.reg.q)}" placeholder="${t('Поиск в официальном реестре MCP: github, postgres, slack…')}"></div>
      ${!items ? loading() : `<div class="ext-cards">${items.map((it, i) => {
        const kinds = [...it.remotes.map(() => 'URL'), ...it.packages.map(p => p.registryType)];
        const open = f?.id === it.id;
        const have = S.mcp?.list.some(r => r.name === shortName(it.id));
        return `<div class="ext-card ${open ? 'open' : ''} ${have ? 'on' : ''}" style="--i:${Math.min(i, 20)}">
          <div class="ec-top">${icon('plug')}<b title="${esc(it.id)}">${esc(it.title)}</b><span class="dim">${esc(it.version)}</span></div>
          <div class="ec-id mono">${esc(it.id)}</div>
          <div class="ec-desc">${esc(it.description || '—')}</div>
          <div class="ec-foot"><span class="ec-auth">${[...new Set(kinds)].map(k => `<span class="chip">${esc(k)}</span>`).join('')}</span>
            ${it.repo ? `<button class="btn sm ghost" data-x="ext-link" data-url="${esc(it.repo)}" title="${t('Исходный код')}">${icon('external')}</button>` : ''}
            <button class="btn sm ${have ? '' : 'primary'}" data-x="reg-open" data-id="${esc(it.id)}" ${kinds.length ? '' : 'disabled'}>${have ? t('Добавлен') : t('Добавить')}</button></div>
          ${open ? regFormHtml(it, f) : ''}</div>`;
      }).join('')}</div>
      ${S.reg.error ? `<div class="note warn ext-err">${icon('alert')}<span>${t('Реестр MCP недоступен')}: ${esc(S.reg.error)}</span><button class="btn sm" data-x="reg-retry">${icon('refresh')}${t('Повторить')}</button></div>` : ''}
      ${!items.length && !S.reg.busy && !S.reg.error ? `<div class="empty-page">${t('Ничего не нашлось.')}</div>` : ''}
      ${S.reg.next ? `<div class="ext-more"><button class="btn" data-x="reg-more" ${S.reg.busy ? 'disabled' : ''}>${S.reg.busy ? '<span class="ext-spin"></span>' : ''}${t('Показать ещё')}</button></div>` : ''}`}`;
  }
  const shortName = (id) => String(id).split('/').pop().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'mcp';
  function regFormHtml(it, f) {
    const opts = [...it.remotes.map((r, i) => ({ k: `r${i}`, label: `URL · ${r.type === 'sse' ? 'SSE' : 'HTTP'}`, sub: r.url })), ...it.packages.map((p, i) => ({ k: `p${i}`, label: p.registryType === 'oci' ? 'Docker' : p.registryType, sub: p.identifier }))];
    const cur = f.choice || opts[0]?.k;
    const inputs = cur?.startsWith('r') ? it.remotes[+cur.slice(1)].headers : it.packages[+cur?.slice(1)]?.env || [];
    return `<div class="ec-form" data-form="reg">
      <div class="field"><label>${t('Имя')}</label><input class="input mono" data-f="name" value="${esc(f.name)}" spellcheck="false"></div>
      ${opts.length > 1 ? `<div class="field"><label>${t('Как подключать')}</label><div class="ext-opts">${opts.map(o => `<button class="ext-opt ${cur === o.k ? 'on' : ''}" data-x="reg-choice" data-k="${o.k}"><b>${esc(o.label)}</b><small class="mono">${esc(o.sub)}</small></button>`).join('')}</div></div>` : ''}
      ${inputs.map(v => `<div class="field"><label class="mono">${esc(v.name)}${v.required ? ' *' : ''}</label><input class="input mono" ${v.secret ? 'type="password"' : ''} data-f="v:${esc(v.name)}" value="${esc(f.vals?.[v.name] || '')}" spellcheck="false">${v.description ? `<div class="hint">${esc(v.description)}</div>` : ''}</div>`).join('')}
      ${cur?.startsWith('p') ? `<div class="hint">${t('Нужен установленный {r}', { r: it.packages[+cur.slice(1)].registryType === 'npm' ? 'Node.js (npx)' : it.packages[+cur.slice(1)].registryType === 'pypi' ? 'uv (uvx)' : 'Docker' })}</div>` : ''}
      <div class="field"><label>${t('Для каких агентов')}</label>${agentChecks('agents', f.agents)}</div>
      <div class="ef-actions"><span class="grow"></span><button class="btn ghost sm" data-x="form-cancel">${t('Отмена')}</button>
        <button class="btn primary sm" data-x="reg-save" ${busy('rsave') ? 'disabled' : ''}>${spin('rsave', t('Добавить'), 'check')}</button></div></div>`;
  }

  // ================= события =================
  function bind(el) {
    el.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      if (f === 'pq') { S.pq = e.target.value; clearTimeout(bind.tp); bind.tp = setTimeout(() => { rerender(); focusEnd('[data-f="pq"]'); }, 200); return; }
      if (f === 'rq') { S.reg.q = e.target.value; clearTimeout(bind.tr); bind.tr = setTimeout(() => { searchRegistry().then(() => focusEnd('[data-f="rq"]')); }, 450); return; }
      if (f === 'mksrc') { S.mksrc = e.target.value; return; }
      const form = S.form || S.edit;
      if (!form) return;
      if (e.target.type === 'checkbox') {
        const list = new Set(form[f] || []);
        e.target.checked ? list.add(e.target.value) : list.delete(e.target.value);
        form[f] = [...list];
        e.target.closest('.ext-check')?.classList.toggle('on', e.target.checked);
        return;
      }
      if (f.startsWith('v:')) { form.vals = form.vals || {}; form.vals[f.slice(2)] = e.target.value; return; }
      form[f] = e.target.value;
      if (f === 'description') { const c = e.target.closest('.field').querySelector('.dim'); if (c) c.textContent = `${e.target.value.length}/1024`; }
    });
    el.addEventListener('change', (e) => { if (e.target.dataset.f === 'pm') { S.pm = e.target.value; rerender(); } });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.f === 'mksrc') el.querySelector('[data-x="mk-add"]')?.click(); });
    el.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { S.tab = tab.dataset.tab; S.form = null; S.edit = null; S.sure = null; el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === tab)); rerender(); load(S.tab); return; }
      const mk = e.target.closest('[data-mk]');
      if (mk) { S.mk = mk.dataset.mk; S.form = null; rerender(); load('market'); return; }
      const ft = e.target.closest('[data-f-type]');
      if (ft && S.form) { S.form.type = ft.dataset.fType; S.tests.__form = null; rerender(); return; }
      const b = e.target.closest('[data-x]');
      if (!b || b.disabled) return;
      const x = b.dataset.x;
      // двойное нажатие для удаления: первое просит подтверждение
      const confirmTwice = (key) => { if (S.sure === key) { S.sure = null; return true; } S.sure = key; rerender(); setTimeout(() => { if (S.sure === key) { S.sure = null; rerender(); } }, 4000); return false; };
      switch (x) {
        case 'reload': S.mcp = S.conns = S.skills = S.plugins = null; S.reg.items = null; rerender(); return load(S.tab, true);
        case 'open': return H.api.open(b.dataset.path);
        case 'ext-link': return H.api.openUrl(b.dataset.url);
        case 'form-cancel': S.form = null; S.edit = null; S.tests.__form = null; return rerender();
        // --- MCP ---
        case 'mcp-new': S.form = { kind: 'mcp', type: 'stdio', agents: installed() }; S.tests.__form = null; rerender(); return el.querySelector('[data-f="name"]')?.focus();
        case 'form-test': return act('ftest', async () => { S.tests.__form = await H.api.ext.mcpTest(formSpec(S.form)); });
        case 'mcp-save': {
          const f = S.form;
          if (!f.agents?.length) return H.toast(t('Выберите хотя бы одного агента'), true);
          return act('fsave', async () => {
            const res = await H.api.ext.mcpAdd({ name: String(f.name || '').trim(), spec: formSpec(f), agents: f.agents });
            if (addResults(res)) S.form = null;
            S.mcp = await H.api.ext.mcpList();
          });
        }
        case 'mcp-toggle': {
          const r = S.mcp.list.find(x => x.name === b.dataset.name);
          const a = b.dataset.agent;
          const on = r.agents[a] !== true;
          return act(`tg:${r.name}:${a}`, async () => { await H.api.ext.mcpToggle({ name: r.name, agent: a, on, spec: r.spec }); S.mcp = await H.api.ext.mcpList(); },
            on ? t('{n} включён для {a}', { n: r.name, a: agentName(a) }) : t('{n} убран у {a}', { n: r.name, a: agentName(a) }));
        }
        case 'mcp-test': {
          const r = S.mcp.list.find(x => x.name === b.dataset.name);
          return act(`t:${r.name}`, async () => { S.tests[r.name] = await H.api.ext.mcpTest(r.spec); });
        }
        case 'mcp-login-menu': {
          const r = S.mcp.list.find(x => x.name === b.dataset.name);
          const ags = Object.keys(r.agents).filter(a => r.agents[a] === true);
          return H.menu(b, [{ label: t('Войти в {n}', { n: r.name }) }, ...ags.map(a => ({
            iconHtml: H.provIcon(a), text: agentName(a), check: false, disabled: a === 'antigravity', hint: a === 'antigravity' ? t('входит сам при первом запуске') : '',
            act: () => H.api.ext.mcpLogin({ name: r.name, agent: a }).then(() => H.toast(t('Откроется терминал — завершите вход в браузере'))).catch(err => H.toast(H.cleanErr(err), true)),
          }))], { align: 'right' });
        }
        case 'mcp-login': return H.api.ext.mcpLogin({ name: b.dataset.name, agent: b.dataset.agent }).then(() => H.toast(t('Откроется терминал — завершите вход в браузере'))).catch(err => H.toast(H.cleanErr(err), true));
        case 'mcp-rm': {
          if (!confirmTwice(`rm:${b.dataset.name}`)) return;
          const r = S.mcp.list.find(x => x.name === b.dataset.name);
          return act(`rm:${r.name}`, async () => { await H.api.ext.mcpRemove({ name: r.name, agents: Object.keys(r.agents) }); S.mcp = await H.api.ext.mcpList(); }, t('Сервер удалён'));
        }
        // --- коннекторы ---
        case 'conn-open': {
          const c = S.conns.find(x => x.id === b.dataset.id);
          const st = connState(c);
          S.form = S.form?.id === c.id ? null : { kind: 'conn', id: c.id, agents: st.on?.length ? st.on : installed() };
          return rerender();
        }
        case 'conn-pick': { const d = await H.api.pickFolder(); if (d) { S.form.path = d; rerender(); } return; }
        case 'conn-save': {
          const c = S.conns.find(x => x.id === b.dataset.id);
          const f = S.form;
          if (c.auth === 'token' && !String(f.token || '').trim() && !connState(c).on?.length) return H.toast(t('Вставьте токен'), true);
          if (c.needsPath && !f.path) return H.toast(t('Выберите папку'), true);
          const spec = JSON.parse(JSON.stringify(c.spec));
          if (c.auth === 'token' && f.token) spec.headers = { ...(spec.headers || {}), [c.tokenHeader]: `${c.tokenPrefix || ''}${f.token.trim()}` };
          if (c.needsPath) spec.args = [...spec.args, f.path];
          const st = connState(c);
          const name = st.row?.name || c.id;
          return act('csave', async () => {
            const add = (f.agents || []).filter(a => !(st.on || []).includes(a) || f.token || f.path);
            const remove = (st.on || []).filter(a => !(f.agents || []).includes(a));
            if (add.length) addResults(await H.api.ext.mcpAdd({ name, spec: f.token || f.path || !st.row ? spec : st.row.spec, agents: add }));
            for (const a of remove) await H.api.ext.mcpToggle({ name, agent: a, on: false, spec: st.row?.spec || spec });
            S.mcp = await H.api.ext.mcpList();
            if (c.auth !== 'oauth') S.form = null;
          });
        }
        // --- скиллы ---
        case 'skill-new': S.edit = { name: '', description: '', body: '', roots: ['claude', 'agents'] }; rerender(); return el.querySelector('[data-f="name"]')?.focus();
        case 'skill-edit': return act(`se:${b.dataset.dir}`, async () => { S.edit = await H.api.ext.skillRead({ dir: b.dataset.dir, cwd: H.cwd() }); window.scrollTo?.(0, 0); });
        case 'skill-save': {
          const e2 = S.edit;
          if (!e2.dir && !e2.roots?.length) return H.toast(t('Выберите, куда сохранить'), true);
          return act('ssave', async () => {
            await H.api.ext.skillSave({ name: String(e2.name || '').trim(), description: e2.description, body: e2.body, roots: e2.roots, dir: e2.dir || null, projectDir: H.cwd() });
            S.edit = null; S.skills = await H.api.ext.skills({ cwd: H.cwd() });
          }, t('Скилл сохранён'));
        }
        case 'skill-rm': {
          if (!confirmTwice(`srm:${b.dataset.dir}`)) return;
          return act(`srm:${b.dataset.dir}`, async () => { await H.api.ext.skillRemove({ dir: b.dataset.dir, cwd: H.cwd() }); S.skills = await H.api.ext.skills({ cwd: H.cwd() }); }, t('Скилл удалён'));
        }
        case 'skill-copy': {
          const s = S.skills.skills.find(x => x.dir === b.dataset.dir);
          return H.menu(b, [{ label: t('Копировать в') }, ...S.skills.roots.filter(r => r.id !== s.root).map(r => ({
            text: r.label, hint: r.seenBy.map(agentName).join(', '), check: false,
            act: () => act('scopy', async () => { await H.api.ext.skillCopy({ dir: s.dir, root: r.id, cwd: H.cwd() }); S.skills = await H.api.ext.skills({ cwd: H.cwd() }); }, t('Скопировано')),
          }))], { align: 'right' });
        }
        case 'skill-import':
          return H.menu(b, [{ label: t('Куда импортировать') }, ...S.skills.roots.filter(r => ['claude', 'agents'].includes(r.id)).map(r => ({
            text: r.label, hint: r.seenBy.map(agentName).join(', '), check: false,
            act: () => act('simp', async () => { const r2 = await H.api.ext.skillImport({ roots: [r.id], cwd: H.cwd() }); if (r2) S.skills = await H.api.ext.skills({ cwd: H.cwd() }); return r2; }, (r2) => (r2 ? t('Скилл импортирован') : t('Отменено'))),
          }))]);
        // --- плагины ---
        case 'plug-toggle': {
          const id = b.dataset.id, on = b.dataset.on !== '1';
          return act(`pt:${id}`, async () => { const r = await H.api.ext.plugin({ action: on ? 'enable' : 'disable', id }); if (!r.ok) throw new Error(r.message); S.plugins = await H.api.ext.plugins(); });
        }
        case 'plug-update': return act(`pu:${b.dataset.id}`, async () => { const r = await H.api.ext.plugin({ action: 'update', id: b.dataset.id }); if (!r.ok) throw new Error(r.message); S.plugins = await H.api.ext.plugins(); return r; }, (r) => r.message || t('Обновлено'));
        case 'plug-rm': {
          if (!confirmTwice(`prm:${b.dataset.id}`)) return;
          return act(`pr:${b.dataset.id}`, async () => { const r = await H.api.ext.plugin({ action: 'uninstall', id: b.dataset.id }); if (!r.ok) throw new Error(r.message); S.plugins = await H.api.ext.plugins(); }, t('Плагин удалён'));
        }
        case 'plug-install': {
          const id = b.dataset.id;
          return act(`pi:${id}`, async () => {
            const r = await H.api.ext.plugin({ action: 'install', id, accept: b.dataset.accept || null });
            if (r.needAccept) { S.accept[id] = r.needAccept; return; }
            delete S.accept[id];
            if (!r.ok) throw new Error(r.message);
            H.toast(t('Установлен: {n}', { n: id.split('@')[0] }));
            S.plugins = await H.api.ext.plugins();
          });
        }
        case 'plug-noaccept': delete S.accept[b.dataset.id]; return rerender();
        case 'codex-toggle': return act(`ct:${b.dataset.id}`, async () => { await H.api.ext.codexPlugin({ id: b.dataset.id, enabled: b.dataset.on !== '1' }); S.plugins = await H.api.ext.plugins(); });
        case 'mk-add': case 'mk-preset': {
          const src = x === 'mk-preset' ? b.dataset.src : String(S.mksrc || '').trim();
          if (!src) return H.toast(t('Укажите owner/repo, ссылку или путь к папке'), true);
          return act('mkadd', async () => { const r = await H.api.ext.market({ action: 'add', arg: src }); S.mksrc = ''; S.plugins = await H.api.ext.plugins(); return r; }, (r) => r?.message || t('Маркетплейс добавлен'));
        }
        case 'mk-update': return act(`mu:${b.dataset.name}`, async () => { await H.api.ext.market({ action: 'update', arg: b.dataset.name }); S.plugins = await H.api.ext.plugins(); }, t('Список плагинов обновлён'));
        case 'mk-rm': {
          if (!confirmTwice(`mrm:${b.dataset.name}`)) return;
          return act(`mr:${b.dataset.name}`, async () => { await H.api.ext.market({ action: 'remove', arg: b.dataset.name }); S.plugins = await H.api.ext.plugins(); }, t('Маркетплейс удалён'));
        }
        // --- реестр MCP ---
        case 'reg-more': return searchRegistry(true);
        case 'reg-retry': return searchRegistry();
        case 'reg-open': {
          const it = S.reg.items.find(i => i.id === b.dataset.id);
          S.form = S.form?.id === it.id ? null : { kind: 'reg', id: it.id, name: shortName(it.id), agents: installed(), vals: {} };
          return rerender();
        }
        case 'reg-choice': S.form.choice = b.dataset.k; S.form.vals = {}; return rerender();
        case 'reg-save': {
          const f = S.form;
          const it = S.reg.items.find(i => i.id === f.id);
          if (!f.agents?.length) return H.toast(t('Выберите хотя бы одного агента'), true);
          const cur = f.choice || (it.remotes.length ? 'r0' : 'p0');
          const isRemote = cur.startsWith('r');
          const need = isRemote ? it.remotes[+cur.slice(1)].headers : it.packages[+cur.slice(1)].env;
          const missing = need.filter(v => v.required && !String(f.vals?.[v.name] || '').trim());
          if (missing.length) return H.toast(t('Заполните: {f}', { f: missing.map(v => v.name).join(', ') }), true);
          const vals = Object.fromEntries(Object.entries(f.vals || {}).filter(([, v]) => String(v).trim()));
          return act('rsave', async () => {
            const spec = await H.api.ext.registrySpec({ item: it, choice: isRemote ? { remote: +cur.slice(1), headers: vals } : { kind: 'package', package: +cur.slice(1), env: vals } });
            if (addResults(await H.api.ext.mcpAdd({ name: f.name, spec, agents: f.agents }))) S.form = null;
            S.mcp = await H.api.ext.mcpList();
          });
        }
      }
    });
  }
  function focusEnd(sel) { const i = root?.querySelector(sel); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }

  // Открыть страницу сразу на нужной вкладке (из меню «+»); newSkill — сразу форма нового скилла
  function preset(tab, { newSkill } = {}) {
    S.tab = tab; S.form = null; S.sure = null;
    S.edit = newSkill ? { name: '', description: '', body: '', roots: ['claude', 'agents'] } : null;
  }
  window.Extensions = { init(helpers) { H = helpers; }, render, preset, reset() { S.mcp = S.plugins = S.skills = null; } };
})();
