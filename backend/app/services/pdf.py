"""A tiny PDF writer (standard library only): text pages with headings, wrapping and page breaks.

Uses the built-in Helvetica fonts (WinAnsi), so text is limited to Latin-1;
anything else is replaced. Enough for a clean, printable dispute summary.
"""

from __future__ import annotations

import textwrap

PAGE_W, PAGE_H = 595, 842  # A4 in points
MARGIN = 56
LINE = {"h1": 22, "h2": 17, "p": 14, "small": 12, "mono": 12}
SIZE = {"h1": 17, "h2": 12.5, "p": 10.5, "small": 8.5, "mono": 8.5}
FONT = {"h1": "F2", "h2": "F2", "p": "F1", "small": "F1", "mono": "F3"}
WRAP = {"h1": 55, "h2": 75, "p": 95, "small": 115, "mono": 100}


def _safe(text: str) -> str:
    text = text.replace("₹", "Rs ").replace("—", "-").replace("–", "-").replace("→", "->")
    text = text.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'").replace("•", "-")
    text = text.encode("latin-1", "replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PdfDoc:
    def __init__(self) -> None:
        self.pages: list[list[str]] = [[]]
        self.y = PAGE_H - MARGIN

    def _ensure(self, height: float) -> None:
        if self.y - height < MARGIN:
            self.pages.append([])
            self.y = PAGE_H - MARGIN

    def text(self, text: str, style: str = "p", gap_before: float = 0) -> None:
        self.y -= gap_before
        for para in (text or "").split("\n"):
            for line in textwrap.wrap(para, WRAP[style]) or [""]:
                self._ensure(LINE[style])
                self.y -= LINE[style]
                self.pages[-1].append(
                    f"BT /{FONT[style]} {SIZE[style]} Tf {MARGIN} {self.y:.1f} Td ({_safe(line)}) Tj ET")

    def row(self, label: str, value: str) -> None:
        lines = textwrap.wrap(value or "-", 70) or ["-"]
        for i, line in enumerate(lines):
            self._ensure(LINE["p"])
            self.y -= LINE["p"]
            if i == 0:
                self.pages[-1].append(f"BT /F2 {SIZE['p']} Tf {MARGIN} {self.y:.1f} Td ({_safe(label)}) Tj ET")
            self.pages[-1].append(f"BT /F1 {SIZE['p']} Tf {MARGIN + 140} {self.y:.1f} Td ({_safe(line)}) Tj ET")

    def rule(self, gap: float = 8) -> None:
        self._ensure(gap * 2)
        self.y -= gap
        self.pages[-1].append(f"0.8 G 0.5 w {MARGIN} {self.y:.1f} m {PAGE_W - MARGIN} {self.y:.1f} l S 0 G")
        self.y -= gap

    def render(self, footer: str = "") -> bytes:
        objects: list[bytes] = []

        def add(body: str | bytes) -> int:
            objects.append(body.encode("latin-1") if isinstance(body, str) else body)
            return len(objects)

        catalog = add("")  # placeholder, filled below
        pages_id = add("")
        f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")
        kids = []
        total = len(self.pages)
        for n, ops in enumerate(self.pages, start=1):
            foot = f"{footer}  -  page {n} of {total}" if footer else f"page {n} of {total}"
            ops = ops + [f"BT /F1 8 Tf {MARGIN} 30 Td ({_safe(foot)}) Tj ET"]
            stream = "\n".join(ops).encode("latin-1")
            content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
            kids.append(add(
                f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                f"/Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R /F3 {f3} 0 R >> >> /Contents {content} 0 R >>"))
        objects[catalog - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()
        objects[pages_id - 1] = (f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] "
                                 f"/Count {len(kids)} >>").encode()

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
        out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
        out += f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)
