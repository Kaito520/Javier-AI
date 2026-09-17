# Javier AI

Una pequeña versión digital de Javier, hecha como regalo privado para Lupe. Es una app web local: backend en Node.js/Express, frontend en HTML/CSS/JS puro, e inteligencia artificial vía Google Gemini.

No hace falta saber de backend para usarla ni para personalizarla — este README asume que sabés programación básica, nada más.

---

## 1. Requisitos

- [Node.js](https://nodejs.org/) versión 16 o superior (incluye `npm`).
- Una clave de API de Google Gemini, gratuita, desde [Google AI Studio](https://aistudio.google.com/apikey).
- Conexión a internet (el servidor corre local, pero necesita internet para hablar con Gemini).

---

## 2. Instalación

Desde la carpeta del proyecto:

```bash
npm install
```

Esto descarga las dos únicas dependencias: `express` (servidor web) y `dotenv` (para leer el archivo `.env`).

---

## 3. Configurar tu API key de Gemini

La clave **nunca** va en el código ni en el frontend. Vive solo en un archivo `.env` que no se sube a ningún lado.

1. Copiá `.env.example` y renombrá la copia a `.env` (si ya existe un `.env`, editalo directamente).
2. Abrilo y completá la línea:

   ```
   GEMINI_API_KEY=tu_clave_real_aca
   ```

3. Guardá el archivo.

`.env` ya está listado en `.gitignore`, así que si en algún momento subís este proyecto a git, la clave no se va a incluir.

Si te olvidás de poner la clave, el servidor lo va a avisar bien claro en la consola al arrancar, y el chat va a responder siempre con un mensaje de error genérico y amigable (nunca con un error técnico) hasta que la agregues.

---

## 4. Cómo ejecutar

```bash
npm start
```

Vas a ver algo como:

```
[javier-ai] Javier AI corriendo en http://localhost:3000
```

Abrí esa dirección en el navegador (Chrome, Firefox, Safari, el que sea) y listo.

Para detenerlo, `Ctrl+C` en la terminal.

---

## 5. Cómo modificar la personalidad de Javier

Todo el "cómo habla" está en:

```
prompts/personality.md
prompts/rules.md
```

Son archivos de texto plano (Markdown), editables con cualquier editor. No hay que tocar `server.js` para nada de esto.

- **`personality.md`**: quién es, cómo habla, qué tono tiene, qué cosas no debe hacer, ejemplos de estilo.
- **`rules.md`**: reglas más técnicas — el formato de salida en JSON, y cuándo usar cada una de las 4 emociones.

Los cambios se aplican al toque, sin reiniciar el servidor (los archivos se releen en cada mensaje).

---

## 6. Cómo agregar recuerdos y memoria real

Todo vive en:

```
data/memory.json
```

Es un JSON simple con listas de texto. Estructura:

```json
{
  "about_javier": [],
  "about_lupe": [],
  "relationship": [],
  "memories": [],
  "preferences": [],
  "important_events": [],
  "inside_jokes": []
}
```

Cada categoría es un array de strings. Por ejemplo:

```json
{
  "about_javier": [
    "A Javier le encanta el mate por la mañana."
  ],
  "inside_jokes": [
    "Cuando alguien dice 'obvio', siempre contesta 'obvio que obvio'."
  ]
}
```

Reglas importantes:

- **No hay información cargada por defecto.** El archivo arranca vacío a propósito: nadie va a inventar recuerdos falsos sobre Javier y Lupe.
- Si le preguntás algo a Javier AI que no está en `memory.json`, va a decir honestamente que no tiene ese recuerdo guardado, en vez de inventarlo.
- Podés agregar y quitar entradas cuando quieras, sin reiniciar el servidor.
- Cuidado con la sintaxis JSON: comas entre elementos, comillas dobles, sin coma después del último elemento de una lista. Si el archivo queda mal formado, el servidor va a usar memoria vacía y avisar el error en consola (no rompe el chat).

---

## 7. Cómo reemplazar los cuatro PNG del personaje

Están en:

```
assets/chibi-neutral.png
assets/chibi-happy.png
assets/chibi-sad.png
assets/chibi-playful.png
```

Para cambiar el dibujo, simplemente reemplazá cada archivo por uno nuevo **con el mismo nombre**. No hace falta tocar ni HTML, ni CSS, ni JS.

El frontend siempre los muestra con `object-fit: contain`, así que cualquier imagen que uses va a mantener su proporción sin deformarse, sin importar el tamaño exacto del archivo.

---

## 8. Cómo funciona el sistema emocional

1. Cada vez que Lupe manda un mensaje, el backend arma un "contexto" combinando:
   - `prompts/personality.md`
   - `prompts/rules.md`
   - `data/memory.json` (formateado como texto)
   - el historial de la conversación actual
   - el mensaje nuevo

2. Ese contexto se le manda a Gemini, configurado para devolver **JSON estricto** (usando `responseMimeType` y `responseSchema` de la API de Gemini), con esta forma exacta:

   ```json
   { "reply": "texto de la respuesta", "emotion": "happy" }
   ```

3. El backend valida que `emotion` sea una de las cuatro permitidas (`neutral`, `happy`, `sad`, `playful`). Si Gemini devolviera cualquier otra cosa (o el JSON viniera roto), el backend lo corrige automáticamente a `neutral` — el frontend nunca recibe un valor inválido.

4. El frontend usa esa emoción para elegir qué PNG mostrar, con un crossfade suave (~180ms) entre imágenes. Mientras el texto se "escribe" en pantalla (efecto máquina de escribir), se mantiene la emoción activa. Al terminar de escribir, espera ~1 segundo y vuelve suavemente a `neutral`.

El navegador **nunca** ve el prompt interno, la clave de Gemini, ni el `memory.json` crudo — solo recibe `{ reply, emotion }`.

---

## 9. Futuras mejoras (no implementadas a propósito)

Esta primera versión se mantuvo simple e intencionalmente sin:

- Memoria basada en embeddings / vector database / RAG.
- Fine-tuning de ningún modelo.
- Persistencia de conversaciones en el servidor (todo el historial vive en el navegador de Lupe, vía `localStorage`).
- Analíticas o tracking de ningún tipo.

Si en algún momento querés sumar audio (sonido al enviar mensaje, sonido al cambiar de emoción, música ambiental), ya está todo preparado: mirá `public/sounds/README.md`.

---

## Estructura del proyecto

```
Proyecto/
├── server.js              # Backend: Express + integración con Gemini
├── package.json
├── .env                    # Tu clave real (NO se sube a git)
├── .env.example             # Plantilla sin clave
├── .gitignore
├── data/
│   └── memory.json         # Memoria real (arranca vacía)
├── prompts/
│   ├── personality.md      # Cómo habla Javier AI
│   └── rules.md            # Reglas técnicas + sistema emocional
├── public/
│   ├── index.html          # Intro + chat
│   ├── style.css           # Estética cálida/romántica minimalista
│   ├── app.js               # Chat, chibi, typewriter, localStorage
│   └── sounds/
│       └── README.md        # Cómo agregar audio más adelante
├── assets/
│   ├── chibi-neutral.png
│   ├── chibi-happy.png
│   ├── chibi-sad.png
│   └── chibi-playful.png
└── README.md
```

---

## Privacidad

- No hay analíticas ni tracking.
- Las conversaciones no se guardan en el servidor — solo en el `localStorage` del navegador de quien lo usa.
- El único servicio externo al que se llama es la API de Gemini (necesaria para generar las respuestas).
