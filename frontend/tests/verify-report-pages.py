"""Run with bundled Python after DOCX render to verify physical pagination."""
import sys
import re
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
assert reader.pages
for number, page in enumerate(reader.pages, 1):
    # Footer alone must never make an otherwise empty page pass.
    content = re.sub(r'Страница\s+\d+\s+из\s+\d+', '', page.extract_text()).strip()
    assert len(content) > 20, f'Пустая страница {number}'
    assert abs(float(page.mediabox.width) - 595.3) < 2
    assert abs(float(page.mediabox.height) - 841.9) < 2
print(f'PASS rendered report: {len(reader.pages)} A4 pages, no empty pages')
