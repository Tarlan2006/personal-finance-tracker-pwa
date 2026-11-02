export const MAX_NOTE_LENGTH = 500;
export type Direction = 'in' | 'out';
export interface TxPayload {
  direction: Direction;
  amountMinor: number; // тиын, всегда > 0
  counterparty: string;
  categoryId?: string | null; // явное переопределение
  note?: string;
  title?: string;
  bank?: string;
  currency?: string;
}
export interface EntryDTO {
  id: string; kind: string; occurredAt: number; createdAt: number; updatedAt: number;
  version: number; source: string; payload: TxPayload;
  effectiveCategoryId: string | null;
}
export interface CategoryDTO { id: string; name: string; type: 'expense' | 'income'; color: string; sort: number }
