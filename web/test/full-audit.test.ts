import {expect,it} from 'vitest';
import * as money from '../src/money';

it('allocates whole percentage points consistently including ties and large totals',()=>{
 expect(money.categoryPercentages([1,1,1])).toEqual([34,33,33]);
 expect(money.categoryPercentages([0,0])).toEqual([0,0]);
 expect(money.categoryPercentages([4503599627370495,4503599627370496])).toEqual([50,50]);
});
it('keeps distinct dates across years and uses fixed UTC+5 for historical records',()=>{
 expect(money.ledgerDate(Date.parse('2010-01-01T18:30:00Z'))).toBe('2010-01-01');
 expect(money.ledgerDayLabel(Date.parse('2020-01-01T00:00:00Z'))).not.toBe(money.ledgerDayLabel(Date.parse('2025-01-01T00:00:00Z')));
});
