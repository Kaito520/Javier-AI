# Sonidos (opcional, todavia no incluidos)

Esta carpeta esta preparada para cuando quieras agregar audio, sin tener que tocar el resto del codigo.

Pasos:

1. Poné tus archivos de audio (`.mp3` o `.wav`) directamente en esta carpeta. Por ejemplo:
   - `send.mp3` — sonido al enviar un mensaje
   - `emotion.mp3` — sonido al cambiar de emocion el personaje
   - `ambient.mp3` — musica de fondo opcional

2. Abrí `public/app.js` y buscá el objeto `SOUND_PATHS` cerca del principio del archivo. Completá las rutas, por ejemplo:

   ```js
   const SOUND_PATHS = {
     send: '/sounds/send.mp3',
     emotionChange: '/sounds/emotion.mp3',
     ambient: '/sounds/ambient.mp3',
   };
   ```

3. Listo. El resto del codigo ya llama a `playSound('send')`, `playSound('emotionChange')` y `playSound('ambient')` en los momentos correctos; mientras la ruta este vacia (`null`) no pasa nada, no hay errores.
