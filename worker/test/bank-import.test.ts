import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { addAccount, call, loginAs, makeEnv } from './helpers';

const examples = JSON.parse(readFileSync('worker/test/fixtures/examples.json','utf8'));

for (const [bank, file] of [['kaspi','gold'],['kaspi','deposit'],['halyk','statement']]) {
  it(`${bank}/${file}: PDF, повтор, отчёт и изоляция`, async () => {
    const {env,store} = makeEnv(); await addAccount(store,'owner'); await addAccount(store,'other');
    const o = (await loginAs(env,'owner')).cookie, x = (await loginAs(env,'other')).cookie;
    const body = { bank, pdfBase64: readFileSync(`worker/test/fixtures/${bank}/${file}.pdf`).toString('base64') };
    for (const dryRun of [true,false]) {
      const r = await call(env,'POST','/api/import',{cookie:o,body:{...body,dryRun}});
      expect(r.status).toBe(200); expect(r.data).toMatchObject(examples.cases.find((c:any) => c.fixture === `${bank}/${file}.pdf`).expected);
      if (bank === 'kaspi') expect(r.data.rows.some((r:any) => r.reason === 'операция не завершена')).toBe(true);
      expect(r.data.rows).toHaveLength(r.data.total);
      expect(r.data.imported+r.data.duplicates+r.data.rejected).toBe(r.data.total);
    }
    const entries = (await call(env,'GET','/api/entries',{cookie:o})).data.items;
    expect(entries.map((e:any)=>({...e.payload,occurredAt:e.occurredAt})).sort((a:any,b:any)=>a.amountMinor-b.amountMinor)).toMatchObject([
      {direction:'out',amountMinor:12345,counterparty:'TEST SHOP',occurredAt:Date.UTC(2026,10,1,7)},
      {direction:'in',amountMinor:67890,counterparty:'TEST SENDER CONTINUATION',occurredAt:Date.UTC(2026,10,2,7)}]);
    expect((await call(env,'POST','/api/import',{cookie:o,body})).data).toMatchObject({imported:0,duplicates:2});
    expect((await call(env,'GET','/api/entries',{cookie:x})).data.items).toEqual([]);
    expect((await call(env,'POST','/api/import',{cookie:x,body})).data.imported).toBe(2);
  });
}
it('PDF: размер, неизвестный профиль и повреждённый файл', async()=>{
  const {env,store}=makeEnv();await addAccount(store,'owner');const cookie=(await loginAs(env,'owner')).cookie;
  for(const [body,status] of [[{bank:'kaspi',pdfBase64:'A'.repeat(2800001)},413],[{bank:'kaspi',pdfBase64:'invalid'},400],[{bank:'freedom',pdfBase64:''},400]] as const)
    expect((await call(env,'POST','/api/import',{cookie,body})).status).toBe(status);
});
