"""CLI tests for tools/guardia_sensible.py.

Run: python3 -I -m unittest discover -s tests/guardia

Test strings that look like an e-mail, an ID number or a phone are split in
two in this source, so the guard can scan this repo without hits.
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "tools" / "guardia_sensible.py"


def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png(*extra):
    """A valid 1x1 PNG; extra chunks go between IHDR and IDAT."""
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    return b"\x89PNG\r\n\x1a\n" + ihdr + b"".join(extra) + idat + chunk(b"IEND", b"")


def chunk_types(data):
    types, i = [], 8
    while i < len(data):
        (n,) = struct.unpack(">I", data[i:i + 4])
        types.append(data[i + 4:i + 8])
        i += 12 + n
    return types


class GuardCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tree = self.tmp / "tree"
        self.tree.mkdir()
        self.terms = self.tmp / "terminos.txt"
        self.terms.write_text("# comentario\n\nprivado\nalmacén\n*empresa*\nsal\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, rel, content):
        path = self.tree / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        return path

    def run_guard(self, *args, script=GUARD, terms=True):
        cmd = [sys.executable, "-I", str(script)]
        if terms:
            cmd += ["--terminos", str(self.terms)]
        cmd += [*args, str(self.tree)]
        return subprocess.run(cmd, capture_output=True, text=True, cwd=self.tmp)

    def assertHit(self, res, where, label):
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        line = next((l for l in res.stdout.splitlines() if l.startswith(where + ":")), None)
        self.assertIsNotNone(line, f"no hit for {where!r} in:\n{res.stdout}")
        self.assertIn(label, line)


class CleanTree(GuardCase):
    def test_clean_tree_exits_zero(self):
        self.write("index.html", "<p>Fruta de ejemplo, salsa y salero.</p>\n<p>Ruta al control.</p>\n")
        self.write("icon.png", png(chunk(b"bKGD", b"\x00\x00\x00\x00\x00\x00")))
        self.write("icon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>\n")
        self.write("sw.js", 'var VERSION = "pauta-v2";\n')
        res = self.run_guard()
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("sin hallazgos", res.stdout)
        self.assertNotIn("se omite", res.stderr)

    def test_git_dir_is_excluded(self):
        self.write("a.txt", "limpio\n")
        self.write(".git/config", "privado contacto" + "@example.org\n")
        res = self.run_guard()
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)


class DeniedTerms(GuardCase):
    def test_term_hit_reports_path_and_line(self):
        self.write("docs/a.txt", "uno\ndos\nalgo privado aquí\n")
        res = self.run_guard()
        self.assertHit(res, "docs/a.txt:3", "privado")

    def test_accent_and_case_insensitive_both_ways(self):
        self.write("a.txt", "x\nEl ALMACEN central\n")
        self.write("b.txt", "Algo PRÍVADO\n")
        res = self.run_guard()
        self.assertHit(res, "a.txt:2", "almacen")
        self.assertHit(res, "b.txt:1", "privado")

    def test_whole_word_unless_wildcard(self):
        self.write("a.txt", "Salsa y salero\n")
        self.write("b.txt", "MiEmpresaSpA\n")
        res = self.run_guard()
        self.assertNotIn("a.txt:", res.stdout)
        self.assertHit(res, "b.txt:1", "empresa")

    def test_term_in_file_name(self):
        self.write("logo-privado.svg", "<svg/>\n")
        res = self.run_guard()
        self.assertHit(res, "logo-privado.svg:0", "privado")

    def test_private_list_copied_into_tree_is_a_hit(self):
        self.write("tools/terminos-prohibidos.txt", "nada\n")
        res = self.run_guard()
        self.assertHit(res, "tools/terminos-prohibidos.txt:0", "lista privada")


ALLOWED_HOST = "lector-etiquetas.nombre-ejemplo.workers.dev"
NAME = "nombre-ejemplo"
SHIPPED = "ALLOWED_LITERALS = ()"
TERM_HIT = "término prohibido: " + NAME


class AllowedWorkerHost(GuardCase):
    """Only an exact host in ALLOWED_LITERALS is exempt from the denied-term check.

    The guard ships with none; these cases run a copy with ALLOWED_HOST in it.
    """

    def setUp(self):
        super().setUp()
        self.terms.write_text(NAME + "\n", encoding="utf-8")
        src = GUARD.read_text(encoding="utf-8")
        self.assertEqual(src.count(SHIPPED), 1)
        self.with_host = self.tmp / "guardia_con_host.py"
        self.with_host.write_text(src.replace(SHIPPED, f'ALLOWED_LITERALS = ("{ALLOWED_HOST}",)'), encoding="utf-8")

    def run_case(self, name, files, script=None):
        self.tree = self.tmp / name
        self.tree.mkdir()
        for rel, content in files.items():
            self.write(rel, content)
        return self.run_guard(script=script or self.with_host)

    def test_the_shipped_guard_allows_no_host(self):
        res = self.run_case("shipped", {"a.txt": ALLOWED_HOST + "\n"}, script=GUARD)
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertEqual(res.stdout.splitlines(), [f"a.txt:1: {TERM_HIT}"])

    def test_allowed_url_alone_passes(self):
        cases = {
            "js": {"etiqueta-core.js": f'export const READER_URL = "https://{ALLOWED_HOST}/leer";\n'},
            "bare": {"a.txt": ALLOWED_HOST + "\n"},
            "trailing-dot": {"a.md": f"Servidor: https://{ALLOWED_HOST}.\n"},
            "port": {"a.txt": f"({ALLOWED_HOST}:443)\n"},
            "svg": {"a.svg": f"<svg><title>{ALLOWED_HOST}</title></svg>\n"},
        }
        for name, files in cases.items():
            with self.subTest(name):
                res = self.run_case(name, files)
                self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
                self.assertEqual(res.stdout.splitlines(), ["guardia: sin hallazgos en 1 archivos"])

    def test_name_outside_allowed_host_is_still_a_hit(self):
        cases = {
            "alone": ("a.txt", NAME + "\n", []),
            "email": ("a.txt", NAME + "@example.org\n", ["correo electrónico"]),
            "other-sub": ("a.txt", f"https://other-sub.{NAME}.workers.dev/\n", []),
            "evil-suffix": ("a.txt", f"https://{ALLOWED_HOST}.evil.com/\n", []),
            "hyphen-suffix": ("a.txt", ALLOWED_HOST + "-x\n", []),
            "alnum-suffix": ("a.txt", ALLOWED_HOST + "x\n", []),
            "double-dot": ("a.txt", ALLOWED_HOST + "..x\n", []),
            "dot-prefix": ("a.txt", "https://a." + ALLOWED_HOST + "\n", []),
            "alnum-prefix": ("a.txt", "x" + ALLOWED_HOST + "\n", []),
            "userinfo": ("a.txt", "https://u@" + ALLOWED_HOST + "\n", ["correo electrónico"]),
            "uppercase": ("a.txt", ALLOWED_HOST.upper() + "\n", []),
            "accented": ("a.txt", ALLOWED_HOST.replace("nombre", "nómbre") + "\n", []),
            "fullwidth": ("a.txt", "\uff4c" + ALLOWED_HOST[1:] + "\n", []),
            "combining": ("a.txt", ALLOWED_HOST + "\u0301\n", []),
            "svg": ("a.svg", f"<svg><title>{NAME}</title></svg>\n", []),
            "json": ("a.json", f'{{"autor": "{NAME}"}}\n', []),
        }
        for name, (rel, content, generic) in cases.items():
            with self.subTest(name):
                res = self.run_case(name, {rel: content})
                self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
                expected = [f"{rel}:1: {label}" for label in generic] + [f"{rel}:1: {TERM_HIT}"]
                self.assertEqual(res.stdout.splitlines(), expected)

    def test_allowed_url_does_not_hide_other_occurrences(self):
        res = self.run_case("mixed", {
            "a.js": f'const U = "https://{ALLOWED_HOST}/leer";\n// {NAME}\n',
            "b.txt": f"https://{ALLOWED_HOST} y {NAME}\n",
        })
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertEqual(res.stdout.splitlines(), [f"a.js:2: {TERM_HIT}", f"b.txt:1: {TERM_HIT}"])

    def test_allowance_does_not_cover_file_names(self):
        res = self.run_case("names", {ALLOWED_HOST + ".txt": "limpio\n"})
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertEqual(res.stdout.splitlines(), [f"{ALLOWED_HOST}.txt:0: término prohibido en el nombre: {NAME}"])

    def test_allowance_does_not_cover_png_text_chunks(self):
        res = self.run_case("png", {"t.png": png(chunk(b"tEXt", b"Source\x00" + ALLOWED_HOST.encode()))})
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertEqual(res.stdout.splitlines(), ["t.png:0: metadatos PNG, chunk tEXt en el byte 33"])

    def test_allowance_is_not_configurable_from_the_cli(self):
        self.write("a.txt", "limpio\n")
        for flag in ("--permitir", "--allowed"):
            with self.subTest(flag):
                res = self.run_guard(flag, "x")
                self.assertEqual(res.returncode, 2, res.stdout + res.stderr)


class GenericPatterns(GuardCase):
    def test_email(self):
        self.write("a.md", "hola\nescribe a alguien.mas" + "@example.org\n")
        self.assertHit(self.run_guard(), "a.md:2", "correo")

    def test_national_id_dotted_and_plain(self):
        self.write("a.txt", "id 12.345.678" + "-9\n")
        self.write("b.txt", "\n\n12345678" + "-K\n")
        res = self.run_guard()
        self.assertHit(res, "a.txt:1", "identidad")
        self.assertHit(res, "b.txt:3", "identidad")

    def test_phone(self):
        self.write("a.txt", "fono +56 9 1234" + " 5678\n")
        self.write("b.txt", "x\n+5691234" + "5678\n")
        res = self.run_guard()
        self.assertHit(res, "a.txt:1", "teléfono")
        self.assertHit(res, "b.txt:2", "teléfono")

    def test_ordinary_numbers_are_not_hits(self):
        self.write("a.txt", 'var VERSION = "pauta-v2"; 2031-11-18 4 tiempos 512x512\n')
        self.assertEqual(self.run_guard().returncode, 0)


class Files(GuardCase):
    def test_binary_not_allowed(self):
        self.write("data.bin", b"\x00\x01\x02binary")
        self.assertHit(self.run_guard(), "data.bin:0", "binario")

    def test_binary_with_allowed_extension_is_fine(self):
        self.write("favicon.ico", b"\x00\x00\x01\x00")
        self.assertEqual(self.run_guard().returncode, 0)

    def test_file_over_1mb(self):
        self.write("big.txt", "a" * (1024 * 1024 + 1))
        self.assertHit(self.run_guard(), "big.txt:0", "1 MB")

    def test_png_text_chunks(self):
        self.write("t.png", png(chunk(b"tEXt", b"Author\x00someone")))
        self.write("i.png", png(chunk(b"iTXt", b"Comment\x00\x00\x00\x00\x00hi")))
        self.write("z.png", png(chunk(b"zTXt", b"Comment\x00\x00" + zlib.compress(b"hi"))))
        res = self.run_guard()
        for name, kind in (("t.png", "tEXt"), ("i.png", "iTXt"), ("z.png", "zTXt")):
            self.assertHit(res, name + ":0", kind)

    def test_png_exif_chunk(self):
        self.write("e.png", png(chunk(b"eXIf", b"MM\x00*\x00\x00\x00\x08")))
        self.assertHit(self.run_guard(), "e.png:0", "eXIf")

    def test_limpiar_png_strips_metadata_and_keeps_image(self):
        path = self.write("e.png", png(chunk(b"tEXt", b"A\x00b"), chunk(b"eXIf", b"MM"), chunk(b"tIME", b"\x07\xea\x0b\x12\x00\x00\x00")))
        res = self.run_guard("--limpiar-png", terms=False)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("e.png", res.stdout)
        self.assertEqual(chunk_types(path.read_bytes()), [b"IHDR", b"IDAT", b"IEND"])
        self.assertEqual(self.run_guard().returncode, 0)


class MissingPrivateList(GuardCase):
    def setUp(self):
        super().setUp()
        self.public = self.tmp / "public" / "tools"
        self.public.mkdir(parents=True)
        self.script = self.public / "guardia_sensible.py"
        shutil.copy(GUARD, self.script)

    def test_clean_tree_passes_and_reports_skip(self):
        self.write("a.txt", "privado pero sin lista\n")
        res = self.run_guard(script=self.script, terms=False)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("lista privada", res.stderr)
        self.assertIn("se omite", res.stderr)

    def test_generic_checks_still_run(self):
        self.write("a.txt", "x\ncontacto" + "@example.org\n")
        res = self.run_guard(script=self.script, terms=False)
        self.assertIn("se omite", res.stderr)
        self.assertHit(res, "a.txt:2", "correo")

    def test_explicit_missing_list_also_skips(self):
        self.write("a.txt", "limpio\n")
        res = subprocess.run([sys.executable, "-I", str(GUARD), "--terminos", str(self.tmp / "no-existe.txt"), str(self.tree)],
                             capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("se omite", res.stderr)


class Usage(GuardCase):
    def test_missing_dir_is_usage_error(self):
        res = subprocess.run([sys.executable, "-I", str(GUARD), str(self.tmp / "nope")], capture_output=True, text=True)
        self.assertEqual(res.returncode, 2)


if __name__ == "__main__":
    unittest.main()
