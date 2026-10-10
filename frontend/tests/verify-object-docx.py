"""Structural verification of the offline all-zone DOCX browser fixture."""
import sys
import zipfile
import xml.etree.ElementTree as ET
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    document = ET.fromstring(archive.read('word/document.xml'))
    text = '\n'.join(node.text or '' for node in document.findall('.//w:t', ns))
    for expected in ['Z1', 'Z2', 'Z3', 'Z4', 'Экспресс-сводка', 'Сводная ведомость', 'Фототаблица', 'Подпись:']:
        assert expected in text, expected
    assert 'Отклонение от предварительного профиля' in text
    assert '5.1.7' in text and '6.1.5' in text
    images = document.findall('.//wp:extent', ns)
    assert len(images) == 4
    assert all(abs(int(image.attrib['cx']) / int(image.attrib['cy']) - 2) < 0.01 for image in images)
    # Binary-identical fixture photos may share one embedded media asset.
    media = [name for name in archive.namelist() if name.startswith('word/media/') and name.endswith('.png')]
    assert media and all(archive.read(name).startswith(b'\x89PNG\r\n\x1a\n') for name in media)
    tables = document.findall('.//w:tbl', ns)
    photo_table = next(table for table in tables if table.findall('.//wp:extent', ns))
    assert len(photo_table.findall('./w:tr', ns)) == 2
    assert all(len(row.findall('./w:tc', ns)) == 2 for row in photo_table.findall('./w:tr', ns))
    footer = archive.read('word/footer1.xml').decode()
    assert 'PAGE' in footer and 'NUMPAGES' in footer
    body = document.find('w:body', ns)
    assert body[0].find('./w:pPr/w:pageBreakBefore', ns) is None
    assert not document.findall('.//w:br[@w:type="page"]', ns)
print('PASS object DOCX: all zones, defect table, four proportional photos in two columns, page numbering, no forced empty pages')
