// Куда ходят нейросети: «как в Windows», только через ваш HTTP-прокси, или через SSH-сервер.
// Строгий режим: если выбранный путь недоступен — запрос не уходит вообще (никакого обхода напрямую).
const net = require('net');
const http = require('http');
const { session } = require('electron');
const tunnel = require('./tunnel');
const { t } = require('./i18n');

const ses = () => session.fromPartition('synapse-gemini');
let cfg = { mode: 'system', http: '127.0.0.1:10801', strict: true };

// ---------- адрес прокси ----------
function parseHostPort(s) {
  const m = /^\s*(?:https?:\/\/)?(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.\-]+):(\d{1,5})\s*\/?\s*$/.exec(String(s || ''));
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return { host: m[1].replace(/^\[|\]$/g, ''), port };
}
function proxyUrl() {
  const hp = parseHostPort(cfg.http);
  return hp ? `http://${hp.host.includes(':') ? `[${hp.host}]` : hp.host}:${hp.port}` : null;
}

// Прокси отвечает? (проверка соединения, кэш 3 с)
let alive = { at: 0, ok: false };
function proxyAlive() {
  const hp = parseHostPort(cfg.http);
  if (!hp) return Promise.resolve(false);
  if (Date.now() - alive.at < 3000) return Promise.resolve(alive.ok);
  return new Promise((resolve) => {
    const s = net.connect({ host: hp.host, port: hp.port });
    let fin = false;
    const done = (ok) => { if (fin) return; fin = true; s.destroy(); alive = { at: Date.now(), ok }; resolve(ok); };
    s.on('error', () => done(false)); // on, не once: повторная ошибка не должна уронить приложение
    s.once('connect', () => done(true));
    s.setTimeout(1500, () => done(false));
  });
}
function proxyDown() {
  return Object.assign(new Error(t('HTTP-прокси {p} не отвечает — запрос не отправлен (строгий режим). Запустите прокси-клиент или смените режим в «Настройки → Сеть».', { p: cfg.http })), { code: 'proxy' });
}

// ---------- применение настроек ----------
async function configure(netCfg, tunnelCfg) {
  cfg = { mode: 'system', http: '127.0.0.1:10801', strict: true, ...(netCfg || {}) };
  alive.at = 0;
  // SSH-туннель живёт только в режиме ssh
  await tunnel.configure({ ...(tunnelCfg || {}), enabled: cfg.mode === 'ssh' });
  if (cfg.mode === 'http') {
    const url = proxyUrl();
    // без «direct» в правилах Chromium не пойдёт напрямую, если прокси упал
    const rules = url ? { proxyRules: url, proxyBypassRules: '' } : { mode: 'system' };
    await ses().setProxy(rules);
    await session.defaultSession.setProxy(rules); // и всё остальное приложение (значки сервисов и т.п.)
  } else {
    if (cfg.mode === 'system') await ses().setProxy({ mode: 'system' });
    await session.defaultSession.setProxy({ mode: 'system' });
  }
  await ses().closeAllConnections().catch(() => {});
  return status();
}

// ---------- Gemini и прочие запросы приложения ----------
async function fetch(url, init) {
  if (cfg.mode === 'ssh') return tunnel.fetch(url, init);
  if (cfg.mode === 'http' && cfg.strict !== false && !(await proxyAlive())) throw proxyDown();
  return ses().fetch(url, init);
}

// ---------- окружение для CLI-агентов ----------
// Claude Code, Codex, Gemini CLI и их подпроцессы (npm, git, curl) понимают HTTPS_PROXY / HTTP_PROXY
function envFor(url) {
  const no = 'localhost,127.0.0.1,::1';
  return { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url, ALL_PROXY: url, all_proxy: url, NO_PROXY: no, no_proxy: no };
}
async function agentEnv() {
  if (cfg.mode === 'http') {
    const url = proxyUrl();
    if (!url) throw Object.assign(new Error(t('Некорректный адрес прокси: {p}', { p: cfg.http })), { code: 'proxy' });
    if (cfg.strict !== false && !(await proxyAlive())) throw proxyDown();
    return envFor(url);
  }
  if (cfg.mode === 'ssh') {
    try { await tunnel.ensureUp(); } catch (e) { throw Object.assign(new Error(t('SSH-сервер недоступен: {m}', { m: e.message })), { code: 'proxy' }); }
    return envFor(await bridgeUrl());
  }
  return null;
}

// ---------- мост HTTP CONNECT → SOCKS5 (ssh -D) для режима SSH ----------
// CLI понимают только HTTP-прокси, а ssh даёт SOCKS5 — переводим одно в другое локально.
let bridge = null;
function socksConnect(host, port) {
  return new Promise((resolve, reject) => {
    const sp = tunnel.socksPort();
    if (!sp) return reject(new Error('tunnel down'));
    const s = net.connect(sp, '127.0.0.1');
    let buf = Buffer.alloc(0), stage = 0;
    const fail = (e) => { s.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    s.once('error', fail);
    s.setTimeout(20000, () => fail('socks timeout'));
    s.once('connect', () => s.write(Buffer.from([5, 1, 0])));
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf[1] !== 0) return fail('socks auth');
        buf = buf.subarray(2); stage = 1;
        const p = Buffer.from([port >> 8, port & 255]);
        const req = net.isIPv4(host)
          ? Buffer.concat([Buffer.from([5, 1, 0, 1]), Buffer.from(host.split('.').map(Number)), p])
          : Buffer.concat([Buffer.from([5, 1, 0, 3, Buffer.byteLength(host)]), Buffer.from(host), p]);
        s.write(req);
      }
      if (stage === 1) {
        if (buf.length < 5) return;
        if (buf[1] !== 0) return fail(`socks connect ${buf[1]}`);
        const need = buf[3] === 1 ? 10 : buf[3] === 4 ? 22 : 7 + buf[4];
        if (buf.length < need) return;
        s.removeListener('data', onData);
        s.removeListener('error', fail);
        s.on('error', () => {}); // до того как мост навесит свой обработчик
        s.setTimeout(0);
        resolve({ socket: s, rest: buf.subarray(need) });
      }
    };
    s.on('data', onData);
  });
}
function bridgeUrl() {
  if (bridge) return Promise.resolve(`http://127.0.0.1:${bridge.address().port}`);
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => { res.writeHead(501); res.end('only CONNECT'); });
    srv.on('connect', async (req, client, head) => {
      client.on('error', () => {}); // CLI может оборвать соединение раньше, чем откроется туннель
      const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
      if (!m) return client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      try {
        const { socket, rest } = await socksConnect(m[1], Number(m[2]));
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) client.write(rest);
        if (head?.length) socket.write(head);
        socket.pipe(client); client.pipe(socket);
        socket.on('error', () => client.destroy());
        client.on('error', () => socket.destroy());
      } catch {
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
    });
    srv.once('error', reject);
    srv.on('clientError', (_e, sock) => { try { sock.destroy(); } catch { /* */ } });
    srv.listen(0, '127.0.0.1', () => { bridge = srv; srv.on('error', () => {}); resolve(`http://127.0.0.1:${srv.address().port}`); });
  });
}

// ---------- проверка ----------
async function test() {
  const out = { mode: cfg.mode, checks: [] };
  if (cfg.mode === 'http') {
    const ok = await (alive.at = 0, proxyAlive());
    out.checks.push({ name: t('Прокси {p}', { p: cfg.http }), ok });
    if (!ok) return out;
  }
  for (const [name, url] of [['Google (Gemini)', 'https://generativelanguage.googleapis.com/'], ['Anthropic (Claude)', 'https://api.anthropic.com/'], ['OpenAI (Codex)', 'https://api.openai.com/']]) {
    const t0 = Date.now();
    try {
      await fetch(url, { signal: AbortSignal.timeout(12000) });
      out.checks.push({ name, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      out.checks.push({ name, ok: false, error: String(e.message || e).slice(0, 160) });
    }
  }
  return out;
}

function status() { return { ...cfg, url: proxyUrl() }; }

module.exports = { configure, fetch, agentEnv, test, status, parseHostPort };
