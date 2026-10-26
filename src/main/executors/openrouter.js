const { t } = require('../i18n');
// OpenRouter (openrouter.ai): сотни моделей по одному ключу — чат, маршрутизация, изображения.
// API совместим с OpenAI Chat Completions; запросы идут через ту же сетевую сессию, что и Gemini.
const fs = require('fs');
const path = require('path');
const netproxy = require('../netproxy');
const { trimHistory } = require('../tokens');

const BASE = 'https://openrouter.ai/api/v1';
// vendor/model, иногда с ~ (псевдоним «последняя версия») и :free / :nitro в конце
const MODEL_RE = /^~?[\w.\-]+\/[\w.\-]+(:[\w-]+)?$/;

class OpenRouterError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code || null; }
}

function checkModel(m) {
  if (!MODEL_RE.test(m || '')) throw new OpenRouterError(t('Некорректное имя модели: {m}', { m }));
  return m;
}

async function call(key, pathname, body, signal, method = 'POST') {
  if (!key && method === 'POST') throw new OpenRouterError(t('Не задан ключ OpenRouter. Добавьте его в настройках.'), 401, 'no_key');
  let res;
  try {
    res = await netproxy.fetch(BASE + pathname, {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        'content-type': 'application/json',
        // так OpenRouter показывает приложение в своей статистике
        'http-referer': 'https://github.com/wsq4kar/synapse',
        'x-title': 'Synapse',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError' || signal?.aborted) throw new OpenRouterError(t('Остановлено'), 0, 'aborted');
    throw new OpenRouterError(t('Нет связи с OpenRouter ({m}). Проверьте прокси или VPN в настройках «Сеть».', { m: e.message }), 0, 'network');
  }
  if (!res.ok) throw await toError(res);
  return res;
}

async function toError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    msg = j?.error?.metadata?.raw || j?.error?.message || msg;
  } catch { /* ignore */ }
  const hints = {
    400: t('Запрос отклонён'),
    401: t('Ключ не подошёл'),
    402: t('На счёте OpenRouter закончились кредиты'),
    403: t('Запрос заблокирован модерацией'),
    404: t('Модель не найдена — выберите другую в настройках'),
    408: t('Модель не ответила вовремя'),
    429: t('Достигнут лимит запросов. Подождите или смените модель'),
    502: t('Провайдер модели недоступен, попробуйте другую модель'),
    503: t('Нет доступного провайдера для этой модели'),
  };
  return new OpenRouterError(`${hints[res.status] || t('Ошибка OpenRouter')}: ${String(msg).slice(0, 400)}`, res.status, res.status === 401 ? 'no_key' : null);
}

const SYSTEM = 'Ты — Synapse, локальный ИИ-ассистент. Отвечай на языке пользователя, по делу, с Markdown, где он помогает.';

// Модели Anthropic (и Gemini) кэшируют промпт только по явной отметке cache_control —
// ставим её на системный промпт и на конец истории: следующий ход перечитает всё это из кэша (в ~10 раз дешевле)
const wantsCacheMark = (model) => /^~?(anthropic|google)\//.test(model);
const cached = (text) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];

function toMessages(model, history, userText, images, memory) {
  const sys = SYSTEM + (memory ? `\n\nО пользователе (его собственные заметки, учитывай в ответах):\n${memory}` : '');
  const mark = wantsCacheMark(model);
  const msgs = [{ role: 'system', content: mark ? cached(sys) : sys }];
  const hist = trimHistory(history);
  hist.forEach((m, i) => {
    const last = i === hist.length - 1;
    msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: mark && last ? cached(m.text) : m.text });
  });
  const content = images.length
    ? [...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })), { type: 'text', text: userText }]
    : userText;
  msgs.push({ role: 'user', content });
  return msgs;
}

// Effort → reasoning OpenRouter (единый параметр для всех провайдеров)
function reasoningFor(effort) {
  const map = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };
  return effort && map[effort] ? { effort: map[effort] } : {};
}

async function chatStream({ key, model, history, text, images = [], signal, onDelta, onThought, effort, memory }) {
  const res = await call(key, '/chat/completions', {
    model: checkModel(model),
    messages: toMessages(model, history, text, images, memory),
    stream: true,
    reasoning: reasoningFor(effort),
    usage: { include: true },
  }, signal);

  const decoder = new TextDecoder();
  let buf = '', full = '', usage = null, served = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      // строки «: OPENROUTER PROCESSING» — служебные, пропускаем
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new OpenRouterError(`${t('Ошибка OpenRouter')}: ${j.error.message || JSON.stringify(j.error).slice(0, 300)}`, j.error.code || 0);
      if (j.model) served = j.model;
      const d = j.choices?.[0]?.delta || {};
      const th = d.reasoning || (d.reasoning_details || []).map(x => x.text || x.summary || '').join('');
      if (th) onThought?.(th);
      if (d.content) { full += d.content; onDelta(d.content); }
      if (j.usage) usage = j.usage;
    }
  }
  return { text: full, usage, model: served || model };
}

// Классификация для роутера: chat|code|image|video. Ответ — одно слово, рассуждения выключены.
async function classify({ key, model, text, prompt, context, signal }) {
  const body = {
    model: checkModel(model),
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Контекст: ${JSON.stringify(context)}\nЗапрос: ${String(text).slice(0, 600)}` },
    ],
    temperature: 0,
    max_tokens: 20,
  };
  let res;
  try {
    res = await call(key, '/chat/completions', { ...body, reasoning: { enabled: false, exclude: true }, response_format: { type: 'json_object' } }, signal);
  } catch (e) {
    if (e.status !== 400) throw e;
    res = await call(key, '/chat/completions', body, signal); // модель не поддерживает эти параметры
  }
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content || '';
  const m = /"route"\s*:\s*"(chat|code|image|video)"/.exec(raw) || /\b(chat|code|image|video)\b/.exec(raw);
  return m ? m[1] : null;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Генерация / правка изображения моделями с выходом image (Nano Banana, GPT Image и др.)
async function image({ key, model, text, images = [], outDir, signal }) {
  const content = [...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })), { type: 'text', text }];
  const res = await call(key, '/chat/completions', {
    model: checkModel(model),
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
  }, signal);
  const j = await res.json();
  const msg = j.choices?.[0]?.message || {};
  const out = { text: typeof msg.content === 'string' ? msg.content : '', files: [], usage: j.usage || null };
  for (const im of msg.images || []) {
    const url = im.image_url?.url || im.url || '';
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(url);
    if (!m) continue;
    const file = path.join(outDir, `img-${Date.now()}-${out.files.length}.${EXT[m[1]] || 'png'}`);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    out.files.push({ path: file, type: 'image' });
  }
  if (!out.files.length) throw new OpenRouterError(out.text || t('Модель не вернула изображение'));
  return out;
}

// Список моделей публичный, ключ не нужен. Кэшируем на 10 минут.
let modelsCache = null;
async function listModels(key) {
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache.list;
  const res = await call(key, '/models', null, undefined, 'GET');
  const j = await res.json();
  const list = (j.data || []).filter(m => MODEL_RE.test(m.id || '')).map(m => ({
    id: m.id,
    label: m.name || m.id,
    context: m.context_length || null,
    input: m.architecture?.input_modalities || [],
    output: m.architecture?.output_modalities || [],
    free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
    created: m.created || 0,
  }));
  modelsCache = { at: Date.now(), list };
  return list;
}

// Проверка ключа: остаток кредитов и лимит
async function keyInfo(key) {
  const res = await call(key, '/key', null, undefined, 'GET');
  const j = await res.json();
  return j.data || {};
}

// usage OpenRouter → общий формат Synapse
function toUsage(u, model) {
  if (!u) return null;
  const cacheRead = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    input: Math.max(0, (u.prompt_tokens || 0) - cacheRead), cacheRead, cacheWrite: u.prompt_tokens_details?.cache_write_tokens || 0,
    output: u.completion_tokens || 0, thinking: u.completion_tokens_details?.reasoning_tokens || 0,
    model, listCost: typeof u.cost === 'number' ? u.cost : null,
  };
}

module.exports = { chatStream, classify, image, listModels, keyInfo, toUsage, OpenRouterError, MODEL_RE };
