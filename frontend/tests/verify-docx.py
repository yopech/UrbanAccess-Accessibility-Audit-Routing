import sys
import zipfile
import xml.etree.ElementTree as ET
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    root = ET.fromstring(archive.read('word/document.xml'))
    texts = [node.text or '' for node in root.findall('.//w:t', ns)]
    assert 'Черновик. Фрагмент обследования: Входная группа Z2' in texts
    assert '900 мм' in texts and '90 см' in texts and '0 см' in texts
    assert any('Проверено экспертом' in text for text in texts)
    assert 'Замер ширины входной двери' in texts and 'Новая подпись' not in texts
    assert len(root.findall('.//w:tbl', ns)) >= 5
    assert root.findall('.//w:tblBorders', ns) and root.findall('.//w:tblHeader', ns)
    assert all(el.attrib.get('{'+ns['w']+'}ascii') == 'Arial' for el in root.findall('.//w:rFonts', ns))
    extent = root.find('.//wp:extent', ns)
    assert abs(int(extent.attrib['cx']) / int(extent.attrib['cy']) - 1.5) < 0.01
    media = [name for name in archive.namelist() if name.startswith('word/media/') and name.endswith('.png')]
    assert len(media) == 1 and archive.read(media[0]).startswith(b'\x89PNG\r\n\x1a\n')
    relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
    image_relations = [r for r in relationships if r.attrib['Type'].endswith('/image') and r.attrib.get('TargetMode') != 'External']
    assert image_relations
    for relationship in image_relations:
        assert 'word/'+relationship.attrib['Target'].lstrip('./') in archive.namelist()
print('PASS DOCX ZIP/XML: Cyrillic, Z2 marking, grid, repeated headers, measurements, embedded PNG and aspect ratio')
