(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------

  const MAX_MESSAGE_LENGTH = 2000;
  const HISTORY_KEY = 'javier-ai:history';
  const MAX_STORED_MESSAGES = 40;
  const TYPEWRITER_MS_PER_CHAR = 18;
  const TYPEWRITER_MAX_DURATION_MS = 2200;
  const HOLD_EMOTION_AFTER_TYPING_MS = 1000;

  const EMOTION_IMAGES = {
    neutral: '/assets/chibi-neutral.png',
    happy: '/assets/chibi-happy.png',
    sad: '/assets/chibi-sad.png',
    playful: '/assets/chibi-playful.png',
  };

  const NETWORK_ERROR_REPLY =
    'No pude conectarme con mi version digital ahora mismo. Fijate tu conexion y probá de nuevo.';

  // ---------------------------------------------------------------------
  // Sonido (preparado para el futuro; no hay archivos todavia, asi que
  // cada llamada es un no-op seguro hasta que se agreguen los .mp3/.wav).
  // Para activar un sonido: poner el archivo en public/sounds/ y completar
  // la ruta correspondiente aca abajo, por ejemplo:
  //   send: '/sounds/send.mp3'
  // ---------------------------------------------------------------------

  const SOUND_PATHS = {
    send: null,
    emotionChange: null,
    ambient: null,
  };

  function playSound(key) {
    const src = SOUND_PATHS[key];
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (_err) {
      // Silencioso a proposito: el sonido nunca debe romper el chat.
    }
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  const introScreen = document.getElementById('intro-screen');
  const chatScreen = document.getElementById('chat-screen');
  const startBtn = document.getElementById('start-btn');

  const chibiBase = document.getElementById('chibi-base');
  const chibiTop = document.getElementById('chibi-top');

  const messagesEl = document.getElementById('messages');
  const typingIndicator = document.getElementById('typing-indicator');
  const inputError = document.getElementById('input-error');

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  // ---------------------------------------------------------------------
  // Controlador del chibi: crossfade de dos capas sin deformar ni animar
  // los PNG originales, solo alternando cual esta visible.
  // ---------------------------------------------------------------------

  const chibi = (() => {
    let currentEmotion = 'neutral';
    let returnTimer = null;

    function setImmediate(emotion) {
      const src = EMOTION_IMAGES[emotion] || EMOTION_IMAGES.neutral;
      chibiBase.src = src;
      chibiTop.src = src;
      chibiTop.style.opacity = '0';
      currentEmotion = emotion;
    }

    function crossfadeTo(emotion) {
      if (emotion === currentEmotion) return;
      const src = EMOTION_IMAGES[emotion] || EMOTION_IMAGES.neutral;

      chibiTop.src = src;
      // Forzar reflow para que la transicion de opacity se dispare siempre.
      void chibiTop.offsetWidth;
      chibiTop.style.opacity = '1';

      window.setTimeout(() => {
        chibiBase.src = src;
        chibiTop.style.opacity = '0';
      }, 190);

      currentEmotion = emotion;
      playSound('emotionChange');
    }

    function set(emotion) {
      if (returnTimer) {
        window.clearTimeout(returnTimer);
        returnTimer = null;
      }
      crossfadeTo(EMOTION_IMAGES[emotion] ? emotion : 'neutral');
    }

    function scheduleReturnToNeutral(delayMs) {
      if (returnTimer) window.clearTimeout(returnTimer);
      returnTimer = window.setTimeout(() => {
        crossfadeTo('neutral');
        returnTimer = null;
      }, delayMs);
    }

    setImmediate('neutral');

    return { set, scheduleReturnToNeutral };
  })();

  // ---------------------------------------------------------------------
  // Historial (localStorage, solo para esta sesion/dispositivo)
  // ---------------------------------------------------------------------

  function loadHistory() {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry) =>
          entry &&
          (entry.role === 'user' || entry.role === 'model') &&
          typeof entry.text === 'string'
      );
    } catch (_err) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      const trimmed = history.slice(-MAX_STORED_MESSAGES);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch (_err) {
      // localStorage puede fallar (modo privado, cuota, etc). No es critico.
    }
  }

  let history = loadHistory();

  // ---------------------------------------------------------------------
  // Render de mensajes
  // ---------------------------------------------------------------------

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role === 'user' ? 'user' : 'javier'}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function renderStoredHistory() {
    messagesEl.innerHTML = '';
    for (const entry of history) {
      appendBubble(entry.role === 'user' ? 'user' : 'javier', entry.text);
    }
  }

  function typeText(el, fullText) {
    return new Promise((resolve) => {
      const duration = Math.min(TYPEWRITER_MAX_DURATION_MS, fullText.length * TYPEWRITER_MS_PER_CHAR);
      const steps = Math.max(1, Math.round(duration / TYPEWRITER_MS_PER_CHAR));
      const charsPerStep = Math.max(1, Math.ceil(fullText.length / steps));
      let index = 0;

      function tick() {
        index += charsPerStep;
        el.textContent = fullText.slice(0, index);
        scrollToBottom();
        if (index >= fullText.length) {
          resolve();
          return;
        }
        window.setTimeout(tick, TYPEWRITER_MS_PER_CHAR);
      }

      tick();
    });
  }

  // ---------------------------------------------------------------------
  // Typing indicator
  // ---------------------------------------------------------------------

  function showTyping() {
    typingIndicator.classList.remove('hidden');
    scrollToBottom();
  }

  function hideTyping() {
    typingIndicator.classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // Envio de mensajes
  // ---------------------------------------------------------------------

  function setInputError(message) {
    if (!message) {
      inputError.classList.add('hidden');
      inputError.textContent = '';
      return;
    }
    inputError.textContent = message;
    inputError.classList.remove('hidden');
  }

  function setBusy(busy) {
    chatInput.disabled = busy;
    sendBtn.disabled = busy;
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();

    if (!text) {
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      setInputError(`Ese mensaje es muy largo (máximo ${MAX_MESSAGE_LENGTH} caracteres).`);
      return;
    }
    setInputError(null);

    appendBubble('user', text);
    history.push({ role: 'user', text });
    saveHistory(history);

    chatInput.value = '';
    setBusy(true);
    playSound('send');
    showTyping();

    const historyForRequest = history.slice(0, -1); // todo lo previo, sin el mensaje actual

    let data;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyForRequest }),
      });

      if (!response.ok) {
        let serverError = null;
        try {
          const errJson = await response.json();
          serverError = errJson && errJson.error;
        } catch (_err) {
          // sin cuerpo JSON, seguimos con el fallback generico
        }
        setInputError(serverError || null);
        hideTyping();
        setBusy(false);
        chatInput.focus();
        return;
      }

      data = await response.json();
    } catch (_err) {
      hideTyping();
      const bubble = appendBubble('javier', '');
      chibi.set('neutral');
      await typeText(bubble, NETWORK_ERROR_REPLY);
      setBusy(false);
      chatInput.focus();
      return;
    }

    hideTyping();

    const emotion = ['neutral', 'happy', 'sad', 'playful'].includes(data.emotion) ? data.emotion : 'neutral';
    const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : NETWORK_ERROR_REPLY;

    chibi.set(emotion);
    const bubble = appendBubble('javier', '');
    await typeText(bubble, reply);

    history.push({ role: 'model', text: reply });
    saveHistory(history);

    chibi.scheduleReturnToNeutral(HOLD_EMOTION_AFTER_TYPING_MS);

    setBusy(false);
    chatInput.focus();
  }

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sendBtn.disabled) return;
    sendMessage(chatInput.value);
  });

  chatInput.addEventListener('input', () => {
    if (chatInput.value.length <= MAX_MESSAGE_LENGTH) {
      setInputError(null);
    }
  });

  // ---------------------------------------------------------------------
  // Pantalla de inicio -> chat
  // ---------------------------------------------------------------------

  startBtn.addEventListener('click', () => {
    introScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    renderStoredHistory();
    chatInput.focus();
    playSound('ambient');
  });
})();
