// Dictation only appends confirmed text; it never changes measurements or review status.
export function initDictation({ field, button, status, preview, scope = window }) {
  const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  let active = null, timer;
  const supported = Boolean(Recognition && scope.isSecureContext);
  const hint = supported ? 'Говорите короткими фразами. Проверьте текст перед сохранением. Для распознавания может потребоваться интернет.' : 'В этом браузере диктовка недоступна. Можно использовать микрофон на экранной клавиатуре или написать комментарий.';
  const idle = () => { button.textContent = 'Продиктовать комментарий'; button.setAttribute('aria-pressed', 'false'); preview.textContent = ''; preview.hidden = true; };
  const cancel = (message = hint) => {
    const old = active; active = null; clearTimeout(timer);
    try { old?.recognition.abort(); } catch { /* An ended recognition session needs no abort. */ }
    idle(); status.textContent = message;
  };
  button.disabled = !supported;
  status.textContent = supported
    ? 'Говорите короткими фразами. Проверьте текст перед сохранением. Для распознавания может потребоваться интернет.'
    : 'В этом браузере диктовка недоступна. Можно использовать микрофон на экранной клавиатуре или написать комментарий.';
  function start() {
    if (!scope.navigator.onLine) { status.textContent = 'Для этой диктовки требуется подключение к интернету. Комментарий можно написать вручную.'; return; }
    if (field.value.length >= field.maxLength && field.maxLength > 0) { status.textContent = 'Комментарий уже заполнен до предела. Сократите его перед диктовкой.'; return; }
    const recognition = new Recognition(), session = { recognition, processed: new Set(), received: false, stopping: false, truncated: false };
    recognition.lang = 'ru-RU'; recognition.interimResults = true; recognition.continuous = false; recognition.maxAlternatives = 1;
    active = session;
    recognition.onresult = (event) => {
      if (active !== session) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i], text = result[0]?.transcript?.trim() || '';
        if (!result.isFinal) { interim += `${text} `; continue; }
        if (session.processed.has(i) || !text) continue;
        session.processed.add(i); session.received = true;
        const prefix = field.value && !/\s$/.test(field.value) ? ' ' : '';
        const next = field.value + prefix + text;
        const max = field.maxLength > 0 ? field.maxLength : Infinity;
        session.truncated ||= next.length > max;
        field.value = next.slice(0, max);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      preview.textContent = interim.trim() ? `Распознаём: ${interim.trim()}` : '';
      preview.hidden = !preview.textContent;
    };
    recognition.onerror = (event) => {
      if (active !== session) return;
      const messages = {
        'not-allowed': 'Доступ к микрофону не разрешён. Разрешите его в настройках браузера или напишите комментарий.',
        'service-not-allowed': 'Браузер не разрешает сервис распознавания. Используйте клавиатуру или другой поддерживаемый браузер.',
        'audio-capture': 'Микрофон недоступен. Проверьте его подключение или напишите комментарий.',
        'no-speech': 'Речь не распознана. Повторите короткую фразу или напишите комментарий.',
        network: 'Не удалось подключиться к распознаванию. Проверьте интернет. Уже добавленный текст сохранён в форме.',
        aborted: 'Диктовка остановлена. Уже добавленный текст можно проверить и исправить.',
      };
      cancel(messages[event.error] || 'Диктовка завершилась с ошибкой. Комментарий можно написать вручную.');
    };
    recognition.onend = () => {
      if (active !== session) return;
      active = null; clearTimeout(timer); idle();
      status.textContent = session.truncated ? 'Достигнут предел 1000 символов. Проверьте и при необходимости сократите комментарий.' : session.received ? 'Текст добавлен в комментарий. Проверьте слова и числа перед сохранением.' : 'Текст не получен. Попробуйте ещё раз или напишите комментарий.';
    };
    try {
      recognition.start();
      button.textContent = 'Завершить диктовку'; button.setAttribute('aria-pressed', 'true');
      status.textContent = 'Слушаем. Произнесите замечание и нажмите «Завершить диктовку». Измерения заполните отдельно.';
      timer = scope.setTimeout(() => cancel('Диктовка завершена по времени. Проверьте уже добавленный текст.'), 60000);
    } catch { cancel('Не удалось начать диктовку. Проверьте микрофон или напишите комментарий.'); }
  }
  button.addEventListener('click', () => {
    if (!active) { start(); return; }
    if (active.stopping) return;
    active.stopping = true;
    try { active.recognition.stop(); status.textContent = 'Завершаем распознавание. Дождитесь текста перед сохранением.'; }
    catch { cancel('Диктовка завершена. Проверьте комментарий.'); }
  });
  scope.document.addEventListener('visibilitychange', () => { if (scope.document.hidden && active) cancel('Диктовка остановлена. Проверьте комментарий.'); });
  return { cancel, isActive: () => Boolean(active) };
}
