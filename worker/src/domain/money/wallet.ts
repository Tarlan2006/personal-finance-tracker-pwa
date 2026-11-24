import { HttpError, type Store } from '../../env';
import { readProfile } from './financial-profile';
import { monthRange, currentMonth } from './normalize';
import type { TxPayload } from '../../../../shared/types';

function add(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new HttpError(422, 'total_too_large', 'Остаток превышает точный денежный диапазон');
  return value;
}

export async function walletSummary(store: Store, accountId: string) {
  const { profile } = await readProfile(store, accountId);
  if (!profile) return { accounts: [], balanceDate: null, unassigned: 0 };
  const now = Date.now(), { from, to } = monthRange(currentMonth(now));
  const balanceFrom = Date.parse(profile.balanceDate + 'T00:00:00+05:00');
  const accounts = profile.accounts.map(a => ({ ...a, balanceMinor: a.openingBalanceMinor, in: 0, out: 0 }));
  const byId = new Map(accounts.map(a => [a.id, a]));
  const rows = await store.all<{ kind:string; payload_json: string; occurred_at: number }>(
    "SELECT kind,payload_json, occurred_at FROM entries WHERE account_id=? AND kind IN ('tx','transfer') AND deleted_at IS NULL AND occurred_at<=?", accountId, now);
  let unassigned = 0;
  for (const row of rows) {
    if(row.kind==='transfer'){
      const p=JSON.parse(row.payload_json);
      if(row.occurred_at>=balanceFrom)for(const [id,sign] of [[p.fromId,-1],[p.toId,1]] as const){const a=byId.get(id);if(a&&a.balanceMinor!==null)a.balanceMinor=add(a.balanceMinor,sign*p.amountMinor);}
      continue;
    }
    const p = JSON.parse(row.payload_json) as TxPayload;
    const account = byId.get(p.financialAccountId ?? '');
    if (!account) { unassigned++; continue; }
    if (row.occurred_at >= balanceFrom && account.balanceMinor !== null)
      account.balanceMinor = add(account.balanceMinor, p.direction === 'in' ? p.amountMinor : -p.amountMinor);
    if (row.occurred_at >= from && row.occurred_at < to) account[p.direction] = add(account[p.direction], p.amountMinor);
  }
  return { accounts, balanceDate: profile.balanceDate, unassigned };
}
