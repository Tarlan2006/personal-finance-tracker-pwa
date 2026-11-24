export type BankBrand = 'kaspi' | 'forte' | 'halyk' | 'freedom' | 'cash' | 'other';

/** Local, replaceable simplified marks. No external logo requests. */
export function BankLogo({brand}:{brand:BankBrand}) {
  return <span className={`bank-logo bank-logo-${brand}`} aria-hidden="true"><img src={`/banks/${brand}.svg`} alt="" width="56" height="56" draggable={false}/></span>;
}
