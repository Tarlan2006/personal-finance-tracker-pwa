import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentProxy } from 'unpdf';
import { bankPdf } from '../src/domain/money/bank-pdf';
import { PDF_MAX_BYTES, PDF_PARSE_MS, PdfBudget } from '../src/domain/money/pdf-budget';

vi.mock('unpdf', () => ({ getDocumentProxy: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
const input = btoa('%PDF-synthetic');

it('отклоняет большой PDF до запуска парсера', async () => {
  await expect(bankPdf('A'.repeat(Math.ceil(PDF_MAX_BYTES / 3) * 4 + 1), 'kaspi')).rejects.toMatchObject({ status: 413, code: 'file_too_large' });
  expect(getDocumentProxy).not.toHaveBeenCalled();
});

it('прерывает зависшее открытие и освобождает документ, если он появился позднее', async () => {
  vi.useFakeTimers();
  let finish!: (doc: any) => void;
  vi.mocked(getDocumentProxy).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const result = expect(bankPdf(input, 'kaspi')).rejects.toMatchObject({ status: 422, code: 'pdf_timeout' });
  await vi.advanceTimersByTimeAsync(PDF_PARSE_MS + 1); await result;
  const cleanup = vi.fn().mockResolvedValue(undefined); finish({ cleanup });
  await Promise.resolve(); await Promise.resolve(); expect(cleanup).toHaveBeenCalledOnce();
});

it('ограничивает чтение страницы, количество страниц и сложность текста понятными ошибками', async () => {
  vi.useFakeTimers();
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const doc = { numPages: 1, cleanup, getPage: vi.fn().mockResolvedValue({ getTextContent: () => new Promise(() => {}) }) };
  vi.mocked(getDocumentProxy).mockResolvedValue(doc as any);
  const result = expect(bankPdf(input, 'kaspi')).rejects.toMatchObject({ status: 422, code: 'pdf_timeout' });
  await vi.advanceTimersByTimeAsync(PDF_PARSE_MS + 1); await result; expect(cleanup).toHaveBeenCalledOnce();
  doc.numPages = 101;
  await expect(bankPdf(input, 'kaspi')).rejects.toMatchObject({ status: 413, code: 'too_many_pages' });
  doc.numPages = 1;
  doc.getPage.mockResolvedValue({ getTextContent: async () => ({ items: Array(20001).fill({ str: 'text' }) }) });
  await expect(bankPdf(input, 'kaspi')).rejects.toMatchObject({ status: 413, code: 'pdf_too_complex' });
});

it('контрольные точки замечают превышение времени даже при занятом цикле событий', () => {
  vi.useFakeTimers(); const budget = new PdfBudget(); vi.advanceTimersByTime(PDF_PARSE_MS + 1);
  expect(() => budget.check()).toThrow('Разбор PDF занял слишком много времени');
});
