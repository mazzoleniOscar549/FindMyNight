from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"
MAIN = ROOT / "main.js"


INLINE_SCRIPT_RE = re.compile(
    r"<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)</script>", flags=re.I
)
LD_JSON_RE = re.compile(r"type\s*=\s*['\"]application/ld\+json['\"]", flags=re.I)


def extract_inline_scripts(html: str) -> list[str]:
    out: list[str] = []
    for m in INLINE_SCRIPT_RE.finditer(html):
        attrs = m.group(1) or ""
        body = (m.group(2) or "").strip("\n")
        if LD_JSON_RE.search(attrs):
            continue
        if not body.strip():
            continue
        out.append(body)
    return out


def strip_inline_scripts_keep_ld_json(html: str) -> str:
    def repl(m: re.Match[str]) -> str:
        attrs = m.group(1) or ""
        return m.group(0) if LD_JSON_RE.search(attrs) else ""

    return INLINE_SCRIPT_RE.sub(repl, html)


def ensure_defer_for_script_src(html: str, src: str) -> str:
    # Adds defer to the opening <script ... src="..."> if not already present.
    pat = re.compile(rf'(<script\s+[^>]*\bsrc="{re.escape(src)}")(?![^>]*\bdefer\b)', flags=re.I)
    return pat.sub(r"\1 defer", html)


def insert_main_js(html: str) -> str:
    if 'src="main.js"' in html:
        return html
    return re.sub(
        r'(<script\s+[^>]*\bsrc="fmn-secrets\.defaults\.js"[^>]*></script>)',
        r'\1' + "\n\n" + '    <script src="main.js" defer></script>',
        html,
        count=1,
        flags=re.I,
    )


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")

    scripts = extract_inline_scripts(html)
    js = ("\n\n".join(scripts)).strip() + "\n"
    MAIN.write_text(js, encoding="utf-8")

    html2 = strip_inline_scripts_keep_ld_json(html)

    # Enforce defer on Leaflet + Firebase scripts
    html2 = ensure_defer_for_script_src(html2, "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js")
    html2 = ensure_defer_for_script_src(html2, "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js")
    html2 = ensure_defer_for_script_src(html2, "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js")
    html2 = ensure_defer_for_script_src(html2, "fmn-firebase-public.js")
    html2 = ensure_defer_for_script_src(html2, "fmn-secrets.defaults.js")

    html2 = insert_main_js(html2)

    INDEX.write_text(html2, encoding="utf-8")


if __name__ == "__main__":
    main()

