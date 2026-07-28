#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
docs = sorted((root / "docs").glob("[0-9][0-9]-*.md"))
header = """# 南加生活网完整网站架构书\n\n> 本文件由 `scripts/generate-architecture-book.py` 从 `docs/00-*.md` 至 `docs/30-*.md` 合并生成。分章节文件是维护事实源。\n\n"""
parts = [header]
for path in docs:
    parts.append(f"\n---\n\n<!-- source: {path.relative_to(root)} -->\n\n")
    chapter = path.read_text(encoding="utf-8").strip()
    chapter = re.sub(r"\]\(\./([^)]+)\)", r"](./docs/\1)", chapter)
    parts.append(chapter)
    parts.append("\n")
with (root / "ARCHITECTURE_BOOK.md").open("w", encoding="utf-8", newline="\n") as output:
    output.write("".join(parts))
print(f"Generated ARCHITECTURE_BOOK.md from {len(docs)} chapters")
