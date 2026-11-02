/** Задел под односторонний экспорт (например, в Google Sheets, фаза 2). Реализации пока нет — есть только CSV (`GET /api/export.csv`). */
export interface Exporter {
  readonly id: string;
  /** Выгрузить все записи аккаунта в приёмник; возвращает число выгруженных строк. */
  exportAll(accountId: string): Promise<{ rows: number }>;
}
