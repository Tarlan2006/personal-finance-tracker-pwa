import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { addAccount, call, loginAs, makeEnv } from './helpers';

const examples = JSON.parse(readFileSync('worker/test/fixtures/examples.json','utf8'));

for (const [bank, file] of [['kaspi','gold'],['kaspi','deposit'],['halyk','statement'],['freedom','statement']]) {
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
    const example=examples.cases.find((c:any)=>c.fixture===`${bank}/${file}.pdf`);
    expect(entries).toHaveLength(example.expected.imported);
    for(const expected of example.expectedOperations??examples.expectedOperations){
      expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({occurredAt:Date.parse(expected.utc),payload:expect.objectContaining({direction:expected.direction,amountMinor:expected.amountMinor,counterparty:expected.counterparty})})]));
    }
    if(bank==='freedom'){
      expect(entries.some((e:any)=>e.payload.note.length>300)).toBe(true);
      const report=(await call(env,'GET','/api/import/batches',{cookie:o})).data.batches[0];
      const rows=(await call(env,'GET',`/api/import/batches/${report.id}`,{cookie:o})).data.rows;
      for(const cause of ['операция не завершена','валюта операции не KZT','перевод между своими счетами'])expect(rows.some((r:any)=>r.reason?.startsWith(cause))).toBe(true);
    }
    expect((await call(env,'POST','/api/import',{cookie:o,body})).data).toMatchObject({imported:0,duplicates:example.expected.imported});
    expect((await call(env,'GET','/api/entries',{cookie:x})).data.items).toEqual([]);
    expect((await call(env,'POST','/api/import',{cookie:x,body})).data.imported).toBe(example.expected.imported);
  });
}
it('PDF: размер, неизвестный профиль и повреждённый файл', async()=>{
  const {env,store}=makeEnv();await addAccount(store,'owner');const cookie=(await loginAs(env,'owner')).cookie;
  for(const [body,status] of [[{bank:'kaspi',pdfBase64:'A'.repeat(2800001)},413],[{bank:'kaspi',pdfBase64:'invalid'},400],[{bank:'unknown-bank',pdfBase64:''},400]] as const)
    expect((await call(env,'POST','/api/import',{cookie,body})).status).toBe(status);
});
