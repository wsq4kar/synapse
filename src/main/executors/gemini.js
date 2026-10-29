const { t } = require('../i18n');
// Gemini API (Google AI Studio): текст, классификация, изображения (Nano Banana), видео (Veo).
const fs = require('fs');
const path = require('path');

const tunnel = require('../tunnel');
const netproxy = require('../netproxy');
const { trimHistory } = require('../tokens');
// Запросы идут через отдельную сессию Chromium: системный прокси (VPN) или SSH-туннель до вашего сервера
async function http(url, init) {
  try {
    return await netproxy.fetch(url, init);
  } catch (e) {
    if (e.name === 'AbortError' || init?.signal?.aborted) throw new GeminiError(t('Остановлено'), 0, 'aborted');
    if (e.code === 'tunnel' || e.code === 'proxy') throw new GeminiError(e.message, 0, e.code === 'proxy' ? 'proxy' : 'network');
    throw new GeminiError(t('Нет связи с Google API ({m}). Включите «Gemini через мой SSH-сервер» в настройках (Gemini API) или VPN.', { m: e.message }), 0, 'network');
  }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_RE = /^[\w.\-]+$/;

class GeminiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code || null; }
}

function checkModel(m) {
  if (!MODEL_RE.test(m || '')) throw new GeminiError(t('Некорректное имя модели: {m}', { m }));
  return m;
}

async function call(key, url, body, signal, method = 'POST') {
  if (!key) throw new GeminiError(t('Не задан ключ Google AI Studio. Добавьте его в настройках.'), 401, 'no_key');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await http(url, {
        method,
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      // нет связи — пробуем через ваш SSH-сервер
      if (attempt === 0 && e.code === 'network' && await tunnel.rescue()) continue;
      throw e;
    }
    if (!res.ok) {
      const err = await toError(res);
      // «регион не поддерживается» — то же самое
      if (attempt === 0 && err.code === 'region' && await tunnel.rescue()) continue;
      throw err;
    }
    return res;
  }
}

async function toError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    msg = j?.error?.message || msg;
  } catch { /* ignore */ }
  const hints = {
    400: t('Запрос отклонён'),
    401: t('Ключ не подошёл'),
    403: t('Нет доступа (ключ, регион или модель недоступна на вашем тарифе)'),
    404: t('Модель не найдена — выберите другую в настройках'),
    429: t('Достигнут лимит запросов. Подождите или смените модель'),
    500: t('Ошибка на стороне Google'), 503: t('Сервис Google перегружен, попробуйте позже'),
  };
  if (/location is not supported|not available in your (country|region)/i.test(msg)) return new GeminiError(t('Gemini API недоступен в вашем регионе. Включите «Gemini через мой SSH-сервер» в настройках (Gemini API) или VPN.'), res.status, 'region');
  return new GeminiError(`${hints[res.status] || t('Ошибка Gemini')}: ${msg}`, res.status, res.status === 401 || res.status === 403 ? 'no_key' : null);
}

// История чата → contents для Gemini (с бюджетом: старые сообщения короче, длинный код свёрнут)
function toContents(history, userText, images = []) {
  const contents = [];
  for (const m of trimHistory(history)) {
    contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] });
  }
  const parts = images.map(img => ({ inlineData: { mimeType: img.mime, data: img.data } }));
  parts.push({ text: userText });
  contents.push({ role: 'user', parts });
  return contents;
}

const SYSTEM = 'Ты — Synapse, локальный ИИ-ассистент. Отвечай на языке пользователя, по делу, с Markdown, где он помогает.';

// Потоковый ответ (SSE)
// Effort → настройки размышлений Gemini (у 3.x — уровень, у 2.5 — бюджет токенов)
function thinkingFor(model, effort) {
  if (!effort) return null;
  if (/gemini-[3-9]/.test(model)) return { thinkingLevel: { low: 'low', medium: 'medium' }[effort] || 'high' };
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: { low: 1024, medium: 8192, high: 16384 }[effort] || 24576 };
  return null;
}

async function chatStream({ key, model, history, text, images, signal, onDelta, onThought, effort, memory, search }) {
  const url = `${BASE}/models/${checkModel(model)}:streamGenerateContent?alt=sse`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM + (memory ? `\n\nО пользователе (его собственные заметки, учитывай в ответах):\n${memory}` : '') + (search ? '\n\nРежим «Исследование»: найди актуальную информацию через поиск Google, сравни источники и опирайся на них.' : '') }] },
    contents: toContents(history, text, images),
    // «Исследование»: поиск Google внутри модели; источники приходят в groundingMetadata
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  const sources = new Map();
  // includeThoughts — модель присылает краткий пересказ своих рассуждений
  const thinking = /gemini-(2\.5|[3-9])/.test(model) && !/image|tts|live/.test(model) ? { ...(thinkingFor(model, effort) || {}), includeThoughts: true } : thinkingFor(model, effort);
  let res;
  try {
    res = await call(key, url, thinking ? { ...body, generationConfig: { thinkingConfig: thinking } } : body, signal);
  } catch (e) {
    // модель не поддерживает такой уровень — повторяем без него
    if (!thinking || e.status !== 400) throw e;
    res = await call(key, url, body, signal);
  }

  const decoder = new TextDecoder();
  let buf = '', full = '', usage = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const j = JSON.parse(line.slice(5));
        const parts = j.candidates?.[0]?.content?.parts || [];
        const th = parts.filter(p => p.thought).map(p => p.text || '').join('');
        if (th) onThought?.(th);
        const txt = parts.filter(p => !p.thought).map(p => p.text || '').join('');
        if (txt) { full += txt; onDelta(txt); }
        if (j.usageMetadata) usage = j.usageMetadata;
        for (const c of j.candidates?.[0]?.groundingMetadata?.groundingChunks || []) if (c.web?.uri) sources.set(c.web.uri, c.web.title || c.web.uri);
        const block = j.promptFeedback?.blockReason;
        if (block) throw new GeminiError(t('Запрос заблокирован фильтром: {b}', { b: block }));
      } catch (e) { if (e instanceof GeminiError) throw e; }
    }
  }
  if (sources.size) {
    const tail = `\n\n**${t('Источники')}**\n${[...sources].slice(0, 12).map(([u, ti]) => `- [${ti.replace(/[\[\]]/g, '')}](${u})`).join('\n')}`;
    full += tail; onDelta(tail);
  }
  return { text: full, usage };
}

// Классификация для роутера: вернёт chat|code|image|video.
// Для выбора маршрута хватает начала запроса и одного слова в ответе — рассуждения выключаем.
async function classify({ key, model, text, prompt, context, signal }) {
  const url = `${BASE}/models/${checkModel(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: `Контекст: ${JSON.stringify(context)}\nЗапрос: ${text.slice(0, 600)}` }] }],
    generationConfig: {
      responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 200,
      responseSchema: { type: 'OBJECT', properties: { route: { type: 'STRING', enum: ['chat', 'code', 'image', 'video'] } }, required: ['route'] },
    },
  };
  const thinking = /gemini-2\.5/.test(model) ? { thinkingBudget: 0 } : /gemini-[3-9]/.test(model) ? { thinkingLevel: 'minimal' } : null;
  let res;
  try {
    res = await call(key, url, thinking ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: thinking } } : body, signal);
  } catch (e) {
    if (!thinking || e.status !== 400) throw e;
    res = await call(key, url, body, signal); // модель не умеет выключать рассуждения
  }
  const j = await res.json();
  const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const r = JSON.parse(raw).route;
  return ['chat', 'code', 'image', 'video'].includes(r) ? r : null;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Генерация / правка изображения
async function image({ key, model, text, images, outDir, signal }) {
  const url = `${BASE}/models/${checkModel(model)}:generateContent`;
  const parts = images.map(img => ({ inlineData: { mimeType: img.mime, data: img.data } }));
  parts.push({ text });
  const res = await call(key, url, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }, signal);
  const j = await res.json();
  const out = { text: '', files: [], usage: j.usageMetadata };
  for (const p of j.candidates?.[0]?.content?.parts || []) {
    if (p.text) out.text += p.text;
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType || inline.mime_type || 'image/png';
      const file = path.join(outDir, `img-${Date.now()}-${out.files.length}.${EXT[mime] || 'png'}`);
      fs.writeFileSync(file, Buffer.from(inline.data, 'base64'));
      out.files.push({ path: file, type: 'image' });
    }
  }
  if (!out.files.length) {
    const reason = j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason;
    throw new GeminiError(out.text || `${t('Модель не вернула изображение')}${reason ? ` (${reason})` : ''}`);
  }
  return out;
}

// Видео через Veo: долгая операция с опросом
async function video({ key, model, text, images, aspect, outDir, signal, onProgress }) {
  const url = `${BASE}/models/${checkModel(model)}:predictLongRunning`;
  const instance = { prompt: text };
  if (images[0]) instance.image = { bytesBase64Encoded: images[0].data, mimeType: images[0].mime };
  const res = await call(key, url, { instances: [instance], parameters: { aspectRatio: aspect || '16:9' } }, signal);
  let op = await res.json();
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > 12 * 60 * 1000) throw new GeminiError(t('Генерация видео идёт дольше 12 минут — остановлено'));
    onProgress?.(Math.round((Date.now() - started) / 1000));
    await sleep(8000, signal);
    const r = await call(key, `${BASE}/${op.name}`, null, signal, 'GET');
    op = await r.json();
  }
  if (op.error) throw new GeminiError(op.error.message || t('Veo вернул ошибку'));
  const samples = op.response?.generateVideoResponse?.generatedSamples || op.response?.generatedVideos || [];
  const uri = samples[0]?.video?.uri;
  if (!uri) {
    const filtered = op.response?.generateVideoResponse?.raiMediaFilteredReasons;
    throw new GeminiError(filtered ? t('Видео отфильтровано: {r}', { r: filtered.join('; ') }) : t('Veo не вернул видео'));
  }
  const dl = await http(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow', signal });
  if (!dl.ok) throw await toError(dl);
  const file = path.join(outDir, `video-${Date.now()}.mp4`);
  fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
  return { files: [{ path: file, type: 'video' }], seconds: Math.round((Date.now() - started) / 1000) };
}

async function listModels(key) {
  const out = [];
  let pageToken = '';
  do {
    const res = await call(key, `${BASE}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, null, undefined, 'GET');
    const j = await res.json();
    for (const m of j.models || []) {
      out.push({
        id: m.name.replace(/^models\//, ''),
        label: m.displayName || m.name,
        methods: m.supportedGenerationMethods || [],
        inputTokenLimit: m.inputTokenLimit || null,
      });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new GeminiError(t('Остановлено'), 0, 'aborted')); }, { once: true });
  });
}

// Голосовой ввод: распознать речь (WAV) в текст
const TRANSCRIBE = 'Transcribe this audio verbatim in the language it is spoken. Output only the transcribed text, with punctuation, without quotes or comments. If there is no speech, output nothing.';
async function transcribe({ key, model, data, mime = 'audio/wav', signal }) {
  const url = `${BASE}/models/${checkModel(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data } }, { text: TRANSCRIBE }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
  };
  const thinking = /gemini-2\.5/.test(model) ? { thinkingBudget: 0 } : /gemini-[3-9]/.test(model) ? { thinkingLevel: 'minimal' } : null;
  let res;
  try { res = await call(key, url, thinking ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: thinking } } : body, signal); }
  catch (e) { if (!thinking || e.status !== 400) throw e; res = await call(key, url, body, signal); }
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
}

module.exports = { chatStream, classify, image, video, listModels, transcribe, GeminiError };
