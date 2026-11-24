import { HttpError } from '../../env';

export const PDF_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_PARSE_MS = 3000;
export const PDF_MAX_PAGES = 100;

/** Wall-time guard, not a substitute for Cloudflare's CPU limit. */
export class PdfBudget {
  private readonly deadline = performance.now() + PDF_PARSE_MS;
  private timeoutError() { return new HttpError(422, 'pdf_timeout', 'Разбор PDF занял слишком много времени. Разделите выписку на части или загрузите CSV.'); }
  check() { if (performance.now() >= this.deadline) throw this.timeoutError(); }
  async wait<T>(work: Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(this.timeoutError()), Math.max(0, this.deadline - performance.now()));
      })]);
      this.check();
      return result;
    } finally { clearTimeout(timer); }
  }
}
