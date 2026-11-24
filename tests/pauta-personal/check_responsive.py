"""Static checks for the responsive hub layout of pauta-personal/ (S19).

Both pages open on a hub of tiles and show one section per screen. This script
checks what can be checked without a browser:

- both pages have a viewport meta tag that allows safe-area insets;
- the hub (id="inicio") links to every section;
- every section has a "Volver al inicio" link to the hub and Anterior/Siguiente
  links to its neighbours in page order;
- no container in the CSS has a fixed width wider than a 360 px phone, and no
  navigation hides its links in a sideways-scrolling strip;
- the CSS uses fluid type, safe-area insets and reduced motion, and draws no
  icons from image files (icons are inline SVG);
- the service worker caches every file of the page under a new version, and
  leaves requests to other origins (the label reader) to the network only,
  and only puts correct answers (status 200, this site's own) in the cache;
- the «Leer una etiqueta» and «Mi despensa» pages (one screen, no hub) have
  the same viewport, breadcrumbs and «Volver al inicio» link, and both hubs or
  navs link to them.

Usage: python3 -I tests/pauta-personal/check_responsive.py pauta-personal
"""
import os
import re
import sys
from html.parser import HTMLParser

PAGES = ["index.html", "registro.html"]
# Pages with a single screen and no hub of tiles.
SINGLE = ["etiqueta.html", "despensa.html"]
CSS = ["styles.css", "registro.css", "etiqueta.css", "despensa.css"]
VERSION = "pauta-v1"
HUB = "inicio"

# The largest text step (A+) is 1.5 x 19 px. A width in rem or em that is wider
# than a 360 px phone at that size is a fixed width.
MAX_ROOT_PX = 19 * 1.5
PHONE_PX = 360
# Rules inside a media or container query that only applies from this width up
# may be wider.
WIDE_QUERY_PX = 600


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.viewport = None
        self.sections = []  # ids, in order
        self.links = []  # (section id or None, inside hub, href, text)
        self.stack = []  # open (tag, section id, hub flag)
        self.imgs = 0
        self._a = None

    def _where(self):
        sec = next((s for _, s, _ in reversed(self.stack) if s), None)
        hub = any(h for _, _, h in self.stack)
        return sec, hub

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "viewport":
            self.viewport = a.get("content", "")
        if tag == "img":
            self.imgs += 1
        if tag in ("meta", "link", "input", "br", "img", "use", "path", "circle", "rect"):
            return
        sec = a.get("id") if tag == "section" and a.get("id") else None
        if sec:
            self.sections.append(sec)
        self.stack.append((tag, sec, a.get("id") == HUB))
        if tag == "a":
            self._a = [a.get("href") or "", []]

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "viewport":
            self.viewport = a.get("content", "")

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            sec, hub = self._where()
            text = re.sub(r"\s+", " ", "".join(self._a[1])).strip()
            self.links.append((sec, hub, self._a[0], text))
            self._a = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self._a is not None:
            self._a[1].append(data)


def check_page(name, html):
    problems = []
    page = Page()
    page.feed(html)
    vp = page.viewport or ""
    if "width=device-width" not in vp:
        problems.append(f"{name}: NO VIEWPORT META with width=device-width")
    if "viewport-fit=cover" not in vp:
        problems.append(f"{name}: VIEWPORT without viewport-fit=cover (safe-area insets)")
    if page.imgs:
        problems.append(f"{name}: {page.imgs} <img> (icons must be inline SVG)")
    if f'id="{HUB}"' not in html:
        problems.append(f"{name}: NO HUB (id=\"{HUB}\")")
    secs = page.sections
    for i, s in enumerate(secs):
        hub_links = [l for l in page.links if l[1] and l[2] == f"#{s}"]
        if not hub_links:
            problems.append(f"{name}: HUB has no tile for #{s}")
        own = [l for l in page.links if l[0] == s]
        if not any(l[2] == f"#{HUB}" and "volver" in l[3].lower() for l in own):
            problems.append(f"{name}: SECTION #{s} has no «Volver» link to #{HUB}")
        if i > 0 and not any(l[2] == f"#{secs[i - 1]}" and l[3].startswith("Anterior") for l in own):
            problems.append(f"{name}: SECTION #{s} has no «Anterior» link to #{secs[i - 1]}")
        if i < len(secs) - 1 and not any(l[2] == f"#{secs[i + 1]}" and l[3].startswith("Siguiente") for l in own):
            problems.append(f"{name}: SECTION #{s} has no «Siguiente» link to #{secs[i + 1]}")
    return problems, len(secs)


def check_single(name, html):
    """A one-screen page: same viewport rules, breadcrumbs and a way back to the pauta."""
    problems = []
    page = Page()
    page.feed(html)
    vp = page.viewport or ""
    if "width=device-width" not in vp:
        problems.append(f"{name}: NO VIEWPORT META with width=device-width")
    if "viewport-fit=cover" not in vp:
        problems.append(f"{name}: VIEWPORT without viewport-fit=cover (safe-area insets)")
    if page.imgs:
        problems.append(f"{name}: {page.imgs} <img> (icons must be inline SVG)")
    if 'class="crumbs"' not in html:
        problems.append(f"{name}: NO BREADCRUMBS")
    if not any(l[2].startswith("index.html") and "volver" in l[3].lower() for l in page.links):
        problems.append(f"{name}: no «Volver» link to index.html")
    if 'id="smaller"' not in html or 'id="bigger"' not in html:
        problems.append(f"{name}: no A−/A+ buttons")
    return problems


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def blocks(css):
    """Yields (selector, body, wide) for each rule; wide = inside a min-width query >= WIDE_QUERY_PX."""
    out = []

    def walk(text, wide):
        i = 0
        while i < len(text):
            j = text.find("{", i)
            if j < 0:
                break
            head = text[i:j].strip()
            depth, k = 1, j + 1
            while k < len(text) and depth:
                depth += {"{": 1, "}": -1}.get(text[k], 0)
                k += 1
            body = text[j + 1:k - 1]
            if head.startswith("@"):
                m = re.search(r"min-width:\s*([\d.]+)(px|rem|em)", head)
                w = wide
                if m:
                    px = float(m.group(1)) * (16 if m.group(2) != "px" else 1)
                    w = wide or px >= WIDE_QUERY_PX
                walk(body, w)
            else:
                out.append((head, body, wide))
            i = k

    walk(css, False)
    return out


def to_px(value, unit):
    v = float(value)
    return v if unit == "px" else v * MAX_ROOT_PX


def check_css(name, css):
    problems = []
    css = strip_comments(css)
    for sel, body, wide in blocks(css):
        if wide:
            continue
        for prop, val in re.findall(r"(?<![-\w])(width|min-width|flex-basis|flex)\s*:\s*([^;]+)", body):
            if "min(" in val or "clamp(" in val:
                continue
            for num, unit in re.findall(r"([\d.]+)(px|rem|em)\b", val):
                if to_px(num, unit) > PHONE_PX:
                    problems.append(f"{name}: FIXED WIDTH {prop}: {val.strip()} in «{sel}»")
        for m in re.finditer(r"minmax\(\s*([\d.]+)(px|rem|em)", body):
            if to_px(m.group(1), m.group(2)) > PHONE_PX:
                problems.append(f"{name}: FIXED GRID COLUMN minmax({m.group(1)}{m.group(2)}, …) in «{sel}»")
        if re.search(r"\b(nav|menu)\b", sel) and re.search(r"overflow-x\s*:\s*(auto|scroll)", body):
            problems.append(f"{name}: NAV hides links in a sideways-scrolling strip («{sel}»)")
    if re.search(r"url\(\s*[\"']?(?!data:)[^)\"']+\.(svg|png|jpe?g|gif|webp)", css):
        problems.append(f"{name}: ICON from an image file (use inline SVG)")
    return problems


def main(root):
    problems = []
    counts = {}
    for p in PAGES:
        with open(os.path.join(root, p), encoding="utf-8") as fh:
            found, n = check_page(p, fh.read())
        problems += found
        counts[p] = n
        with open(os.path.join(root, p), encoding="utf-8") as fh:
            html = fh.read()
        for target, name in [("etiqueta.html", "Leer una etiqueta"), ("despensa.html", "Mi despensa")]:
            if f'href="{target}"' not in html:
                problems.append(f"{p}: no link to {target} («{name}»)")
    for p in SINGLE:
        if not os.path.isfile(os.path.join(root, p)):
            problems.append(f"{p}: missing")
            continue
        with open(os.path.join(root, p), encoding="utf-8") as fh:
            problems += check_single(p, fh.read())
    css_all = ""
    for c in CSS:
        if not os.path.isfile(os.path.join(root, c)):
            problems.append(f"{c}: missing")
            continue
        with open(os.path.join(root, c), encoding="utf-8") as fh:
            text = fh.read()
        css_all += text
        problems += check_css(c, text)
        if c == "despensa.css" and "prefers-reduced-motion" not in text:
            problems.append(f"{c}: no prefers-reduced-motion rule of its own")
    for need, what in [
        (r"font-size\s*:[^;]*clamp\(", "fluid type with clamp()"),
        (r"env\(\s*safe-area-inset-", "safe-area insets"),
        (r"prefers-reduced-motion", "a prefers-reduced-motion rule"),
        (r"[\d.]dvh\b", "dynamic viewport units (dvh)"),
        # The family member's received copy renders the same measurements
        # table as the doctor sheet, so it must also be a container that
        # stacks the table on narrow screens instead of scrolling sideways.
        (r"\.received\s*\{[^}]*container\s*:", "a size container on .received (stacked table in the received copy)"),
        (r":is\(\s*\.hoja\s*,\s*\.received\s*\)\s+tr\b", "the narrow-table rules applied to .received"),
    ]:
        if not re.search(need, css_all):
            problems.append(f"CSS: missing {what}")

    with open(os.path.join(root, "sw.js"), encoding="utf-8") as fh:
        sw = fh.read()
    if f'VERSION = "{VERSION}"' not in sw:
        problems.append(f'sw.js: VERSION is not "{VERSION}"')
    # Requests to another origin (the label reader) are never answered from or
    # written to the cache: the handler returns before respondWith.
    fetch_handler = sw.split('addEventListener("fetch"', 1)[1] if 'addEventListener("fetch"' in sw else ""
    before = fetch_handler.split("respondWith", 1)[0]
    if not re.search(r"origin\s*!==\s*self\.location\.origin[^;]*\)\s*return", before):
        problems.append("sw.js: requests to other origins are not left to the network")
    if not re.search(r'method\s*!==\s*"GET"\)\s*return', before):
        problems.append("sw.js: non-GET requests are not left to the network")
    # An error page, a partial or an opaque answer must never replace a good offline copy.
    for need, what in [(r"\.ok\b", "res.ok"), (r"status\s*===\s*200", "status === 200"), (r'type\s*===\s*"basic"', 'type === "basic"')]:
        if not re.search(need, sw):
            problems.append(f"sw.js: caches answers without checking {what}")
    cached = set(re.findall(r'"([^"]+\.[a-z]+)"', sw.split("FILES", 1)[1].split("]", 1)[0])) if "FILES" in sw else set()
    files = sorted(f for f in os.listdir(root) if os.path.isfile(os.path.join(root, f)) and f != "sw.js")
    uncached = [f for f in files if f not in cached]
    for f in uncached:
        problems.append(f"sw.js: {f} is not in the offline cache")

    for p in problems:
        print(p)
    print(
        "sections: " + ", ".join(f"{p} {counts[p]}" for p in PAGES) + "".join(f", {s} 1" for s in SINGLE)
        + f"; page problems: {sum(1 for p in problems if p.startswith(tuple(PAGES + SINGLE)))}"
        + f"; css problems: {sum(1 for p in problems if p.startswith(tuple(CSS)) or p.startswith('CSS'))}"
        + f"; offline cache: {len(files) - len(uncached)}/{len(files)} files"
        + f"; problems: {len(problems)}"
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
