import { expect, it } from 'vitest';
import { inputMinor, normName } from '../../web/src/money';
import { normName as serverName } from '../src/domain/money/normalize';

it('сумма в форме: точные тиыны, дробная часть не округляется молча',()=>{
  for(const [text,expected] of [['0',0],['0,25',25],['1 000,25',100025],['2500.5',250050],['12,345',null],['-1',null],['9007199254740992',null],['',null]] as const) expect(inputMinor(text)).toBe(expected);
});
it('нормализация получателей в превью совпадает с сервером',()=>{
  for(const text of ['  ИП  «Мирас» ','MAGNUM','Ёлка “ТЕСТ”',"ТЕСТ\n  МАГАЗИН"]) expect(normName(text)).toBe(serverName(text));
});
