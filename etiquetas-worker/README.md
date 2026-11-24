# Lector de etiquetas (Cloudflare Worker)

Servidor intermedio **opcional** para la pantalla «Leer una etiqueta». Recibe la foto de la etiqueta de un alimento envasado chileno y devuelve solo lo que se ve impreso. Guarda tu clave de OpenRouter como secreto, así nadie la configura en el teléfono.

Sin este Worker la app funciona igual: la pantalla dice que el lector no está configurado y no envía nada.

## Qué hace

- Recibe **solo** una foto: `POST /leer` con los bytes de la imagen y `Content-Type: image/jpeg` o `image/webp`. El teléfono le quita los metadatos antes de enviarla.
- Arma él mismo un prompt fijo, con un modelo fijo, temperatura 0, un tope de 300 tokens y salida JSON estricta.
- Devuelve solo lo que se ve impreso:

  ```json
  {
    "sellos": {
      "alto_en_sodio": "sí | no | no se pudo leer",
      "alto_en_azucares": "…",
      "alto_en_grasas_saturadas": "…",
      "alto_en_calorias": "…"
    },
    "cloruro_de_potasio": "sí | no | no se pudo leer",
    "dice_sal_light": "sí | no | no se pudo leer",
    "categoria_impresa": "cecinas | … | ninguna | no se pudo leer",
    "sodio_mg_100": 820,
    "sodio_mg_porcion": null,
    "modelo": "google/gemini-3.1-flash-lite"
  }
  ```

  `null` significa «no se pudo leer», nunca cero. La app muestra todo esto para que la persona lo **confirme o corrija** antes de ver cualquier frase de su pauta.

## Qué no hace nunca

- No es un proxy general de IA: no acepta texto, preguntas ni otro prompt. Cualquier otra ruta o método responde 404.
- No dice si un producto es adecuado, no da consejos y no calcula ni sugiere límites.
- No reenvía la IP, las cabeceras ni ningún dato de la persona a OpenRouter.
- No guarda ni registra la foto ni la respuesta del modelo. Solo registra el código de estado, los logs de Workers están apagados y todas las respuestas llevan `Cache-Control: no-store`.
- No deja pasar texto crudo del modelo: si la salida no calza con el esquema, responde 502.

## Topes y respuestas de error

| Caso | Estado | Mensaje |
| --- | --- | --- |
| Ruta o método distinto de `POST`/`OPTIONS /leer` | 404 | «no encontrado» |
| Origen ausente, distinto de `ALLOWED_ORIGIN` o sin `ALLOWED_ORIGIN` | 403 | «origen no permitido» |
| Más de 10 lecturas en 60 s desde la misma IP | 429 | «demasiadas solicitudes» |
| Falta `OPENROUTER_API_KEY` | 503 | «servicio no configurado» |
| Tipo distinto de JPEG o WebP | 415 | «tipo de imagen no admitido» |
| Más de 1,5 MB | 413 | «imagen demasiado grande» |
| Los bytes no son JPEG o WebP | 400 | «imagen no válida» |
| La foto conserva metadatos | 400 | «foto con metadatos» |
| Respuesta del modelo mal formada o con datos de más | 502 | «no se pudo leer la etiqueta» |
| OpenRouter tarda más de 20 s | 504 | «la lectura tardó demasiado» |

## Configurar y desplegar

1. En `wrangler.toml`, cambia `ALLOWED_ORIGIN` por la dirección de tu página, por ejemplo `https://tu-usuario.github.io`. Solo el origen: sin barra final ni ruta.
2. En OpenRouter, crea una clave **con un tope de gasto mensual**.
3. Desde `etiquetas-worker/`, con tu cuenta de Cloudflare:

   ```sh
   npx wrangler@4 login
   npx wrangler@4 deploy
   npx wrangler@4 secret put OPENROUTER_API_KEY
   ```

   El último comando pide la clave en la terminal. La clave nunca va al repo ni a `wrangler.toml`.
4. Copia la dirección que muestra `deploy` (`https://lector-etiquetas.<tu-subdominio>.workers.dev`) y ponla, terminada en `/leer`, en `READER_URL` de `pauta-personal/etiqueta-core.js`.

Para probar en local se puede permitir `http://localhost:*` y `http://127.0.0.1:*` con `ALLOW_LOCAL_ORIGIN=1` en `.dev.vars`. En producción no se define.

## Probar

Sin dependencias, con Node 20 o más nuevo:

```sh
cd etiquetas-worker
node --test "test/*.test.mjs"
```

Los tests usan un `fetch` simulado: no llaman a OpenRouter ni a Cloudflare.

El modelo está fijo en `src/index.js` (`MODEL`). Si cambias el modelo, el prompt o el esquema, prueba de nuevo con fotos de etiquetas reales antes de publicar: ninguna lectura se toma como verdad, pero un modelo peor obliga a corregir más.
