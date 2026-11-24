import { useState, type ReactNode } from 'react';
import type { FinancialAccount } from '../../shared/financial-profile';

type AccountBrand = Pick<FinancialAccount, 'bank' | 'kind'>;

export function bankBrand(bank: string, kind?: FinancialAccount['kind']) {
  if (kind === 'cash') return 'cash';
  if (/kaspi|каспи/i.test(bank)) return 'kaspi';
  if (/haly[kq]|халы[кқ]/i.test(bank)) return 'halyk';
  if (/forte|форте/i.test(bank)) return 'forte';
  if (/freedom|фридом/i.test(bank)) return 'freedom';
  return 'other';
}

const colors = ['#834329', '#40549A', '#285E59', '#714678', '#405F32', '#654D88'];
export function bankFallback(bank: string) {
  const name = bank.trim().toUpperCase();
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return { letter: Array.from(name)[0] || '?', background: colors[hash % colors.length] };
}

export function BankLogo({ bank, kind, size = 56 }: {
  bank: string; kind?: FinancialAccount['kind']; size?: 28 | 36 | 40 | 56;
}) {
  const brand = bankBrand(bank, kind);
  // Remount when the selected bank changes so a failed image can be tried again.
  return <BankMark key={brand} bank={bank} brand={brand} size={size}/>;
}

function BankMark({ bank, brand, size }: { bank: string; brand: ReturnType<typeof bankBrand>; size: number }) {
  const [failed, setFailed] = useState(false);
  const fallback = brand !== 'cash' && (brand === 'other' || failed) ? bankFallback(bank) : null;
  return <span aria-hidden="true" className={'bank-logo bank-logo-' + brand}
    style={{width:size, height:size, fontSize:Math.round(size * .5), backgroundColor:fallback?.background}}>
    {brand === 'cash' ? '₸' : fallback ? fallback.letter :
      <img src={'/banks/' + brand + '.png'} width={size} height={size} alt="" aria-hidden="true"
        loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)}/>}
  </span>;
}

/** Preserve the full native select (including its focus ring and hit area). */
export function BankSelectControl({ account, children }: { account?: AccountBrand; children: ReactNode }) {
  return <div className="bank-select-control">{account && <BankLogo {...account} size={28}/>}{children}</div>;
}
