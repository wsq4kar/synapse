// Быстрая проверка перед коммитом: синтаксис всех скриптов и корректность package.json.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['src', 'build', 'scripts'];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(c?js)$/.test(e.name)) files.push(p);
  }
};
roots.filter(fs.existsSync).forEach(walk);

let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`✗ ${f}\n${String(e.stderr || e.message).trim()}\n`); }
}
JSON.parse(fs.readFileSync('package.json', 'utf8'));
const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const nsi = fs.readFileSync('build/installer.nsi', 'utf8').match(/!define VERSION "([^"]+)"/)?.[1];
if (nsi && nsi !== v) { bad++; console.error(`✗ версия в build/installer.nsi (${nsi}) не совпадает с package.json (${v})`); }

console.log(bad ? `Ошибок: ${bad}` : `OK — проверено файлов: ${files.length}, версия ${v}`);
process.exit(bad ? 1 : 0);
