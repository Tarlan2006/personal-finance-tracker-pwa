import { freedomRows, finishFreedomRows, type FreedomRow } from './freedom-pdf';
import { MAX_IMPORT_ROWS } from './import-limits';
import { getDocumentProxy } from 'unpdf';
import { HttpError } from '../../env';

/** Only layouts verified against the supplied bank PDFs. No OCR or remote fetch. */
export async function bankPdf(base64: string, bank: string): Promise<string> {
  if (base64.length > 2800000) throw new HttpError(413, 'file_too_large', 'PDF не больше 2 МБ');
  let data: Uint8Array;
  try { data = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); } catch { throw new HttpError(400, 'bad_pdf', 'Некорректный PDF'); }
  if (data.length > 2 * 1024 * 1024) throw new HttpError(413, 'file_too_large', 'PDF не больше 2 МБ');
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new HttpError(400, 'bad_pdf', 'Нужен PDF');
  let pdf;
  try { pdf = await getDocumentProxy(data, { verbosity: 0, maxImageSize: 0, useSystemFonts: false, useWorkerFetch: false }); } catch { throw new HttpError(400, 'bad_pdf', 'Не удалось прочитать PDF'); }
  try {
    if (pdf.numPages > 100) throw new HttpError(413, 'too_many_pages', 'Не больше 100 страниц');
    const rows: string[][] = []; const freedom: FreedomRow[] = []; let tables = 0; let signature = false;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p); const content = await page.getTextContent();
      const items = content.items.filter((t): t is typeof t & {str: string; transform: number[]} => 'str' in t);
      if (items.some(t => (bank === 'halyk' ? /halyk|халық|халык/i : bank === 'freedom' ? /freedom|фридом/i : /kaspi/i).test(t.str))) signature = true;
      if (items.length > 20000) throw new HttpError(413, 'pdf_too_complex', 'Слишком сложная страница PDF');
      if (bank === 'freedom') {
        if (items.some(t => t.str.trim() === 'Детали') || items.some(t => t.transform[4]<132 && /^\d{2}\.\d{2}\.\d{4}$/.test(t.str.trim()))) { freedom.push(...await freedomRows(page, items, MAX_IMPORT_ROWS*2-freedom.length, tables>0)); tables++; }
        else if(p>1) throw new HttpError(400,'unknown_layout','Страница Freedom без шапки таблицы');
        page.cleanup();continue;
      }
      const header = items.find(t => t.str.trim() === (bank === 'halyk' ? 'Transaction description' : 'Операция'));
      if (!header) { if (p > 1 && items.some(t => /^\d{2}\.\d{2}\.(?:\d{2}|\d{4})$/.test(t.str.trim()))) throw new HttpError(400, 'unknown_layout', 'Страница с операциями без известной шапки'); continue; }
      const deposit = items.some(t => t.str.trim() === 'Толық ақпарат');
      if (bank !== 'halyk' && (!items.some(t => t.str.trim() === (deposit ? 'Толық ақпарат' : 'Толығырақ')) || !items.some(t => t.str.trim() === 'Күні')))
        throw new HttpError(400, 'unknown_layout', 'Неизвестная таблица Kaspi');
      if (Math.abs(page.getViewport({scale: 1}).width - 595.3) > 2) throw new HttpError(400, 'unknown_layout', 'Неизвестный размер страницы');
      tables++;
      const groups: Array<{ y: number; cells: string[][] }> = [];
      for (const t of items.filter(t => t.str.trim() && t.transform[5] < header.transform[5] - 3).sort((a,b) => b.transform[5]-a.transform[5] || a.transform[4]-b.transform[4])) {
        const x = t.transform[4], y = t.transform[5];
        let g = groups.find(g => Math.abs(g.y-y) < 2);
        if (!g) { g = { y, cells: [[],[],[],[],[],[],[],[],[]] }; groups.push(g); }
        const bounds = bank === 'halyk' ? [60,110,210,260,310,370,440,490] : deposit ? [100,195,280,490] : [100,220,305,590];
        const col = bounds.findIndex(b => x < b);
        g.cells[col < 0 ? 8 : col].push(t.str);
      }
      for (const g of groups) {
        if (rows.length >= MAX_IMPORT_ROWS) throw new HttpError(413, 'too_many_rows', `Не больше ${MAX_IMPORT_ROWS} текстовых строк; разделите выписку на части`);
        const c = g.cells.map(a => a.join(' ').trim());
        // Every extracted text line remains visible in the report. Continuations are
        // conservatively rejected rather than guessed into another transaction.
        if (/^\d{2}\.\d{2}\.(?:\d{2}|\d{4})$/.test(c[0])) {
          if (bank === 'halyk') rows.push([c[0], '', c[2], c[2], c[4] === 'KZT' ? c[5] : '', c[4] === 'KZT' ? c[6] : '', c[4] === 'KZT' ? '' : 'валюта операции не KZT']);
          else {
            const rejected = /^(?:отклонена|не завершена|ожидает|сумма в блокировке)$/i.test(c[2]) ? 'операция не завершена' :
              /перевод между своими счетами/i.test(c[2]) ? 'перевод между своими счетами' : '';
            rows.push([c[0],c[1],c[3], [c[2],c[3]].filter(Boolean).join(': '), '', '', rejected]);
          }
        }
        else {
          const last = rows.slice().reverse().find(r => r[0]);
          const continuation = bank === 'halyk' ? c[2] : c[3];
          if (last && continuation && !c[0]) { last[2] += ' ' + continuation; last[3] += ' ' + continuation; }
          rows.push(['','','',c.filter(Boolean).join(' '),'','','служебная строка или продолжение описания']);
        }
      }
    }
    if (!signature || !tables) throw new HttpError(400, 'unknown_layout', 'Не распознана выписка выбранного банка с текстовым слоем');
    if(bank==='freedom')rows.push(...finishFreedomRows(freedom));
    return 'Дата;Сумма;Контрагент;Описание;Зачисление;Списание;Причина\n' + rows.map(r => r.map(c => '"'+c.replace(/"/g,'""')+'"').join(';')).join('\n');
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'bad_pdf', 'Не удалось разобрать PDF'); } finally { await pdf.cleanup(); }
}
