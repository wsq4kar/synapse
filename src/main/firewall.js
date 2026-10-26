// Жёсткий запрет (Windows): правила брандмауэра не дают Synapse, Claude Code и Codex выходить в интернет напрямую.
// Разрешены только локальные адреса (127.0.0.0/8, ::1) и сам прокси — значит, весь трафик идёт через него.
// Нужны права администратора: Windows покажет запрос UAC.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { t } = require('./i18n');

const GROUP = 'Synapse AI';
const IS_WIN = process.platform === 'win32';

const ip2n = (ip) => ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
const n2ip = (n) => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');

// Все IPv4, кроме исключённых диапазонов
function ipv4Except(excl) {
  const ex = excl.map(([a, b]) => [ip2n(a), ip2n(b)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = 0;
  for (const [a, b] of ex) {
    if (a > cur) out.push(`${n2ip(cur)}-${n2ip(a - 1)}`);
    cur = Math.max(cur, b + 1);
  }
  if (cur <= 0xFFFFFFFF) out.push(`${n2ip(cur)}-255.255.255.255`);
  return out;
}

// Что можно заблокировать отдельно: настоящий .exe. Программы на node.exe — нельзя (заблокировался бы весь Node).
function findFile(dir, name, depth = 6) {
  if (depth < 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name) return path.join(dir, e.name);
  for (const e of entries) if (e.isDirectory()) { const r = findFile(path.join(dir, e.name), name, depth - 1); if (r) return r; }
  return null;
}
function targets(agents) {
  const list = [{ id: 'synapse', label: 'Synapse', exe: process.execPath, ok: true }];
  for (const a of agents || []) {
    const p = a.path || a.bin;
    if (!a.installed || !p) { list.push({ id: a.id, label: a.label, ok: false, why: t('не установлен') }); continue; }
    if (/\.exe$/i.test(p) && fs.existsSync(p)) { list.push({ id: a.id, label: a.label, exe: p, ok: true }); continue; }
    // npm-обёртка codex.cmd → настоящий codex.exe лежит внутри пакета
    if (a.id === 'codex' && /\.cmd$/i.test(p)) {
      const exe = findFile(path.join(path.dirname(p), 'node_modules', '@openai'), 'codex.exe');
      if (exe) { list.push({ id: a.id, label: a.label, exe, ok: true }); continue; }
    }
    // npm-обёртка opencode.cmd → настоящий opencode.exe в пакете opencode-windows-*
    if (a.id === 'opencode' && /\.cmd$/i.test(p)) {
      const exe = findFile(path.join(path.dirname(p), 'node_modules', 'opencode-ai'), 'opencode.exe') || findFile(path.join(path.dirname(p), 'node_modules'), 'opencode.exe', 3);
      if (exe) { list.push({ id: a.id, label: a.label, exe, ok: true }); continue; }
    }
    list.push({ id: a.id, label: a.label, ok: false, why: t('установлен через npm и работает в node.exe — отдельно не заблокировать, но получает прокси') });
  }
  return list;
}

function psQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// Запуск скрипта PowerShell с правами администратора (UAC) и ожиданием
function runElevated(script) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-fw-'));
    const ps1 = path.join(dir, 'rules.ps1');
    const log = path.join(dir, 'result.txt');
    fs.writeFileSync(ps1, '﻿' + `$ErrorActionPreference = 'Stop'\ntry {\n${script}\n'OK' | Out-File -Encoding utf8 ${psQuote(log)}\n} catch { $_.Exception.Message | Out-File -Encoding utf8 ${psQuote(log)} }\n`, 'utf8');
    const cmd = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${psQuote(`-NoProfile -ExecutionPolicy Bypass -File "${ps1}"`)}`;
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, (err) => {
      let res = '';
      try { res = fs.readFileSync(log, 'utf8').replace(/^﻿/, '').trim(); } catch { /* UAC отклонён */ }
      fs.rm(dir, { recursive: true, force: true }, () => {});
      if (res === 'OK') resolve({ ok: true });
      else resolve({ ok: false, error: res || (err ? t('Запрос прав администратора отклонён') : t('Не удалось применить правила')) });
    });
  });
}

async function apply(agents, proxyHost) {
  if (!IS_WIN) return { ok: false, error: t('Только для Windows') };
  const excl = [['127.0.0.0', '127.255.255.255']];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(proxyHost || '') && !proxyHost.startsWith('127.')) excl.push([proxyHost, proxyHost]);
  const remote = [...ipv4Except(excl), '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'];
  const list = targets(agents).filter(x => x.ok);
  const lines = [`Remove-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue`];
  for (const x of list) {
    lines.push(`New-NetFirewallRule -DisplayName ${psQuote(`Synapse: ${x.label} — ${t('только через прокси')}`)} -Group ${psQuote(GROUP)} -Direction Outbound -Action Block -Profile Any -Program ${psQuote(x.exe)} -RemoteAddress @(${remote.map(psQuote).join(',')}) | Out-Null`);
  }
  const r = await runElevated(lines.join('\n'));
  return { ...r, rules: list.map(x => x.label) };
}

async function remove() {
  if (!IS_WIN) return { ok: false, error: t('Только для Windows') };
  return runElevated(`Remove-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue`);
}

// Какие правила сейчас стоят (чтение не требует прав администратора)
function status(agents) {
  return new Promise((resolve) => {
    const base = { supported: IS_WIN, targets: targets(agents).map(({ id, label, exe, ok, why }) => ({ id, label, exe, ok, why })) };
    if (!IS_WIN) return resolve({ ...base, rules: [] });
    const cmd = `Get-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DisplayName | ConvertTo-Json -Compress`;
    execFile('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`], { windowsHide: true, timeout: 15000 }, (err, out) => {
      let rules = [];
      try { const j = JSON.parse(String(out || '').trim() || '[]'); rules = Array.isArray(j) ? j : [j]; } catch { /* нет правил */ }
      resolve({ ...base, rules });
    });
  });
}

module.exports = { apply, remove, status, ipv4Except };
