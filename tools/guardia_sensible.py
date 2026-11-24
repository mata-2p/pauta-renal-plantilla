"""Guard against publishing sensitive content.

Usage:
  python3 -I guardia_sensible.py [--terminos FILE] [--excluir NAME ...] DIR
  python3 -I guardia_sensible.py --limpiar-png DIR

Scans every file under DIR (".git" is always skipped) and prints one line per
hit as "path:line: description". Line 0 means the whole file. Exit codes:
0 no hits, 1 hits, 2 usage error.

Checks:
- private denied terms (one per line, "#" comments; case- and accent-insensitive,
  whole word unless the term starts or ends with "*"). Default list:
  terminos-prohibidos.txt next to this script. If it is absent the check is
  skipped with a notice and the generic checks still run.
  Exception: exact, case-sensitive occurrences of ALLOWED_LITERALS (empty by
  default) in file contents are ignored by this check only; file names, PNG
  chunks and the generic patterns are unaffected.
- generic patterns: e-mail addresses, Chilean national ID numbers, +56 phones.
- binary files other than .png/.svg/.ico, files over 1 MB.
- PNG metadata chunks (tEXt, iTXt, zTXt, eXIf).

--limpiar-png rewrites every PNG under DIR in place without metadata chunks
(the ones above plus tIME) and exits.
"""
import argparse
import os
import re
import struct
import sys
import unicodedata
from pathlib import Path

PRIVATE_LIST_NAME = "terminos-prohibidos.txt"
MAX_BYTES = 1024 * 1024
ALLOWED_BINARY = {".png", ".svg", ".ico"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_FLAGGED = {b"tEXt", b"iTXt", b"zTXt", b"eXIf"}
PNG_STRIPPED = PNG_FLAGGED | {b"tIME"}

# Host names that may appear in file contents even when a denied term is part of
# them, e.g. your label reader "lector-etiquetas.<subdominio>.workers.dev" when the
# subdomain is in your private list. Empty by default. Edit it here on purpose: no
# CLI flag or env var may extend it. Matched exactly (no folding) and only as a
# whole host name.
ALLOWED_LITERALS = ()
# Characters that continue a host name for the whole-host check in strip_allowed.
# "@" is not a host-name character: it is here so that "user@<allowed host>" is
# not blanked as the allowed host, and the private term list still sees that host
# inside an e-mail address. (The e-mail pattern itself runs before strip_allowed
# and does not depend on this.) Do not remove it.
HOST_CHARS = "._@-"

GENERIC = [
    # The look-behind keeps the search linear on long runs of word characters.
    ("correo electrónico", re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("número de identidad chileno",
     re.compile(r"(?<![\w.])(?:\d{1,2}\.\d{3}\.\d{3}|\d{7,8})-[\dkK](?!\w)")),
    ("teléfono chileno", re.compile(r"(?<![\w+])\+56[\s.-]?\(?\d{1,2}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)")),
]


def fold(text):
    """Lowercase and drop accents so "CAFÉ" and "cafe" compare equal."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _continues_host(c):
    """True if c could extend a host name: letters, digits, "._@-", marks, format chars."""
    return c.isalnum() or c in HOST_CHARS or unicodedata.category(c)[0] == "M" or unicodedata.category(c) == "Cf"


def strip_allowed(line):
    """Blank out exact ALLOWED_LITERALS that stand alone as a host name.

    The character before must not continue a host name. After it, the same
    holds, except one trailing dot that is not followed by another host char.
    """
    for literal in ALLOWED_LITERALS:
        out, i = [], 0
        while (j := line.find(literal, i)) != -1:
            end = j + len(literal)
            before = line[j - 1] if j else ""
            after = line[end:end + 1]
            if after == ".":
                after = line[end + 1:end + 2]
            if (before and _continues_host(before)) or (after and _continues_host(after)):
                out.append(line[i:end])
            else:
                out.append(line[i:j] + " ")
            i = end
        out.append(line[i:])
        line = "".join(out)
    return line


def load_terms(path):
    """Return [(term, compiled regex)] or None when the list does not exist."""
    if path is None or not path.is_file():
        return None
    terms = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        left = "" if line.startswith("*") else r"(?<![0-9a-z])"
        right = "" if line.endswith("*") else r"(?![0-9a-z])"
        word = fold(line.strip("*"))
        if word:
            terms.append((word, re.compile(left + re.escape(word) + right)))
    return terms


def png_chunks(data):
    """Yield (offset, type, data) for each chunk; raise ValueError if malformed."""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("falta la firma PNG")
    i = len(PNG_SIGNATURE)
    while i < len(data):
        if i + 12 > len(data):
            raise ValueError("chunk truncado")
        (length,) = struct.unpack(">I", data[i:i + 4])
        kind = data[i + 4:i + 8]
        end = i + 12 + length
        if end > len(data):
            raise ValueError("chunk truncado")
        yield i, kind, data[i:end]
        i = end
        if kind == b"IEND":
            break


def walk(root, excluded):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in excluded)
        for name in sorted(filenames):
            path = Path(dirpath) / name
            yield path, path.relative_to(root).as_posix()


def scan_file(path, rel, terms):
    hits = []
    if path.is_symlink():
        return [f"{rel}:0: enlace simbólico (no se publica)"]
    if path.name == PRIVATE_LIST_NAME:
        hits.append(f"{rel}:0: la lista privada de términos no debe publicarse")
    if terms:
        folded = fold(rel)
        hits += [f"{rel}:0: término prohibido en el nombre: {t}" for t, rx in terms if rx.search(folded)]
    size = path.stat().st_size
    if size > MAX_BYTES:
        hits.append(f"{rel}:0: archivo de más de 1 MB ({size} bytes)")
        return hits
    data = path.read_bytes()
    ext = path.suffix.lower()

    if ext == ".png":
        try:
            for offset, kind, _ in png_chunks(data):
                if kind in PNG_FLAGGED:
                    hits.append(f"{rel}:0: metadatos PNG, chunk {kind.decode('latin-1')} en el byte {offset}")
        except ValueError as err:
            hits.append(f"{rel}:0: PNG mal formado ({err})")
        return hits

    try:
        if b"\x00" in data:
            raise UnicodeDecodeError("utf-8", data, 0, 1, "NUL byte")
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        if ext not in ALLOWED_BINARY:
            hits.append(f"{rel}:0: archivo binario no permitido (solo .png, .svg, .ico)")
        return hits

    for number, line in enumerate(text.splitlines(), start=1):
        for label, rx in GENERIC:
            if rx.search(line):
                hits.append(f"{rel}:{number}: {label}")
        if terms:
            folded = fold(strip_allowed(line))
            hits += [f"{rel}:{number}: término prohibido: {t}" for t, rx in terms if rx.search(folded)]
    return hits


def strip_png(path):
    """Rewrite a PNG without metadata chunks. Return the removed chunk types."""
    data = path.read_bytes()
    kept, removed = [PNG_SIGNATURE], []
    for _, kind, raw in png_chunks(data):
        if kind in PNG_STRIPPED:
            removed.append(kind.decode("latin-1"))
        else:
            kept.append(raw)
    if removed:
        path.write_bytes(b"".join(kept))
    return removed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Guardia de contenido sensible antes de publicar.")
    parser.add_argument("dir", type=Path)
    parser.add_argument("--terminos", type=Path, default=Path(__file__).resolve().parent / PRIVATE_LIST_NAME,
                        help="lista privada de términos (por defecto, junto a este script)")
    parser.add_argument("--excluir", action="append", default=[], metavar="NOMBRE",
                        help="nombre de directorio a omitir (.git se omite siempre)")
    parser.add_argument("--limpiar-png", action="store_true", help="quitar metadatos de los PNG y salir")
    args = parser.parse_args(argv)

    if not args.dir.is_dir():
        print(f"error: {args.dir} no es un directorio", file=sys.stderr)
        return 2
    excluded = {".git", *args.excluir}

    if args.limpiar_png:
        for path, rel in walk(args.dir, excluded):
            if path.suffix.lower() == ".png" and not path.is_symlink():
                try:
                    removed = strip_png(path)
                except ValueError as err:
                    print(f"error: {rel}: PNG mal formado ({err})", file=sys.stderr)
                    return 1
                print(f"{rel}: " + (f"quitados {', '.join(removed)}" if removed else "sin metadatos"))
        return 0

    terms = load_terms(args.terminos)
    if terms is None:
        print(f"aviso: lista privada de términos no encontrada ({args.terminos}); se omite ese chequeo, "
              "los chequeos genéricos sí corren", file=sys.stderr)
    else:
        print(f"lista privada: {len(terms)} términos", file=sys.stderr)

    hits, count = [], 0
    for path, rel in walk(args.dir, excluded):
        count += 1
        hits += scan_file(path, rel, terms)
    for hit in hits:
        print(hit)
    if hits:
        print(f"guardia: {len(hits)} hallazgos en {count} archivos", file=sys.stderr)
        return 1
    print(f"guardia: sin hallazgos en {count} archivos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
