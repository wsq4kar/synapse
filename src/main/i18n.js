// Язык основного процесса: настройка → выбор в установщике (lang.ini) → язык системы.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function installerLang() {
  try {
    const txt = fs.readFileSync(path.join(path.dirname(process.execPath), 'lang.ini'), 'utf8');
    const m = txt.match(/lang\s*=\s*(ru|en)/i);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}
function lang() {
  const s = require('./store').getSettings();
  if (s.lang === 'ru' || s.lang === 'en') return s.lang;
  return installerLang() || (String(app.getLocale()).toLowerCase().startsWith('ru') ? 'ru' : 'en');
}

const EN = {
  'работает через node.exe — отдельно не заблокировать, но получает прокси': 'runs in node.exe — cannot be blocked separately, but gets the proxy',
  'установлен через npm и работает в node.exe — отдельно не заблокировать, но получает прокси': 'installed via npm and runs in node.exe — cannot be blocked separately, but gets the proxy',
  'Запрос прав администратора отклонён': 'Administrator prompt was declined', 'Не удалось применить правила': 'Could not apply the rules', 'Только для Windows': 'Windows only', 'только через прокси': 'proxy only',
  'HTTP-прокси {p} не отвечает — запрос не отправлен (строгий режим). Запустите прокси-клиент или смените режим в «Настройки → Сеть».': 'HTTP proxy {p} is not responding — request not sent (strict mode). Start your proxy client or change the mode in Settings → Network.',
  'Некорректный адрес прокси: {p}': 'Invalid proxy address: {p}', 'Прокси {p}': 'Proxy {p}', 'нет связи': 'no connection',
  'Нет связи с сервером модели — проверьте прокси или VPN ({e})': 'Cannot reach the model server — check your proxy or VPN ({e})', 'Предупреждение': 'Warning',
  'Контекст о пользователе (из Synapse):': 'Context about the user (from Synapse):', 'Обо мне': 'About me',
  'Повтор запроса к Anthropic': 'Retrying request to Anthropic', 'попытка {n}': 'attempt {n}', 'ждём {s} с': 'waiting {s}s',
  'Gemini API недоступен в вашем регионе. Включите «Gemini через мой SSH-сервер» в настройках (Gemini API) или VPN.': 'Gemini API is not available in your region. Turn on “Gemini through my SSH server” in Settings (Gemini API) or use a VPN.',
  'Нет связи с Google API ({m}). Включите «Gemini через мой SSH-сервер» в настройках (Gemini API) или VPN.': 'Cannot reach Google API ({m}). Turn on “Gemini through my SSH server” in Settings (Gemini API) or use a VPN.',
  'Совместимость': 'Compatibility', '{f} не поддерживается этой версией — запускаю без него': '{f} is not supported by this version — running without it',
  'Арена': 'Arena',
  'Папка слишком большая для Арены (больше {n} файлов). Выберите папку проекта поменьше.': 'The folder is too large for the Arena (over {n} files). Pick a smaller project folder.',
  'файл большой: было {a} строк, стало {b}': 'large file: {a} lines before, {b} after',
  '… ещё изменения не показаны': '… more changes not shown',
  '(файл удалён)': '(file deleted)',
  '(двоичный файл)': '(binary file)',
  'и ещё {n} файлов': 'and {n} more files',
  '(изменений нет)': '(no changes)',
  'Для Арены нужен хотя бы один установленный агент: Claude Code, Codex или Antigravity.': 'The Arena needs at least one installed agent: Claude Code, Codex or Antigravity.',
  '{m} недоступна — пробую {n}': '{m} is unavailable — trying {n}',
  'модель по умолчанию': 'default model',
  'ошибка': 'error',
  'В Арене не осталось участников — все агенты завершились с ошибкой.': 'No Arena participants left — every agent failed.',
  'Вариант без изменений в файлах': 'Variant made no file changes',
  'Укажите адрес сервера': 'Enter the server address', 'Некорректный адрес сервера': 'Invalid server address', 'Некорректное имя пользователя': 'Invalid user name', 'Некорректный порт': 'Invalid port',
  'Не найден SSH-ключ — укажите файл ключа': 'No SSH key found — choose a key file', 'Файл ключа не найден: {p}': 'Key file not found: {p}', 'Некорректный путь к ключу': 'Invalid key path',
  'Не найден ssh. В Windows: Параметры → Приложения → Дополнительные компоненты → «Клиент OpenSSH».': 'ssh not found. On Windows: Settings → Apps → Optional features → “OpenSSH Client”.',
  'ssh завершился с кодом {c}': 'ssh exited with code {c}', 'Соединение с сервером потеряно': 'Connection to the server was lost', 'Сервер не ответил за 20 секунд': 'The server did not respond in 20 seconds',
  'Сервер не принял ключ (Permission denied). Проверьте имя пользователя и что публичный ключ добавлен в ~/.ssh/authorized_keys на сервере.': 'The server rejected the key (Permission denied). Check the user name and that the public key is in ~/.ssh/authorized_keys on the server.',
  'Ключ сервера изменился. Если вы пересоздавали сервер — удалите файл known_hosts в папке данных Synapse.': 'The server key changed. If you rebuilt the server, delete the known_hosts file in the Synapse data folder.',
  'Не удаётся подключиться к {h}:{p}: {e}': 'Cannot connect to {h}:{p}: {e}',
  'У файла ключа слишком открытые права. Положите его в папку .ssh в вашем профиле.': 'The key file permissions are too open. Put it in the .ssh folder of your profile.',
  'Ключ защищён паролем или повреждён. Используйте ключ без пароля либо запустите ssh-agent.': 'The key is passphrase-protected or damaged. Use a key without a passphrase or run ssh-agent.',
  'SSH-сервер недоступен: {m}': 'SSH server unavailable: {m}', 'Файл SSH-ключа': 'SSH key file',
  'нет ключа Gemini — отвечает агент': 'no Gemini key — agent answers', 'агент': 'agent', 'Gemini недоступен': 'Gemini unavailable',
  'Где находится {name}?': 'Where is {name}?', 'Программы': 'Programs', 'Недопустимые символы в пути': 'Invalid characters in path',
  'Нет связи с Google API ({m}). Из России Gemini API недоступен — включите VPN.': 'Cannot reach Google API ({m}). Gemini API is unavailable from some regions — turn on a VPN.',
  'Gemini API недоступен в вашем регионе — включите VPN.': 'Gemini API is not available in your region — turn on a VPN.',
  'Папка проекта': 'Project folder',
  'Изображение': 'Image', 'Видео': 'Video',
  'Не найден ни один CLI-агент. Установите Claude Code, Codex, Antigravity или OpenCode и войдите в аккаунт, затем нажмите «Проверить» в настройках.':
    'No CLI agent found. Install Claude Code, Codex, Antigravity or OpenCode, sign in, then press “Check again” in settings.',
  'Приложенные изображения:': 'Attached images:',
  'Остановлено': 'Stopped',
  'не установлен': 'not installed', 'лимит подписки': 'subscription limit', 'ошибка': 'error',
  'Агенты не смогли выполнить задачу': 'The agents could not complete the task',
  'Пользователь': 'User', 'Ассистент': 'Assistant',
  'Контекст предыдущего разговора:': 'Previous conversation:', 'Новая задача:': 'New task:',
  'выбрано вручную': 'chosen manually', 'по ключевым словам': 'by keywords', 'правка приложенного изображения': 'editing the attached image',
  'решил Gemini': 'decided by Gemini', 'продолжение задачи': 'continuing the task', 'к чату привязана папка': 'folder linked to chat', 'обычный вопрос': 'regular question',
  'Неизвестный исполнитель {id}': 'Unknown executor {id}', 'Небезопасный путь к {name}': 'Unsafe path to {name}',
  'Процесс завершился с кодом {code}': 'Process exited with code {code}',
  'Команда': 'Command', 'Изменение файлов': 'File changes', 'Инструмент': 'Tool', 'Поиск': 'Search', 'Размышление': 'Reasoning', 'Ошибка Codex': 'Codex error', 'Ошибка OpenCode': 'OpenCode error',
  'Некорректное имя модели: {m}': 'Invalid model name: {m}',
  'Не задан ключ Google AI Studio. Добавьте его в настройках.': 'No Google AI Studio key set. Add it in settings.',
  'Запрос отклонён': 'Request rejected', 'Ключ не подошёл': 'Key rejected',
  'Нет доступа (ключ, регион или модель недоступна на вашем тарифе)': 'No access (key, region, or the model is not on your plan)',
  'Модель не найдена — выберите другую в настройках': 'Model not found — choose another in settings',
  'Достигнут лимит запросов. Подождите или смените модель': 'Rate limit reached. Wait or switch the model',
  'Ошибка на стороне Google': 'Google-side error', 'Сервис Google перегружен, попробуйте позже': 'Google service is overloaded, try later',
  'Ошибка Gemini': 'Gemini error', 'Запрос заблокирован фильтром: {b}': 'Request blocked by filter: {b}',
  'Модель не вернула изображение': 'The model returned no image',
  'Генерация видео идёт дольше 12 минут — остановлено': 'Video generation took over 12 minutes — stopped',
  'Veo вернул ошибку': 'Veo returned an error', 'Видео отфильтровано: {r}': 'Video filtered: {r}', 'Veo не вернул видео': 'Veo returned no video',
  // OpenRouter, Antigravity, сессии
  'Не задан ключ OpenRouter. Добавьте его в настройках.': 'No OpenRouter key set. Add it in settings.',
  'Нет связи с OpenRouter ({m}). Проверьте прокси или VPN в настройках «Сеть».': 'Cannot reach OpenRouter ({m}). Check the proxy or VPN in Settings → Network.',
  'На счёте OpenRouter закончились кредиты': 'Your OpenRouter credits have run out', 'Запрос заблокирован модерацией': 'Request blocked by moderation',
  'Модель не ответила вовремя': 'The model timed out', 'Провайдер модели недоступен, попробуйте другую модель': 'The model provider is unavailable, try another model',
  'Нет доступного провайдера для этой модели': 'No provider is available for this model', 'Ошибка OpenRouter': 'OpenRouter error',
  'OpenRouter недоступен': 'OpenRouter is unavailable',
  'Новая сессия': 'New session', 'Прошлую сессию продолжить не удалось — начинаю заново с кратким контекстом': 'Could not resume the previous session — starting over with a short context',
  'Antigravity: {s}': 'Antigravity: {s}', 'решил маршрутизатор': 'decided by the router',
};

function t(s, vars) {
  let out = lang() === 'en' && EN[s] ? EN[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return out;
}

module.exports = { t, lang };
