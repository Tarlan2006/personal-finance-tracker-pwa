import { expect, it } from 'vitest';
import { bankBrand, bankFallback } from '../src/bank-logo';

it.each([
  ['KaSPi Gold', 'kaspi'], ['кАсПи Депозит', 'kaspi'],
  ['HALYK Bank', 'halyk'], ['HalyQ', 'halyk'], ['ХаЛыК', 'halyk'], ['Халық', 'halyk'],
  ['Forte', 'forte'], ['FORTEbank', 'forte'], ['ФортеБанк', 'forte'],
  ['Freedom Bank', 'freedom'], ['фРиДоМ', 'freedom'],
  ['Мой банк', 'other'], ['', 'other'],
])('recognizes %s in a deposit account', (name, expected) => {
  expect(bankBrand(name, 'deposit')).toBe(expected);
});

it('uses the cash mark regardless of the bank name', () => {
  expect(bankBrand('Kaspi', 'cash')).toBe('cash');
});

it('renders a stable initial and color for aliases differing only in case or spaces', () => {
  const mark = bankFallback('  мой банк ');
  expect(mark.letter).toBe('М');
  expect(mark).toEqual(bankFallback('МОЙ БАНК'));
  expect(mark.background).toMatch(/^#[0-9A-F]{6}$/i);
  expect(bankFallback('').letter).toBe('?');
});
