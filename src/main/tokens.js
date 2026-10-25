// Экономия токенов: сколько истории и в каком виде отдавать моделям.
// Идея: свежие сообщения — целиком, старые — короче, а длинные блоки кода из прошлых ответов
// сворачиваются (код уже лежит в файлах, агенту незачем читать его второй раз из истории).

const FENCE = /```[^\n]*\n[\s\S]*?```/g;

// Свернуть блоки кода длиннее limit символов
function foldCode(text, limit = 400, note = '[код опущен]') {
  return String(text || '').replace(FENCE, (block) => {
    if (block.length <= limit) return block;
    const lang = (/^```([^\n]*)/.exec(block) || [])[1] || '';
    const lines = block.split('\n').length - 2;
    return `\`\`\`${lang}\n${note} (${lines} строк)\n\`\`\``;
  });
}

// Обрезать по символам: начало и хвост (в хвосте обычно вывод и итог)
function clip(text, n) {
  const s = String(text || '').trim();
  if (s.length <= n) return s;
  const head = Math.round(n * 0.7);
  return `${s.slice(0, head)}\n…\n${s.slice(-(n - head))}`;
}

/**
 * История для чат-моделей (Gemini API, OpenRouter): не больше maxMsgs сообщений и budget символов.
 * Последние keepFull сообщений идут почти целиком, остальные сокращаются.
 */
function trimHistory(history = [], { maxMsgs = 24, budget = 48000, keepFull = 4, fullCap = 12000, oldCap = 2500 } = {}) {
  const src = history.filter(m => (m.text || '').trim()).slice(-maxMsgs);
  const out = [];
  let used = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const fresh = src.length - i <= keepFull;
    let text = String(src[i].text).trim();
    if (!fresh) text = clip(foldCode(text), oldCap);
    else text = clip(text, fullCap);
    if (used + text.length > budget && out.length) break;
    used += text.length;
    out.unshift({ role: src[i].role, text });
  }
  return out;
}

/**
 * Контекст разговора для CLI-агента без сохранённой сессии: только суть.
 * Код из ответов агента свёрнут — изменения и так в файлах проекта.
 */
function agentHistory(history = [], { maxMsgs = 6, budget = 6000, userCap = 1500, assistantCap = 900 } = {}) {
  const src = history.filter(m => (m.text || '').trim()).slice(-maxMsgs);
  const out = [];
  let used = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const m = src[i];
    const text = m.role === 'user' ? clip(m.text, userCap) : clip(foldCode(m.text, 200, '[код в файлах проекта]'), assistantCap);
    if (used + text.length > budget && out.length) break;
    used += text.length;
    out.unshift({ role: m.role, text });
  }
  return out;
}

module.exports = { trimHistory, agentHistory, foldCode, clip };
