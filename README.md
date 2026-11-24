# Mi pauta: la pauta de alimentación de tu equipo tratante, en el teléfono

Una página web que se instala como app y muestra, **palabra por palabra**, la pauta de alimentación que te entregó tu equipo tratante. Tiene letra grande, alto contraste y lectura en voz alta. También trae anotaciones (controles, diario, presión y peso, preguntas), una hoja para el médico, una despensa ordenada con la tabla de la pauta y un lector de etiquetas opcional. Es gratis: se publica con GitHub Pages y los datos quedan en el teléfono.

> [!IMPORTANT]
> **Es una herramienta de apoyo, no software clínico.** No reemplaza al equipo tratante. La app **nunca calcula ni sugiere límites** (sodio, potasio, fósforo, proteína, líquidos): solo copia lo que tu equipo escribió.

> [!WARNING]
> **La pauta incluida es una pauta de ejemplo.** Sus frases dicen «[Ejemplo] …» y cada pantalla muestra el aviso «EJEMPLO». No es una recomendación de alimentación para nadie. **Debes reemplazarla** por la pauta que te entregue tu equipo tratante antes de usar la app.

## Camino rápido

1. Crea tu propio repo con estos archivos (público, para usar GitHub Pages gratis).
2. Reemplaza la pauta de ejemplo por la tuya: [Poner tu pauta](#poner-tu-pauta).
3. Corre los chequeos: [Revisar antes de publicar](#revisar-antes-de-publicar).
4. Activa GitHub Pages: [Publicar](#publicar-en-github-pages).
5. Opcional: configura el [lector de etiquetas](#lector-de-etiquetas-opcional).

## Poner tu pauta

La regla es una sola: **el texto de tu pauta se copia tal cual**, sin resumir, sin cambiar palabras y sin agregar nada. Los chequeos comparan la página con la lista de frases que escribes en `check_verbatim.py`.

### Paso a paso

1. **Copia tu pauta en `pauta-personal/index.html`.** Cada frase de la pauta va en su lugar: el objetivo y las indicaciones en `#indicaciones`, la tabla en `#elegir` (un `<article class="group">` por grupo, con sus columnas «Preferir» y «Limitar o evitar»), el día de ejemplo en `#dia`, y así con cada sección.
2. **Escribe las mismas frases en `tests/pauta-personal/check_verbatim.py`**, en la lista `SOURCE`, en el orden de la página.
3. **Pon la indicación médica del alta** en el bloque `#alta` de `index.html` (fecha y texto tal como están en el documento) y en `ALTA_QUOTE` y `ALTA` de `check_verbatim.py`. La fecha también va en el mosaico del inicio.
4. **Copia la tabla en la despensa**: en `pauta-personal/despensa-core.js`, entre `// <pauta-table>` y `// </pauta-table>`, una fila por grupo con las mismas palabras de `index.html`. Ajusta `QUALIFIERS` (palabras que acompañan a un alimento, como «según indique tu equipo») e `INSTRUCTIONS` (frases de la tabla que no son un alimento).
5. **Elige las frases del lector** en `pauta-personal/etiqueta-core.js`:
   - `PAUTA_SODIO`: la frase de tu pauta que se muestra cuando la persona confirma el sello «ALTO EN SODIO» o un número de sodio.
   - `PAUTA_POTASIO`: la frase que se muestra cuando confirma «cloruro de potasio» o «sal light».
   - `CATEGORY_LINES`: viene **vacío**. Para cada tipo de producto (cecinas, caldos en cubo, etc.), agrega solo las líneas de tu pauta que lo nombran con esas mismas palabras. Si tu pauta no nombra ninguno, déjalo vacío.
   - Las dos frases van también en `LABEL_QUOTES` de `check_verbatim.py`.
6. **Quita los avisos de ejemplo**: borra cada línea `<p class="ejemplo">…</p>` de `index.html` y `despensa.html`, y pon `PAUTA_DE_EJEMPLO = False` en `check_verbatim.py`. Desde ahí el chequeo exige que no quede ninguno.
7. **Actualiza las citas de las guías.** «Para quien cocina» y «Cómo leer las etiquetas» citan frases de la pauta entre «…»: cada cita tiene que ser una frase de tu pauta. Las «Ideas para la casa» son de la app: que sean ideas de organización, nunca indicaciones de alimentación.
8. **Actualiza los tests que fijan la pauta de ejemplo** (ver la tabla de abajo).
9. **Sube la versión** en `pauta-personal/sw.js` (`VERSION`), en `check_responsive.py` y en `sw.test.mjs`, para que los teléfonos descarguen la pauta nueva.

### Dónde está cada cosa

| Qué | Archivo | Marca |
| --- | --- | --- |
| Texto de la pauta | `pauta-personal/index.html` | secciones `#indicaciones`, `#elegir`, `#dia`, `#presion`, `#seguimiento` |
| Indicación del alta | `pauta-personal/index.html` | `#alta` y el mosaico «Indicación médica del alta» |
| Avisos «EJEMPLO» | `index.html`, `despensa.html` | `<p class="ejemplo">` |
| Tabla de la despensa | `pauta-personal/despensa-core.js` | `// <pauta-table>` … `// </pauta-table>`, `QUALIFIERS`, `INSTRUCTIONS` |
| Frases del lector | `pauta-personal/etiqueta-core.js` | `PAUTA_SODIO`, `PAUTA_POTASIO`, `CATEGORY_LINES` |
| Chequeo textual | `tests/pauta-personal/check_verbatim.py` | `SOURCE`, `ALTA_QUOTE`, `ALTA`, `LABEL_QUOTES`, `PAUTA_DE_EJEMPLO` |
| Tests de la despensa | `tests/pauta-personal/despensa-core.test.mjs` | `EXPECTED_ITEMS`, `AVENA`, `CECINAS` y las búsquedas |
| Tests de la voz | `tests/pauta-personal/voz.test.mjs` | las frases y el número de grupos |
| Tests del lector | `tests/pauta-personal/etiqueta-core.test.mjs` | el valor de `PAUTA_SODIO` y `PAUTA_POTASIO` |
| Versión | `sw.js`, `check_responsive.py`, `sw.test.mjs` | `pauta-v1` |

> [!TIP]
> Si tu pauta no trae una indicación médica del alta, pregunta a tu equipo qué poner. Si prefieres quitar la sección, sácala también de `SECTIONS` y `ALTA` en `check_verbatim.py` y de `voz.test.mjs`.

## Revisar antes de publicar

Necesitas Python 3 y Node 20 o más nuevo. No hay dependencias que instalar.

```sh
python3 -I tests/pauta-personal/check_verbatim.py pauta-personal/index.html
python3 -I tests/pauta-personal/check_registro.py pauta-personal/registro.html
python3 -I tests/pauta-personal/check_responsive.py pauta-personal
node --test 'tests/pauta-personal/*.test.mjs'
(cd etiquetas-worker && node --test 'test/*.test.mjs')
python3 -I -B -m unittest discover -s tests/guardia
python3 -I tools/guardia_sensible.py --excluir .git .
```

Si todos terminan sin problemas, está listo. GitHub Actions corre lo mismo en cada push.

**Antes de cada push, corre la guardia con tu lista privada.** La guardia busca correos, teléfonos, números de identidad, archivos binarios, metadatos de imágenes y los términos que tú le des (tu nombre, el de la persona, el lugar donde se atiende). Esa lista **no va en el repo**: el formato está en `tools/terminos-prohibidos.ejemplo.txt`.

```sh
python3 -I tools/guardia_sensible.py --terminos ~/mi-lista.txt --excluir .git .
```

## Tus datos

- Lo que se anota (controles, diario, presión y peso, preguntas, despensa) queda **solo en el teléfono**, en el navegador. No hay servidor, cuentas ni envío de datos.
- Para compartir con un familiar, la app exporta un archivo que se abre en otro teléfono. Es manual.
- Si se borran los datos del navegador, las anotaciones se pierden. Conviene exportar una copia de vez en cuando.
- La única excepción es el lector de etiquetas, si lo configuras: envía la foto que la persona elige.

## Lector de etiquetas (opcional)

La persona saca una foto de una etiqueta, revisa lo que se leyó, lo **confirma o corrige** y recién entonces ve las frases de su pauta que corresponden, tal cual. La app nunca dice «puedes comerlo».

| Tema | Qué pasa |
| --- | --- |
| Qué sale del teléfono | La foto que la persona elige, sin metadatos. Nada más. |
| Por dónde pasa | Por tu Worker de Cloudflare y por OpenRouter hasta el modelo, **fuera de Chile**. |
| Qué se guarda | Nada: ni la foto ni la respuesta. |
| Qué necesitas | Una cuenta de Cloudflare para tu propio Worker y una clave de OpenRouter **con tope de gasto mensual**. |
| Sin configurar | La pantalla dice que el lector no está configurado y no envía nada. Así viene esta plantilla. |

Con `READER_URL` vacío, la guía de primer uso no muestra el paso «Leer una etiqueta» ni la ayuda de esa pantalla: el recorrido tiene 5 pasos. Cuando pones la dirección en `READER_URL`, el paso y la ayuda aparecen solos.

Para configurarlo:

1. Despliega el Worker siguiendo [`etiquetas-worker/README.md`](etiquetas-worker/README.md). Ahí se pone `ALLOWED_ORIGIN` y se carga la clave.
2. Pon la dirección del Worker, terminada en `/leer`, en `READER_URL` de `pauta-personal/etiqueta-core.js`. Es el único lugar.
3. Revisa el aviso de privacidad de `pauta-personal/etiqueta.html` («Antes de la primera foto»): tiene que decir por dónde pasa la foto. Si cambias el modelo, cambia ese texto.
4. Si tu usuario está en tu lista privada de la guardia, agrega el nombre exacto del host del Worker en `ALLOWED_LITERALS` de `tools/guardia_sensible.py`.

## Publicar en GitHub Pages

1. En GitHub › Settings › Emails, activa «Keep my email addresses private» para que los commits no muestren tu correo.
2. Sube el repo a la rama `main`.
3. En el repo › Settings › Pages, elige **Source: GitHub Actions**.
4. En el repo › Settings › Actions › General, deja permitidas las acciones. El workflow `.github/workflows/pages.yml` corre los chequeos y, si pasan, publica `pauta-personal/`.
5. Si el primer run corrió antes de activar Pages, vuelve a correrlo desde la pestaña Actions («Run workflow»).

La página queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

**Instalar en el teléfono:** ábrela con internet. En Android (Chrome), menú ⋮ › «Instalar aplicación». En iPhone (Safari), botón Compartir › «Agregar a inicio». Después funciona sin conexión, salvo el lector de etiquetas.

## Qué hay en el repo

| Carpeta | Qué es |
| --- | --- |
| `pauta-personal/` | La app que se publica. |
| `tests/pauta-personal/` | Chequeos de la pauta, de las páginas y tests de la lógica. |
| `etiquetas-worker/` | El lector de etiquetas (Cloudflare Worker) y sus tests. |
| `tools/guardia_sensible.py` | La guardia de contenido sensible. |
| `tests/guardia/` | Tests de la guardia. |
| `.github/workflows/pages.yml` | Chequeos y publicación en GitHub Pages. |

Los textos están en español de Chile y la guía de etiquetas usa los sellos «ALTO EN» de la Ley 20.606.

## Qué no hace

- No calcula ni sugiere límites de ningún nutriente ni de líquidos.
- No dice si un alimento se puede comer, no pone puntajes ni semáforos.
- No interpreta la pauta ni agrega indicaciones propias: solo la copia tal cual.
- No toma como verdad lo que lee el lector: la persona confirma siempre.
- No guarda nada en un servidor ni tiene cuentas.
- No reemplaza al equipo tratante. Ante cualquier duda, síntoma o cambio, se consulta al equipo tratante.

## Licencia

MIT. El texto está en [`LICENSE`](LICENSE).
