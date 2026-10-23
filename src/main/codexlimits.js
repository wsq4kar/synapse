// Лимиты подписки Codex (ChatGPT): спрашиваем служебный режим `codex app-server` по JSON-RPC.
// Ничего не тратит — это не запрос к модели, а чтение состояния аккаунта.
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

// Разные версии Codex называют поля по-разному — разбираем оба стиля
function win(w, fallbackId) {
  if (!w || typeof w !== 'object') return null;
  const pct = w.usedPercent ?? w.used_percent;
  const mins = w.windowDurationMins ?? w.window_minutes ?? w.windowMinutes;
  const resetsAt = w.resetsAt ?? w.resets_at;
  const resetsIn = w.resetsInSeconds ?? w.resets_in_seconds;
  const id = mins ? (mins <= 300 ? 'five_hour' : mins >= 10000 ? 'seven_day' : `${mins}m`) : fallbackId;
  return {
    id,
    used: typeof pct === 'number' ? pct / 100 : null,
    resetsAt: resetsAt ? (resetsAt > 1e12 ? resetsAt : resetsAt * 1000) : (resetsIn ? Date.now() + resetsIn * 1000 : null),
  };
}
function parse(result) {
  const rl = result?.rateLimits || result?.rate_limits || result;
  if (!rl) return null;
  const windows = [win(rl.primary, 'primary'), win(rl.secondary, 'secondary')].filter(Boolean);
  return windows.length ? { windows, plan: result?.planType || rl.planType || null } : null;
}

function read({ bin, env, timeout = 15000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      const cmd = IS_WIN && /\s/.test(bin) ? `"${bin}"` : bin;
      child = spawn(cmd, ['app-server'], { shell: IS_WIN, windowsHide: true, env: { ...process.env, ...(env || {}) } });
    } catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '', done = false, stderr = '';
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeout);
    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* */ } };
    const methods = ['account/rateLimits/read', 'getAccountRateLimits'];
    let mi = 0;
    child.on('error', (e) => finish({ ok: false, error: e.code === 'ENOENT' ? 'codex not found' : e.message }));
    child.on('exit', () => finish({ ok: false, error: stderr.trim().split('\n').pop() || 'codex app-server exited' }));
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.stdin.on('error', () => {}); // app-server мог уже закрыться
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.id === 0) {
          // рукопожатие принято — спрашиваем лимиты
          send({ method: 'initialized' });
          send({ id: 1, method: methods[mi] });
        } else if (j.id === 1) {
          if (j.error && mi + 1 < methods.length) { mi++; send({ id: 1, method: methods[mi] }); continue; }
          if (j.error) return finish({ ok: false, error: j.error.message || 'error' });
          const p = parse(j.result);
          return finish(p ? { ok: true, ...p } : { ok: false, error: 'no rate limits in response' });
        } else if (/rateLimits/i.test(j.method || '')) {
          // некоторые версии присылают лимиты уведомлением
          const p = parse(j.params);
          if (p) return finish({ ok: true, ...p });
        }
      }
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'synapse', title: 'Synapse', version: '1' } } });
  });
}

module.exports = { read, parse };
