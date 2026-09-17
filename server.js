// Javier AI - servidor backend
//
// Arma el contexto (personalidad + reglas + memoria + historial), le pide a Gemini
// una respuesta estructurada en JSON ({ reply, emotion }) y se la sirve al frontend.
// La clave de Gemini vive unicamente en .env y nunca sale de este archivo.

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const ALLOWED_EMOTIONS = ['neutral', 'happy', 'sad', 'playful'];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 40;
const GEMINI_TIMEOUT_MS = 25000;

const FALLBACK_REPLY = 'Creo que mi cerebro digital acaba de tener un pequeno cortocircuito. Dame un segundo e intenta de nuevo.';
const RATE_LIMIT_REPLY = 'Dejame un respiro, hablas mas rapido de lo que puedo pensar. Probá de nuevo en un ratito.';

const PROMPTS_DIR = path.join(__dirname, 'prompts');
const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_PATH = path.join(DATA_DIR, 'memory.json');

// ---------------------------------------------------------------------------
// Carga de personalidad, reglas y memoria (se releen en cada request para que
// editar los .md o el memory.json no requiera reiniciar el servidor).
// ---------------------------------------------------------------------------

function readTextFileSafe(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[javier-ai] No pude leer ${filePath}:`, err.message);
    return fallback;
  }
}

const MEMORY_LABELS = {
  about_javier: 'Sobre Javier',
  about_lupe: 'Sobre Lupe',
  relationship: 'La relacion entre Javier y Lupe',
  memories: 'Recuerdos guardados',
  preferences: 'Preferencias conocidas',
  important_events: 'Eventos importantes',
  inside_jokes: 'Bromas internas',
};

const MEMORY_KEYS = Object.keys(MEMORY_LABELS);

function loadMemory() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const safe = {};
    for (const key of MEMORY_KEYS) {
      safe[key] = Array.isArray(parsed[key]) ? parsed[key].filter((x) => typeof x === 'string') : [];
    }
    return safe;
  } catch (err) {
    console.error('[javier-ai] No pude leer data/memory.json, uso memoria vacia:', err.message);
    const empty = {};
    for (const key of MEMORY_KEYS) empty[key] = [];
    return empty;
  }
}

function formatMemoryForPrompt(memory) {
  const blocks = MEMORY_KEYS.map((key) => {
    const items = memory[key];
    const label = MEMORY_LABELS[key];
    if (!items || items.length === 0) {
      return `### ${label}\n(todavia no hay informacion guardada aca. No inventes nada para esta seccion.)`;
    }
    return `### ${label}\n${items.map((item) => `- ${item}`).join('\n')}`;
  });
  return blocks.join('\n\n');
}

function buildSystemPrompt() {
  const personality = readTextFileSafe(
    path.join(PROMPTS_DIR, 'personality.md'),
    'Sos una pequena version digital de Javier, hecha para hablar con Lupe.'
  );
  const rules = readTextFileSafe(
    path.join(PROMPTS_DIR, 'rules.md'),
    'Respondes siempre en JSON con "reply" y "emotion" (neutral, happy, sad o playful).'
  );
  const memory = loadMemory();
  const memoryText = formatMemoryForPrompt(memory);

  return [
    personality.trim(),
    rules.trim(),
    `## Memoria real guardada por Javier\n\n${memoryText}`,
  ].join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Utilidades de validacion
// ---------------------------------------------------------------------------

function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const cleaned = [];
  for (const entry of rawHistory) {
    if (!entry || typeof entry !== 'object') continue;
    const role = entry.role === 'model' ? 'model' : entry.role === 'user' ? 'user' : null;
    if (!role) continue;
    let text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    if (text.length > MAX_MESSAGE_LENGTH) text = text.slice(0, MAX_MESSAGE_LENGTH);
    cleaned.push({ role, text });
  }
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

function validateEmotion(value) {
  return ALLOWED_EMOTIONS.includes(value) ? value : 'neutral';
}

// Intenta parsear el texto que devuelve Gemini como { reply, emotion }.
// Es tolerante a que venga envuelto en texto extra o en un bloque ```json.
function parseGeminiJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const tryParse = (candidate) => {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj.reply === 'string' && obj.reply.trim()) {
        return { reply: obj.reply.trim(), emotion: validateEmotion(obj.emotion) };
      }
    } catch (_err) {
      // sigue intentando
    }
    return null;
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const fromFence = tryParse(fenced[1].trim());
    if (fromFence) return fromFence;
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const fromSlice = tryParse(text.slice(firstBrace, lastBrace + 1));
    if (fromSlice) return fromSlice;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cliente HTTPS minimo para la API de Gemini (sin dependencias extra: Node 16
// no trae fetch global, asi que usamos el modulo https nativo).
// ---------------------------------------------------------------------------

function postJSON(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }

    const data = JSON.stringify(payload);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let parsedBody;
        try {
          parsedBody = body ? JSON.parse(body) : {};
        } catch (err) {
          reject(new Error(`Respuesta no-JSON de Gemini (status ${res.statusCode})`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = (parsedBody && parsedBody.error && parsedBody.error.message) || `HTTP ${res.statusCode}`;
          const err = new Error(message);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        resolve(parsedBody);
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Tiempo de espera agotado al contactar a Gemini'));
    });
    req.write(data);
    req.end();
  });
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    emotion: { type: 'STRING', enum: ALLOWED_EMOTIONS },
  },
  required: ['reply', 'emotion'],
};

async function callGemini({ systemPrompt, history, message }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const contents = history
    .map((h) => ({ role: h.role, parts: [{ text: h.text }] }))
    .concat([{ role: 'user', parts: [{ text: message }] }]);

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 500,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const data = await postJSON(url, payload, GEMINI_TIMEOUT_MS);

  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const finishReason = candidate && candidate.finishReason;
  const parts = candidate && candidate.content && candidate.content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';

  if (!text) {
    throw new Error(`Gemini no devolvio texto util (finishReason: ${finishReason || 'desconocido'})`);
  }

  const parsed = parseGeminiJSON(text);
  if (!parsed) {
    // Gemini respondio pero no pudimos extraer JSON valido: usamos el texto
    // crudo como respuesta antes que perderlo, con emocion neutral.
    return { reply: text.trim().slice(0, MAX_MESSAGE_LENGTH), emotion: 'neutral' };
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Rate limiting muy simple en memoria (uso privado, sin base de datos).
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '150kb' }));

  // Solo servimos public/ y assets/. prompts/ y data/ nunca se exponen.
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/assets', express.static(path.join(__dirname, 'assets')));

  app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (isRateLimited(ip)) {
      res.status(200).json({ reply: RATE_LIMIT_REPLY, emotion: 'playful' });
      return;
    }

    const body = req.body || {};
    const rawMessage = body.message;

    if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
      res.status(400).json({ error: 'El mensaje no puede estar vacio.' });
      return;
    }
    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `El mensaje es demasiado largo (maximo ${MAX_MESSAGE_LENGTH} caracteres).` });
      return;
    }

    const message = rawMessage.trim();
    const history = sanitizeHistory(body.history);

    if (!GEMINI_API_KEY) {
      console.error(
        '[javier-ai] Falta GEMINI_API_KEY. Copia .env.example a .env y completa tu clave de Gemini antes de chatear.'
      );
      res.status(200).json({ reply: FALLBACK_REPLY, emotion: 'neutral' });
      return;
    }

    try {
      const systemPrompt = buildSystemPrompt();
      const result = await callGemini({ systemPrompt, history, message });
      res.status(200).json({ reply: result.reply, emotion: validateEmotion(result.emotion) });
    } catch (err) {
      console.error('[javier-ai] Error llamando a Gemini:', err.message);
      res.status(200).json({ reply: FALLBACK_REPLY, emotion: 'neutral' });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL });
  });

  return app;
}

if (require.main === module) {
  if (!GEMINI_API_KEY) {
    console.warn('==================================================================');
    console.warn('[javier-ai] ATENCION: no encontre GEMINI_API_KEY en el archivo .env');
    console.warn('[javier-ai] Copia .env.example a .env y agrega tu clave real.');
    console.warn('[javier-ai] El chat va a funcionar, pero Javier AI va a responder');
    console.warn('[javier-ai] siempre con el mensaje de error generico hasta que la agregues.');
    console.warn('==================================================================');
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[javier-ai] Javier AI corriendo en http://localhost:${PORT}`);
  });
}

module.exports = {
  createApp,
  sanitizeHistory,
  validateEmotion,
  parseGeminiJSON,
  formatMemoryForPrompt,
  buildSystemPrompt,
};
