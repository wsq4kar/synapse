const { t } = require('./i18n');
// Маршрутизатор: решает, куда отправить задачу — chat | code | image | video.
// Сначала быстрые правила по словам, при неясности — короткий запрос к Gemini (если есть ключ).

const RULES = {
  video: [
    /виде[оа]/i, /ролик/i, /анимир/i, /(^|[^а-яё])клип/i, /\bvideo\b/i, /\banimate\b/i, /\bveo\b/i,
    /сними(\s|$)/i, /оживи/i,
  ],
  image: [
    /нарисуй/i, /картинк/i, /изображени/i, /иллюстрац/i, /фото(?!шоп)/i, /логотип/i, /аватар/i,
    /обложк/i, /постер/i, /(^|\s)арт(\s|$)/i, /сгенерируй (?:мне )?(?:фото|картин|изображ|арт)/i,
    /\bdraw\b/i, /\bimage\b/i, /\bpicture\b/i, /\blogo\b/i, /\billustration\b/i, /nano ?banana/i,
    /перерисуй/i, /отредактируй (?:фото|картин|изображ)/i,
  ],
  code: [
    /(^|[^а-яё])код/i, /скрипт/i, /функци/i, /(^|[^а-яё])баг(?!аж)/i, /ошибк[ауие]? в/i, /репозитор/i, /проект/i, /файл/i,
    /компонент/i, /рефактор/i, /(^|[^а-яё])тест/i, /сайт/i, /приложени/i, /\bapi\b/i, /сервер/i, /верстк/i,
    /\bnpm\b/i, /\bgit\b/i, /\bpython\b/i, /\bjs\b|javascript|typescript|\bts\b/i, /\blua\b|luau/i,
    /\bhtml\b|\bcss\b/i, /```/, /\.(js|ts|py|lua|json|html|css|tsx|jsx|cs|cpp|go|rs)\b/i,
    /\bcode\b/i, /\bscript\b/i, /\bfix\b/i, /\bbug\b/i, /\brefactor\b/i, /напиши программ/i,
    /исправь/i, /запусти/i, /установи/i, /собери/i,
    /лендинг|landing/i, /(^|[^а-яё])страниц/i, /веб|\bweb\b/i, /(^|[^а-яё])игр[уыае]/i, /(^|[^а-яё])бот/i, /парсер|спарс/i,
    /расширени/i, /плагин/i, /сверстай|верстай/i, /интерфейс/i, /\bui\b/i, /макет/i, /калькулятор/i, /telegram|телеграм/i,
    /roblox|роблокс/i, /rage ?mp/i, /\bsql\b|баз[ауые] данных/i, /docker|nginx/i, /(^|[^а-яё])мод(?!ел)/i,
  ],
};

function heuristic(text) {
  const scores = { chat: 0, code: 0, image: 0, video: 0 };
  for (const [k, rules] of Object.entries(RULES)) {
    for (const r of rules) if (r.test(text)) scores[k] += 1;
  }
  // Видео сильнее картинки, если встречаются оба («сделай видео из картинки»)
  if (scores.video && scores.image) scores.video += 1;
  // Вопросы «что такое / объясни» без явных признаков — разговор
  if (/^(что|как|почему|зачем|объясни|расскажи|сравни|what|how|why|explain)\b/i.test(text.trim())) scores.chat += 0.5;
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { route: top[0][1] > 0 ? top[0][0] : 'chat', confidence: top[0][1] - (top[1]?.[1] || 0), scores };
}

/**
 * @param {object} p
 * @param {string} p.text
 * @param {string} p.mode   auto|chat|code|image|video
 * @param {boolean} p.hasFolder   к чату привязана папка проекта
 * @param {boolean} p.hasImages   приложены изображения
 * @param {string|null} p.lastRoute   маршрут прошлого сообщения в чате
 * @param {Function|null} p.askModel  async (text) => route | null
 */
async function route({ text, mode, hasFolder, hasImages, lastRoute, askModel }) {
  if (mode && mode !== 'auto') return { route: mode, reason: t('выбрано вручную') };

  const h = heuristic(text);
  if (h.confidence >= 1 && h.route !== 'chat') return { route: h.route, reason: t('по ключевым словам') };

  // Приложена картинка и просят что-то поменять — редактирование изображения
  if (hasImages && /(измени|поменяй|убери|добавь|сделай|перекрась|edit|change|remove|add)/i.test(text) && h.scores.code === 0) {
    return { route: 'image', reason: t('правка приложенного изображения') };
  }

  if (askModel) {
    try {
      const r = await askModel(text, { hasFolder, lastRoute });
      if (r) return { route: r, reason: t('решил маршрутизатор') };
    } catch { /* без сети или без ключа — идём дальше */ }
  }

  if (h.route !== 'chat') return { route: h.route, reason: t('по ключевым словам') };
  // Продолжение разговора о коде остаётся у агента
  if (lastRoute === 'code' && text.length < 400) return { route: 'code', reason: t('продолжение задачи') };
  if (hasFolder && h.scores.chat === 0) return { route: 'code', reason: t('к чату привязана папка') };
  return { route: 'chat', reason: t('обычный вопрос') };
}

const ROUTER_PROMPT = `Ты маршрутизатор задач. Определи, кто выполнит запрос пользователя:
- "code": написать/изменить/запустить код, сделать сайт, лендинг, страницу, игру, бота, приложение; работа с файлами и проектами;
- "image": создать или изменить изображение;
- "video": создать видео;
- "chat": ответить текстом, объяснить, посоветовать, перевести.
Ответь JSON вида {"route":"chat|code|image|video"}.`;

module.exports = { route, heuristic, ROUTER_PROMPT };
