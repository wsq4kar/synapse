// Локализация: ключ — русская строка, значение — английская.
(() => {
  const EN = {
    // общее
    'Авто': 'Auto', 'Чат': 'Chat', 'Код': 'Code', 'Изображение': 'Image', 'Видео': 'Video', 'Изображения': 'Images',
    'сам выберет': 'picks for you', 'агент в папке': 'agent in folder',
    'с': 's', 'мин': 'm',
    'Готово': 'Done', 'Ошибка': 'Error', 'Сохранено': 'Saved', 'Скопировано': 'Copied', 'Удалено': 'Deleted',
    'Сохранить': 'Save', 'Создать': 'Create', 'Выбрать': 'Choose', 'Удалить': 'Delete', 'Убрать': 'Remove',
    'Копировать': 'Copy', 'Повторить': 'Retry', 'Ещё': 'More', 'Настройки': 'Settings', 'Папка': 'Folder',
    'Без названия': 'Untitled', 'Ничего не найдено': 'Nothing found',

    // сайдбар и шапка
    'Новый чат': 'New chat', 'Новая сессия': 'New session', 'Проекты': 'Projects', 'Медиа': 'Media',
    'Закреплённые': 'Pinned', 'Недавние': 'Recents', 'Сессии кода': 'Code sessions', 'Поиск': 'Search',
    'Здесь будут ваши чаты': 'Your chats will appear here', 'Здесь будут сессии кода': 'Code sessions will appear here',
    'Выполняется': 'Running', 'Не удалось открыть чат': 'Could not open chat',
    'Скрыть панель (Ctrl+B)': 'Hide sidebar (Ctrl+B)', 'Показать панель': 'Show sidebar',
    'Назад (Alt+←)': 'Back (Alt+←)', 'Вперёд (Alt+→)': 'Forward (Alt+→)',
    'Чаты (Ctrl+1)': 'Chats (Ctrl+1)', 'Код (Ctrl+2)': 'Code (Ctrl+2)',
    'Исполнители и настройки': 'Executors and settings', 'Питомцы': 'Pets', 'Настройки (Ctrl ,)': 'Settings (Ctrl ,)',
    'Прогресс': 'Progress', 'Прогресс (Ctrl+.)': 'Progress (Ctrl+.)',
    'готов': 'ready', 'нет': 'off',

    // пустой экран и композер
    'Доброй ночи': 'Good night', 'Доброе утро': 'Good morning', 'Добрый день': 'Good afternoon', 'Добрый вечер': 'Good evening',
    'Опишите задачу — Synapse сам выберет исполнителя': 'Describe a task — Synapse picks who does it',
    'Новая сессия кода ·': 'New code session ·', 'выберите окружение снизу': 'choose an environment below',
    'Опишите задачу для агента': 'Describe a task for the agent', 'Опишите задачу или задайте вопрос': 'Describe a task or ask a question',
    'Ответить…': 'Reply…', 'Добавить': 'Add',
    'Добавьте ключ Google AI Studio для чата, изображений и видео': 'Add a Google AI Studio key for chat, images and video',
    'Synapse может ошибаться — проверяйте результат': 'Synapse can make mistakes — check the result',
    'Ultra — максимум усилий (Ctrl+U)': 'Ultra — maximum effort (Ctrl+U)',
    'Отправить (Enter)': 'Send (Enter)', 'Остановить (Esc)': 'Stop (Esc)',
    'В очередь (Enter) · сразу — Ctrl+Enter': 'Queue (Enter) · now — Ctrl+Enter',
    'Новая папка': 'New folder', 'Рабочая папка для агента': 'Agent working folder',
    'Полный доступ': 'Full access', 'Правки файлов': 'File edits', 'Агент': 'Agent',
    'Агент для задач с кодом': 'Agent for coding tasks',
    'Агент работает в отдельной папке внутри Synapse': 'The agent works in its own folder inside Synapse',
    'Отпустите, чтобы прикрепить': 'Drop to attach',
    ': можно прикреплять только изображения': ': only images can be attached', ': больше 20 МБ': ': larger than 20 MB',
    'Не больше 6 изображений': 'Up to 6 images', 'Опиши изображение': 'Describe this image',

    // меню
    'Прикрепить изображение': 'Attach image', 'Выбрать папку…': 'Choose folder…', 'Сменить папку…': 'Change folder…', 'Отвязать папку': 'Unlink folder',
    'Окружение': 'Environment', 'Новая папка в Synapse': 'New folder in Synapse',
    'Права агента': 'Agent permissions', 'безопасно': 'safe', 'любые команды': 'any command',
    'Кому отдать задачу': 'Who handles the task', 'Агент для кода': 'Coding agent', 'по порядку': 'in order',
    'не установлен': 'not installed', 'Настроить агентов…': 'Configure agents…',
    'Полный доступ: агент сможет выполнять любые команды': 'Full access: the agent can run any command',
    'Переименовать': 'Rename', 'Закрепить': 'Pin', 'Открепить': 'Unpin', 'В проект…': 'Move to project…',
    'Открыть папку': 'Open folder', 'У чата нет рабочей папки': 'This chat has no working folder',
    'Переместить в проект': 'Move to project', 'Без проекта': 'No project', 'Новый проект…': 'New project…',
    'Перемещено в «': 'Moved to «', 'Убрано из проекта': 'Removed from project',

    // сообщения
    'В очереди': 'Queued', 'Отправить сейчас': 'Send now',
    'Выбираю исполнителя': 'Choosing an executor', 'Veo собирает видео': 'Veo is rendering the video',
    'Рисую изображение': 'Drawing the image', 'работает': 'is working', 'Думаю': 'Thinking',
    'создано': 'created', 'изменено': 'edited', 'прочитано': 'read', ' и ещё ': ' and ',
    'файл': 'file', 'файла': 'files', 'файлов': 'files', 'команда': 'command', 'команды': 'commands', 'команд': 'commands',
    'шаг': 'step', 'шага': 'steps', 'шагов': 'steps', 'Шаг': 'Step',
    '→ передаю': '→ handing over to', 'Обычно 1–4 минуты': 'Usually 1–4 minutes', 'Несколько секунд': 'A few seconds',
    'Сохранить как…': 'Save as…', 'Показать в папке': 'Show in folder', 'код': 'code',
    'Пустой ответ модели': 'The model returned an empty answer',

    // прогресс
    'Здесь появится план агента, исполнители и изменённые файлы.': 'The agent’s plan, executors and changed files will appear here.',
    'Выбор исполнителя': 'Choosing executor', 'Исполнитель': 'Executor', 'выполняет': 'is running', 'Результат': 'Result',
    'План': 'Plan', 'В этой сессии': 'In this session', 'Вложения': 'Attachments', 'Изменённые файлы': 'Changed files',

    // страницы
    'Новый проект': 'New project', 'без папки': 'no folder', ' · закреплён': ' · pinned',
    'чат': 'chat', 'чата': 'chats', 'чатов': 'chats', 'Название проекта': 'Project name', 'Введите название': 'Enter a name',
    'Сессия кода': 'Code session', 'Привязать папку проекта': 'Link project folder',
    'В проекте пока нет чатов. Новые чаты будут работать в папке проекта.': 'No chats in this project yet. New chats will work in the project folder.',
    'Удалить проект': 'Delete project', 'Проект удалён, чаты сохранены': 'Project deleted, chats kept',
    'Здесь появятся изображения и видео, которые вы создадите.': 'Images and videos you create will appear here.',

    // настройки
    'Агенты': 'Agents', 'Внешний вид': 'Appearance', 'Журнал': 'Log', 'О программе': 'About',
    'Ключ Google AI Studio — для чата, изображений и видео. Хранится только на этом компьютере в зашифрованном виде.': 'Google AI Studio key for chat, images and video. Stored only on this computer, encrypted.',
    'Ключ API': 'API key', 'Ключ сохранён — введите новый, чтобы заменить': 'Key saved — enter a new one to replace it',
    'aistudio.google.com → Get API key. После сохранения модели подберутся автоматически.': 'aistudio.google.com → Get API key. Models are picked automatically after saving.',
    'Удалить ключ': 'Remove key', 'Проверить ключ': 'Test key', 'Список моделей': 'Model list',
    'Обычные ответы': 'Regular answers', 'Чат · Ultra': 'Chat · Ultra', 'Старшая модель для режима Ultra': 'Top model for Ultra mode',
    'Маршрутизатор': 'Router', 'Решает, кому отдать задачу': 'Decides who handles a task', 'Nano Banana и др.': 'Nano Banana etc.',
    'Veo, быстрая модель': 'Veo, fast model', 'Видео · Ultra': 'Video · Ultra', 'Veo, максимальное качество': 'Veo, best quality',
    'Формат видео': 'Video format', 'Агенты для кода': 'Coding agents',
    'Synapse запускает официальные CLI на этом компьютере под вашим входом. Если первый не справился или упёрся в лимит — задача переходит к следующему.': 'Synapse runs the official CLIs on this computer under your own sign-in. If the first one fails or hits a limit, the task moves to the next.',
    'Порядок': 'Order', 'Не найден — установите или укажите путь': 'Not found — install it or set the path',
    'Команда или полный путь': 'Command or full path', 'Проверить снова': 'Check again',
    'Умный выбор исполнителя': 'Smart routing', 'Если по словам задача неясна, Synapse коротко спрашивает Gemini': 'If keywords are not enough, Synapse asks Gemini briefly',
    'Папка для новых сессий': 'Folder for new sessions', 'Если окружение не выбрано, агент работает в отдельной подпапке здесь.': 'Without an environment, the agent works in its own subfolder here.',
    'Тема и фон.': 'Theme and background.', 'Тема': 'Theme', 'Системная': 'System', 'Светлая': 'Light', 'Тёмная': 'Dark',
    'Тема, шрифт, цвета и поведение.': 'Theme, font, colors and behavior.', 'Шрифт': 'Font', 'Системный': 'System', 'Скруглённый': 'Rounded',
    'С засечками': 'Serif', 'Моноширинный': 'Monospace', 'Для чтения': 'Readable', 'Размер текста': 'Text size', 'Цвет акцента': 'Accent color',
    'Ширина переписки': 'Conversation width', 'Узкая': 'Narrow', 'Обычная': 'Normal', 'Широкая': 'Wide', 'Анимации': 'Animations',
    'Как в системе': 'Follow system', 'Минимум': 'Minimal', 'Отправка сообщения': 'Send message with', 'Пузыри у моих сообщений': 'Bubbles around my messages',
    'Если выключить, ваши сообщения будут простым текстом': 'When off, your messages are shown as plain text', 'Предпросмотр': 'Preview',
    'так будет выглядеть текст в переписке. Код, ответы и рассуждения используют этот шрифт и размер.': 'this is how text looks in conversations. Replies, code and reasoning use this font and size.',
    'Акцент': 'Accent',
    'Скрыть список файлов': 'Hide file list', 'Показать список файлов': 'Show file list', 'Развернуть превью': 'Expand preview', 'Свернуть (Esc)': 'Collapse (Esc)',
    'Копирую папку': 'Copying folder',
    'Бриф': 'Brief',
    'Планы': 'Plans',
    'Спор': 'Debate',
    'Голосование': 'Vote',
    'Доработка': 'Polish',
    'Итог': 'Result',
    'новый': 'new',
    'изменён': 'changed',
    'удалён': 'deleted',
    'Изменений в файлах нет': 'No file changes',
    'ждёт': 'waiting',
    'готово': 'done',
    'Победитель': 'Winner',
    'Согласен': 'Agrees',
    'Есть возражения': 'Has objections',
    'файлов изменено': 'files changed',
    'Арена': 'Arena',
    'модель': 'model',
    'модели': 'models',
    'моделей': 'models',
    'до {n} кругов спора': 'up to {n} debate rounds',
    'Диспетчер': 'Dispatcher',
    'пишет бриф': 'writing the brief',
    'бриф готов': 'brief ready',
    'Согласие достигнуто в круге {n}': 'Consensus reached in round {n}',
    'Бриф от диспетчера': 'Brief from the dispatcher',
    'Планы и спор': 'Plans and debate',
    'кругов': 'rounds',
    'план': 'plan',
    'Круг': 'Round',
    'Первый план': 'First plan',
    'согласен': 'agrees',
    'возражает': 'objects',
    'Кто оценивает': 'Voter',
    'Средняя': 'Average',
    'Лучший вариант': 'Best variant',
    'После запуска Арены эти файлы изменились в папке': 'These files changed in the folder after the Arena started',
    'Всё равно применить': 'Apply anyway',
    'Применено в папку': 'Applied to the folder',
    'Применить': 'Apply',
    'Папка варианта': 'Variant folder',
    'Вариант': 'Variant',
    'Применить этот вариант': 'Apply this variant',
    'Скрыть': 'Hide',
    'Файлы в папке изменились после запуска — проверьте и подтвердите': 'Files in the folder changed after the run started — review and confirm',
    'Применено: {n} файлов': 'Applied: {n} files',
    'Арена: большие модели планируют, спорят, пишут свои варианты и голосуют за лучший. Тратит намного больше лимитов.': 'Arena: large models plan, debate, write their own variants and vote for the best. Uses far more of your limits.',
    'Арена: большие модели планируют, спорят, пишут свои варианты и голосуют за лучший': 'Arena: large models plan, debate, write their own variants and vote for the best',
    'Арена: {who}': 'Arena: {who}',
    'Арена включена': 'Arena on',
    'Арена выключена': 'Arena off',
    'Состав': 'Line-up',
    'Вручную': 'Manual',
    'Участники': 'Participants',
    'Нет установленных агентов': 'No agents installed',
    'Сколько больших моделей': 'How many large models',
    'Большие модели': 'Large models',
    'Диспетчер (пишет бриф)': 'Dispatcher (writes the brief)',
    'Кругов спора (максимум)': 'Debate rounds (maximum)',
    'Спор заканчивается раньше, если все модели согласны. Каждый круг расходует лимиты всех участников.': 'The debate ends early once every model agrees. Each round uses the limits of all participants.',
    'Маленькая модель пишет бриф, большие предлагают планы, спорят до согласия, каждая пишет свой вариант кода в отдельной копии папки и голосует за лучший. Итог применяется кнопкой. Включается кнопкой «Арена» во вкладке «Код».': 'A small model writes the brief; large models propose plans, debate until they agree, each writes its own variant in a separate copy of the folder, and they vote for the best. You apply the result with a button. Turn it on with the Arena button in the Code tab.',
    'Язык': 'Language', 'Тема, язык и фон.': 'Theme, language and background.',
    'Живой ASCII-фон': 'Live ASCII background', 'Анимированное поле символов на пустом экране; в переписке приглушается': 'Animated character field on the empty screen; dimmed in conversations',
    'Бегают по полю ввода, засыпают, когда вы отошли, и радуются готовым задачам. Клик — подпрыгнут, можно перетаскивать мышью.': 'They run along the input, fall asleep when you step away and celebrate finished tasks. Click to make them hop, drag them with the mouse.',
    'Показывать питомцев': 'Show pets', 'Кто живёт в приложении': 'Who lives in the app',
    'Пельмешек из теста, радуется готовым задачам': 'A little dough dumpling that loves finished tasks',
    'Маленький робот с мигающей антенной': 'A tiny robot with a blinking antenna',
    'Слизень с листиком, прыгает вместо ходьбы': 'A slime with a leaf that hops instead of walking',
    'Последние задачи. Хранится локально.': 'Recent tasks. Stored locally.', 'медиа': 'media', 'ошибок': 'errors',
    'Время': 'Time', 'Тип': 'Type', 'Длительность': 'Duration', 'Итог': 'Result', 'ошибка': 'error', 'готово': 'done', 'Пока пусто.': 'Nothing yet.',
    'Локальный ИИ-агент, который сам решает, кому отдать задачу.': 'A local AI agent that decides who handles each task.',
    'Код и файлы — Claude Code, Codex, Gemini CLI или OpenCode на этом компьютере, под вашим входом. Чат, изображения и видео — Gemini API по вашему ключу.': 'Code and files — Claude Code, Codex, Gemini CLI or OpenCode on this computer, under your sign-in. Chat, images and video — Gemini API with your key.',
    'Рассчитано на личное использование на одном компьютере: подписки предназначены только для их владельца.': 'Made for personal use on one computer: subscriptions are for their owner only.',
    'Клавиши: Ctrl+N — новый, Ctrl+1/2 — чат/код, Ctrl+K — поиск, Ctrl+U — Ultra, Ctrl+. — прогресс, Ctrl+B — панель, Alt+←/→ — назад/вперёд, Ctrl+Enter — отправить сразу.': 'Keys: Ctrl+N — new, Ctrl+1/2 — chat/code, Ctrl+K — search, Ctrl+U — Ultra, Ctrl+. — progress, Ctrl+B — sidebar, Alt+←/→ — back/forward, Ctrl+Enter — send now.',
    'Папка с сессиями': 'Sessions folder', 'Вставьте ключ': 'Paste a key', 'Ключ сохранён': 'Key saved',
    'Ключ работает · моделей:': 'Key works · models:', 'Загружено моделей:': 'Models loaded:',
    'Некорректное имя модели': 'Invalid model name', 'Недопустимые символы в пути': 'Invalid characters in path',
    'Агенты проверены': 'Agents checked', 'Питомцы ушли спать': 'Pets went to sleep', 'Питомцы вернулись': 'Pets are back',

    // метки из основного процесса (для сохранённых чатов)
    'выбрано вручную': 'chosen manually', 'по ключевым словам': 'by keywords', 'правка приложенного изображения': 'editing the attached image',
    'решил Gemini': 'decided by Gemini', 'продолжение задачи': 'continuing the task', 'к чату привязана папка': 'folder linked to chat', 'обычный вопрос': 'regular question',
    'лимит подписки': 'subscription limit', 'Команда': 'Command', 'Изменение файлов': 'File changes', 'Инструмент': 'Tool', 'Размышление': 'Reasoning',
    'В режиме «Правки файлов» агенту нельзя запускать команды.': 'In “File edits” mode the agent cannot run commands.',
    'Разрешить и повторить': 'Allow and retry',
    'Effort — сколько думать': 'Effort — how hard to think', 'Effort — сколько думать (Ctrl+E)': 'Effort — how hard to think (Ctrl+E)',
    'Низкий': 'Low', 'Средний': 'Medium', 'Высокий': 'High', 'Очень высокий': 'Extra high', 'Максимум': 'Max',
    'как настроено в агенте': 'agent’s own setting', 'быстро и экономно': 'fast and cheap', 'баланс': 'balanced',
    'думает тщательнее': 'thinks harder', 'сложные задачи': 'hard problems', 'без ограничений, дольше': 'no limits, slower',
    'Claude Code и Codex — напрямую, Gemini — бюджет размышлений. Ultra = Максимум.': 'Claude Code and Codex natively, Gemini as thinking budget. Ultra = Max.',
    'вход выполнен': 'signed in', 'нужен вход': 'sign-in needed', 'Войти': 'Sign in', 'Войдите в открывшемся терминале, затем нажмите «Проверить снова»': 'Sign in in the terminal that opened, then press “Check again”',
    // рабочее место
    'Файлы': 'Files', 'Терминал': 'Terminal', 'Обновить': 'Refresh', 'Открыть в проводнике': 'Show in Explorer', 'Скрыть (Ctrl+J)': 'Hide (Ctrl+J)',
    'Остановить (Ctrl+C)': 'Stop (Ctrl+C)', 'Очистить (Ctrl+L)': 'Clear (Ctrl+L)', 'Перезапустить': 'Restart', 'Введите команду': 'Type a command',
    'Потяните, чтобы изменить ширину': 'Drag to resize', 'Папка пуста — агент положит файлы сюда': 'Folder is empty — the agent will put files here',
    'Выберите файл, чтобы посмотреть его': 'Select a file to preview it', 'показано начало': 'showing the beginning', 'Просмотр': 'Preview',
    'Перезагрузить': 'Reload', 'Открыть в программе по умолчанию': 'Open in default app', 'Двоичный файл — откройте его в программе': 'Binary file — open it in an app',
    'Терминал открыт в папке чата. Команды выполняются в {shell}.': 'Terminal is open in the chat folder. Commands run in {shell}.',
    'Файлы и терминал (Ctrl+J)': 'Files and terminal (Ctrl+J)',
    // токены, контекст, лимиты
    'Время выполнения': 'Duration', 'с': 's', 'мин': 'min', 'ч': 'h', 'д': 'd', 'Вход': 'Input', 'Выход': 'Output', 'из кэша': 'from cache',
    'запись в кэш': 'cache write', 'размышления': 'reasoning', 'Шагов модели': 'Model turns', 'По ценам API': 'At API prices',
    'по подписке не списывается': 'not charged on a subscription', 'Контекст': 'Context', 'из': 'of', 'Контекст и лимиты': 'Context and limits',
    '5 часов': '5 hours', 'Неделя': 'Week', 'Неделя · Opus': 'Week · Opus', 'Неделя · Sonnet': 'Week · Sonnet', 'Основной': 'Primary', 'Недельный': 'Weekly',
    'уже сброшен': 'already reset', 'сброс': 'resets', 'через': 'in', 'лимит исчерпан': 'limit reached', 'близко к лимиту': 'near the limit',
    'обновлено': 'updated', 'Контекстное окно': 'Context window', 'автосжатие при': 'auto-compact at', 'Появится после первого ответа': 'Appears after the first reply',
    'Токены за чат': 'Tokens in this chat', 'Ответов': 'Replies', 'Лимиты подписки': 'Subscription limits',
    'Claude Code сообщает их после первого запроса.': 'Claude Code reports them after the first request.',
    // SSH-туннель
    'выключено': 'off', 'подключаюсь…': 'connecting…', 'подключено': 'connected', 'ошибка': 'error',
    'Gemini через мой SSH-сервер': 'Gemini through my SSH server',
    'Запросы к Google выходят в интернет с вашего сервера, а не с этого ПК. Ключ API на сервер не передаётся.': 'Requests to Google leave from your server, not this PC. The API key is never sent to the server.',
    'Сервер': 'Server', 'Порт': 'Port', 'Пользователь': 'User', 'Файл SSH-ключа': 'SSH key file', 'Авто — ищу в папке .ssh': 'Auto — looking in the .ssh folder',
    'Проверить': 'Test', 'Туннель работает, запросы идут через': 'Tunnel is up, requests go through',
    'Публичный ключ должен быть в ~/.ssh/authorized_keys на сервере. Нужен ключ без пароля и «Клиент OpenSSH» в Windows (есть по умолчанию в 10/11).': 'The public key must be in ~/.ssh/authorized_keys on the server. Use a key without a passphrase and the “OpenSSH Client” on Windows (included in 10/11).',
    'Подключаюсь к серверу…': 'Connecting to the server…', 'Настроить SSH': 'Set up SSH', 'Gemini теперь идёт через ваш SSH-сервер': 'Gemini now goes through your SSH server', 'Работает: сервер': 'Working: server', 'мс': 'ms', 'Google отвечает': 'Google responds', 'Не удалось': 'Failed',
    // сеть и память
    'Сеть': 'Network', 'Память': 'Memory', 'Как нейросети выходят в интернет: Gemini, Claude Code, Codex, Gemini CLI и OpenCode.': 'How the AIs reach the internet: Gemini, Claude Code, Codex, Gemini CLI and OpenCode.',
    'Как в Windows': 'Like Windows', 'HTTP-прокси': 'HTTP proxy', 'SSH-сервер': 'SSH server',
    'Без настроек: Gemini берёт системный прокси Windows, агенты ходят напрямую. Если Google не пускает из вашего региона и SSH-сервер настроен — Synapse сам переключится на него.': 'No setup: Gemini uses the Windows system proxy, agents connect directly. If Google blocks your region and an SSH server is configured, Synapse switches to it.',
    'Адрес HTTP-прокси': 'HTTP proxy address', 'Например, HTTP-порт v2rayN, Nekoray или Clash. Его получают все нейросети и их команды (npm, git, curl).': 'E.g. the HTTP port of v2rayN, Nekoray or Clash. All AIs and their commands (npm, git, curl) use it.',
    'Строгий режим': 'Strict mode', 'Если прокси не отвечает, запросы не уходят вовсе — никакого обхода напрямую.': 'If the proxy is down, nothing is sent — no direct fallback.',
    'Проверить связь': 'Test connection', 'Жёсткий запрет прямого выхода': 'Hard block of direct access', 'Загрузка…': 'Loading…', 'Проверяю…': 'Checking…', 'не отвечает': 'no response',
    'Укажите адрес в виде 127.0.0.1:10801': 'Enter an address like 127.0.0.1:10801', 'Сохранено': 'Saved',
    'Доступно в Windows: правила брандмауэра запрещают Synapse, Claude Code и Codex выходить в интернет мимо прокси.': 'Windows only: firewall rules stop Synapse, Claude Code and Codex from bypassing the proxy.',
    'Правила брандмауэра Windows разрешат этим программам только локальные адреса — то есть только ваш прокси. Нужны права администратора.': 'Windows Firewall rules will allow these programs only local addresses — i.e. only your proxy. Requires administrator rights.',
    'Обновить правила': 'Update rules', 'Запретить прямой выход': 'Block direct access', 'Снять запрет': 'Remove block', 'включён: правил {n}': 'on: {n} rules',
    'Windows попросит подтвердить права администратора': 'Windows will ask for administrator rights', 'Готово: напрямую эти программы больше не выйдут': 'Done: these programs can no longer connect directly', 'Запрет снят': 'Block removed',
    'Память и контекст': 'Memory and context', 'Чтобы нейросети знали вас: что передать им о себе, и что подключено в Claude Code.': 'So the AIs know you: what to tell them about yourself, and what Claude Code has connected.',
    'Передавать «Обо мне» нейросетям': 'Share “About me” with the AIs', 'Claude Code — в системный промпт, Gemini — в системную инструкцию, Codex и Gemini CLI — в начало задачи.': 'Claude Code — system prompt, Gemini — system instruction, Codex and Gemini CLI — start of the task.',
    'Обо мне': 'About me', 'Хранится только на этом компьютере. Можно скопировать сюда память из claude.ai (Настройки → Память).': 'Stored only on this computer. You can paste your claude.ai memory here (Settings → Memory).',
    'Например: меня зовут…, пишу по-русски, коротко и по делу. Делаю игры на Roblox и сервер RAGE MP. В интерфейсах — SVG-иконки вместо эмодзи…': 'E.g.: my name is…, I prefer short answers. I make Roblox games and a RAGE MP server. Use SVG icons instead of emoji in UIs…',
    'Скиллы и коннекторы без подтверждения': 'Skills and connectors without confirmation',
    'В режиме «Правки файлов» Claude Code сможет пользоваться скиллами, коннекторами claude.ai и MCP. Иначе их вызовы блокируются — подтвердить некому.': 'In “File edits” mode Claude Code can use skills, claude.ai connectors and MCP. Otherwise those calls are blocked — nobody can confirm them.',
    'Личная память CLAUDE.md': 'Personal CLAUDE.md memory', 'нет файла': 'no file', 'Создать': 'Create', 'Открыть': 'Open', 'Коннекторы и MCP': 'Connectors and MCP', 'подключено': 'connected',
    'Скиллы': 'Skills', 'Плагины': 'Plugins', 'нет': 'none', 'По данным последнего запуска': 'From the last run', 'Список скиллов и коннекторов появится после первой задачи Claude Code.': 'Skills and connectors appear after the first Claude Code task.',
    'Настроить сеть': 'Network settings', 'Запуск CLI': 'CLI startup', 'До первого ответа': 'Time to first reply', 'Работа модели': 'Model time', 'Повторов запроса': 'Request retries',
    // рассуждение, субагенты, превью
    'Думаю': 'Thinking', 'Рассуждение': 'Reasoning', '{s} с': '{s}s', 'Субагенты': 'Subagents', 'шагов': 'steps', 'Превью': 'Preview',
    'Команда': 'Team', 'Команда субагентов': 'Subagent team', 'Команда: Claude Code будет раздавать части задачи субагентам': 'Team: Claude Code will hand parts of the task to subagents',
    'Команда выключена': 'Team mode off', 'Готово': 'Done',
    'Новые входные': 'New input', 'из них запись в кэш': 'of which cache write', 'Повторно из кэша': 'Re-read from cache', 'почти не тратит лимиты': 'barely counts toward limits', 'Всего прошло через модель': 'Total processed by the model',
    'Обновить лимиты Codex': 'Refresh Codex limits', 'Загружаю…': 'Loading…', 'Не удалось получить лимиты': 'Could not get limits',
    'осталось': 'left',
    'Путь': 'Path', 'Модели': 'Models', 'Обзор…': 'Browse…', 'Выше': 'Up', 'Ниже': 'Down', 'не найден': 'not found',
    'Авто — ищу в стандартных местах': 'Auto — searching standard locations', 'Сбросить — искать автоматически': 'Reset — find automatically',
    'Найден автоматически': 'Found automatically', 'По этому пути CLI не отвечает': 'No CLI responds at this path',
    'Укажите файл {f} или папку с ним — или установите CLI и нажмите «Проверить снова».': 'Point to {f} or its folder — or install the CLI and press “Check again”.',
    'Модель': 'Model', 'Synapse выберет': 'Synapse decides', 'По умолчанию': 'Default', 'Gemini · чат': 'Gemini · chat',
    'Настроить модели…': 'Configure models…', 'модели через запятую': 'models, comma-separated', 'Модели для выбора, через запятую': 'Selectable models, comma-separated',
    // питомцы
    'Пельмешек': 'Dumpling', 'Искра': 'Spark', 'Мох': 'Moss',
    'леплю код…': 'shaping code…', 'кручу-верчу': 'spinning up', 'почти готово': 'almost there', 'готово!': 'done!', 'вкусно вышло': 'tasty result',
    'ой…': 'oops…', 'не слиплось': 'didn’t stick', 'мур': 'purr', 'хи-хи': 'hee-hee',
    'вычисляю…': 'computing…', 'бип-буп': 'beep-boop', 'компилирую': 'compiling', 'задача закрыта': 'task closed',
    'ошибка 0x01': 'error 0x01', 'перезагрузка…': 'rebooting…', 'бип!': 'beep!', 'заряжен': 'charged',
    'буль-буль…': 'blub-blub…', 'расту': 'growing', 'впитываю': 'absorbing', 'буль!': 'blub!', 'хлюп…': 'squish…', 'буль': 'blub', 'липко!': 'sticky!',
    'эй!': 'hey!', 'куда?': 'where to?', 'ой-ой': 'whoa', 'а?': 'huh?', 'проснулся': 'awake',
  };

  const I18N = {
    lang: (() => { try { return localStorage.getItem('synapse.lang') || 'ru'; } catch { return 'ru'; } })(),
    get locale() { return this.lang === 'en' ? 'en-US' : 'ru-RU'; },
    t(s, vars) {
      let out = s;
      if (this.lang === 'en' && typeof s === 'string') {
        const core = s.trim();
        if (s in EN) out = EN[s];
        else if (core in EN) out = s.replace(core, EN[core]);
      }
      if (vars && typeof out === 'string') out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
      return out;
    },
    set(lang) {
      this.lang = lang === 'en' ? 'en' : 'ru';
      document.documentElement.lang = this.lang;
      try { localStorage.setItem('synapse.lang', this.lang); } catch { /* ignore */ }
      this.applyStatic();
    },
    // Перевод статичной разметки index.html (оригинал запоминается)
    applyStatic(root = document.body) {
      const skip = '#thread, #viewPage, #settingsBody, #progressBody, #pinnedList, #recentList, #menu, #crumbs, #toasts, #petsLayer, #hl, #input, #sendBtn, #greeting, #heroSub, #metaHint, #envBtn, #modeBtn, #agentBtn, #navNew .lbl, #recentLabel';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        if (n.parentElement?.closest(skip)) continue;
        if (n.__ru === undefined) { if (!/[А-Яа-яЁё]/.test(n.nodeValue)) continue; n.__ru = n.nodeValue; }
        n.nodeValue = this.t(n.__ru);
      }
      root.querySelectorAll('[title], [placeholder], [aria-label]').forEach(el => {
        if (el.closest(skip)) return;
        for (const a of ['title', 'placeholder', 'aria-label']) {
          if (!el.hasAttribute(a)) continue;
          const key = 'ru' + a.replace(/-./g, m => m[1].toUpperCase()).replace(/^./, c => c.toUpperCase());
          if (el.dataset[key] === undefined) { if (!/[А-Яа-яЁё]/.test(el.getAttribute(a))) continue; el.dataset[key] = el.getAttribute(a); }
          el.setAttribute(a, this.t(el.dataset[key]));
        }
      });
    },
  };
  window.I18N = I18N;
})();
