import { Document, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Packer, HeadingLevel, WidthType, BorderStyle, TableLayoutType, AlignmentType, Footer, PageNumber } from 'docx';
import { validateDocumentSnapshot, type DocumentSnapshot } from './act-draft.js';
import type { Photo } from '../media/photo-contract.js';
function evidencePhoto(snapshot: DocumentSnapshot, photos: readonly Photo[], id: string): Photo {
  const evidence = snapshot.evidence.find((item) => item.photoId === id); const photo = photos.find((item) => item.id === id);
  if (!evidence || !photo || photo.sha256 !== evidence.sha256 || photo.width !== evidence.width || photo.height !== evidence.height) throw new Error('Фото этой редакции недоступно. Экспорт остановлен.');
  return photo;
}
export function fitImage(width: number, height: number, maxWidth = 610, maxHeight = 420): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height); return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
function paragraph(text: string, bold = false): Paragraph {
  return new Paragraph({ children: text.split('\n').map((part, i) => new TextRun({ text: part, bold, font: 'Arial', size: 22, ...(i ? { break: 1 } : {}) })), spacing: { after: 140 } });
}
async function imageBytes(photo: Photo): Promise<{ type: 'jpg' | 'png'; data: Uint8Array }> {
  if (photo.mime !== 'image/webp') return { type: photo.mime === 'image/png' ? 'png' : 'jpg', data: new Uint8Array(await photo.blob.arrayBuffer()) };
  const bitmap = await createImageBitmap(photo.blob); const canvas = document.createElement('canvas');
  try { canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d'); if (!context) throw new Error('Не удалось подготовить фото для DOCX.'); context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Не удалось преобразовать фото.')), 'image/png'));
    return { type: 'png', data: new Uint8Array(await blob.arrayBuffer()) };
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
export async function exportActDocx(snapshot: DocumentSnapshot, photos: readonly Photo[]): Promise<Blob> {
  validateDocumentSnapshot(snapshot); const children: (Paragraph | Table)[] = [];
  for (let index = 0; index < snapshot.blocks.length; index++) {
    const block = snapshot.blocks[index]!;
    if (block.kind === 'heading') children.push(new Paragraph({ text: block.text, heading: block.level === 1 ? HeadingLevel.TITLE : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, keepNext: true, ...(block.pageBreakBefore && index > 0 ? {pageBreakBefore:true} : {}), spacing: { before: 180, after: 160 } }));
    else if (block.kind === 'paragraph') children.push(paragraph(block.text));
    else if (block.kind === 'table') {
      const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }; const width = 10204; const columns = block.rows[0]!.length;
      children.push(new Table({ width: { size: width, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
        columnWidths: columns === 5 ? [460,1800,3000,1500,3444] : Array.from({length:columns},()=>Math.floor(width / columns)), borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, cantSplit: true, children: row.map((text) => new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, ...(index === 0 ? { shading: { fill: 'E8E8E8' } } : {}), children: [new Paragraph({ children: text.split('\n').map((part, line) => new TextRun({ text: part, bold: index === 0, font: 'Arial', size: 22, ...(line ? { break: 1 } : {}) })), spacing: { after: 0, line: 264 } })] })) })) }));
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
    } else {
      const photoRows: TableRow[] = [];
      while (snapshot.blocks[index]?.kind === 'photo') {
        const cells: TableCell[] = [];
        for (let column = 0; column < 2; column++) {
          const item = snapshot.blocks[index];
          if (item?.kind !== 'photo') { cells.push(new TableCell({children:[new Paragraph('')]})); continue; }
          const photo = evidencePhoto(snapshot, photos, item.photoId);
          cells.push(new TableCell({margins:{top:120,bottom:120,left:120,right:120},children:[
            new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({...await imageBytes(photo),transformation:fitImage(photo.width,photo.height,295,310),altText:{title:item.label,description:item.caption||item.label,name:item.photoId}})],keepNext:true}),
            paragraph(item.label,true), ...(item.caption ? [paragraph(item.caption)] : []),
          ]})); index++;
        }
        photoRows.push(new TableRow({cantSplit:true,children:cells}));
      }
      index--;
      const border = {style:BorderStyle.SINGLE,size:4,color:'777777'};
      children.push(new Table({width:{size:10204,type:WidthType.DXA},layout:TableLayoutType.FIXED,columnWidths:[5102,5102],borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:photoRows}));
      children.push(new Paragraph({text:'',spacing:{after:0,line:20}}));
    }
  }
  const document = new Document({ creator: 'UrbanAccess', title: snapshot.scopeLabel, description: `Обследование ${snapshot.auditId}, редакция ${snapshot.auditRevision}`,
    styles: { default: { document: { run: { font: 'Arial', size: 22, color: '000000' }, paragraph: { spacing: { line: 276 } } },
      title: { run: { font: 'Arial', size: 30, bold: true, color: '000000' } }, heading2: { run: { font: 'Arial', size: 26, bold: true, color: '000000' } }, heading3: { run: { font: 'Arial', size: 24, bold: true, color: '000000' } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 851, right: 851, bottom: 851, left: 851 } } }, footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'Страница ',font:'Arial',size:18}),new TextRun({children:[PageNumber.CURRENT]}),new TextRun({text:' из '}),new TextRun({children:[PageNumber.TOTAL_PAGES]})]})]})}, children }] });
  return Packer.toBlob(document);
}
const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function renderPrintHtml(snapshot: DocumentSnapshot, photoURLs: ReadonlyMap<string, string>): string {
  validateDocumentSnapshot(snapshot);
  const parts: string[] = [];
  for (let index=0; index<snapshot.blocks.length;index++) {
    const block=snapshot.blocks[index]!;
    if (block.kind==='heading') parts.push(`<h${block.level}${block.pageBreakBefore && index > 0 ? ' class="new-section"' : ''}>${escape(block.text)}</h${block.level}>`);
    else if (block.kind==='paragraph') parts.push(`<p>${escape(block.text).replace(/\n/g,'<br>')}</p>`);
    else if (block.kind==='table') parts.push(`<table><thead><tr>${block.rows[0]!.map(text=>`<th>${escape(text)}</th>`).join('')}</tr></thead><tbody>${block.rows.slice(1).map(row=>`<tr>${row.map(text=>`<td>${escape(text).replace(/\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    else {
      const figures: string[]=[];
      while(snapshot.blocks[index]?.kind==='photo') {
        const item=snapshot.blocks[index]!; if(item.kind!=='photo') break;
        const url=photoURLs.get(item.photoId);if(!url || !url.startsWith('blob:'))throw new Error('Фото для печати не загружено.');
        figures.push(`<figure><img src="${escape(url)}" alt="${escape(item.caption || item.label)}"><figcaption><strong>${escape(item.label)}</strong>${item.caption ? '<br>'+escape(item.caption) : ''}</figcaption></figure>`);index++;
      }
      index--; parts.push(`<div class="photo-table">${figures.join('')}</div>`);
    }
  }
  const body=parts.join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(snapshot.scopeLabel)}</title><style>
    @page { size: A4; margin: 15mm; } * { box-sizing: border-box; } body { margin: 0; color: #000; background: #fff; font: 11pt/1.35 Arial, sans-serif; overflow-wrap: anywhere; }
    main { max-width: 180mm; margin: auto; } h1 { font-size: 16pt; } h2 { font-size: 13pt; } h1,h2,h3 { break-after: avoid; } p { margin: 0 0 3mm; white-space: normal; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 3mm 0 5mm; } td,th { border: 1px solid #d9d9d9; padding: 2mm; text-align: left; vertical-align: middle; } th { background: #e8e8e8; } thead { display: table-header-group; }
    .photo-table { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4mm; } tr { break-inside: avoid; } figure { border: 1px solid #777; padding: 3mm; margin: 0; break-inside: avoid; } img { display: block; max-width: 100%; max-height: 82mm; width: auto; height: auto; margin: auto; } figcaption { margin-top: 2mm; }
    @media screen { body { padding: 16px; } } @media print { body { padding: 0; } .new-section { break-before: page; } nav,button,[data-no-print] { display:none !important; } }
  </style></head><body><main>${body}</main></body></html>`;
}
export function downloadAct(blob: Blob, snapshot: DocumentSnapshot): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `UrbanAccess-${snapshot.template.id === 'urbanaccess-z2' ? 'Z2' : 'object'}-r${snapshot.auditRevision}-${snapshot.id.slice(0, 8)}.docx`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
