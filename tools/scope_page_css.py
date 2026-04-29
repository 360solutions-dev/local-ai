#!/usr/bin/env python3
"""Extract <style> from each static HTML page and scope `body` rules to `.page-<slug>`."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "images"
OUT = ROOT / "frontend" / "styles" / "pages"

PAGES = [
    ("login", "login.html"),
    ("dashboard", "dashboard.html"),
    ("chat", "chat.html"),
    ("settings", "settings.html"),
    ("onboarding", "onboarding.html"),
    ("model-engines", "model-engines.html"),
    ("text-to-audio", "text-to-audio.html"),
]


def scope_css(css: str, slug: str) -> str:
    scoped = css
    # Longest match first
    scoped = re.sub(r"\bbody::before\b", f".page-{slug}::before", scoped)
    scoped = re.sub(r"\bbody::after\b", f".page-{slug}::after", scoped)
    scoped = re.sub(r"\bbody\s*\{", f".page-{slug} {{", scoped)
    # Wire next/font CSS variables (see app/layout.tsx)
    scoped = scoped.replace(
        "--font-body: 'Outfit', sans-serif",
        "--font-body: var(--font-outfit), 'Outfit', sans-serif",
    )
    scoped = scoped.replace(
        "--font-mono: 'JetBrains Mono', monospace",
        "--font-mono: var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
    )
    return scoped


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, filename in PAGES:
        raw = (IMAGES / filename).read_text(encoding="utf-8")
        m = re.search(r"<style>(.*?)</style>", raw, re.DOTALL | re.IGNORECASE)
        if not m:
            raise SystemExit(f"No <style> in {filename}")
        css = scope_css(m.group(1).strip(), slug)
        (OUT / f"{slug}.css").write_text(css + "\n", encoding="utf-8")
        print(f"Wrote styles/pages/{slug}.css")


if __name__ == "__main__":
    main()
