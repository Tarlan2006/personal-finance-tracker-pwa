// Isolated local workerd entry point. Never used by the production wrangler.toml.
import { Store } from '../src/env';
import { runImport, getBatch } from '../src/domain/money/import';
import { MAX_IMPORT_REPORT_BYTES } from '../src/domain/money/import-limits';

type Fixture = {bank:string; pdfBase64:string; expected:{imported:number;rejected:number;total:number}};
export default {
  async fetch(req:Request, env:{DB:D1Database}) {
    if(req.method==='GET') return new Response('local import check');
    const checks:string[]=[];
    const assert=(ok:unknown,name:string)=>{if(!ok)throw new Error(name);checks.push(name);};
    try {
      const {schema,fixtures}=await req.json() as {schema:string[];fixtures:Fixture[]};
      for(const sql of schema) await env.DB.prepare(sql).run();
      const store=new Store(env.DB);
      const account=async(id:string)=>{
        await env.DB.prepare('INSERT INTO accounts (id,login,display_name,pass_hash,pass_salt,pass_iter,queue_key,created_at,updated_at) VALUES (?,?,?,?,?,1,?,0,0)').bind(id,id,'SYNTHETIC','not-a-real-hash','synthetic','synthetic').run();return id;
      };
      const count=async(table:string,id:string)=>Number((await store.first<{n:number}>(`SELECT count(*) n FROM ${table} WHERE account_id=?`,id))!.n);
      const mapping={dateCol:0,amountCol:1,counterpartyCol:2};
      const csv=(n:number)=>'date;amount;name\n'+Array.from({length:n},(_,i)=>`01.11.2026;-${i+1};TEST ${i}`).join('\n');
      const other=await account('runtime-other');
      for(const [i,f] of fixtures.entries()) {
        const id=await account(`runtime-fixture-${i}`);const input={bank:f.bank,pdfBase64:f.pdfBase64};
        const dry=await runImport(store,id,{...input,dryRun:true});assert(dry.imported===f.expected.imported,`fixture ${i}: dryRun`);
        const r=await runImport(store,id,input);
        assert(r.total===f.expected.total&&r.imported===f.expected.imported&&r.rejected===f.expected.rejected&&r.rows.length===r.total,`fixture ${i}: report`);
        assert(JSON.stringify((await getBatch(store,id,r.batchId!)).rows)===JSON.stringify(r.rows),`fixture ${i}: persisted report`);
        const again=await runImport(store,id,input);assert(again.imported===0&&again.duplicates===r.imported,`fixture ${i}: replay`);
        let denied=false;try{await getBatch(store,other,r.batchId!);}catch{denied=true;}assert(denied,`fixture ${i}: isolation`);
      }
      const bulk=await account('runtime-bulk');store.ops=0;
      const r=await runImport(store,bulk,{csv:csv(500),mapping});const writeOps=store.ops;
      assert(r.imported===500&&r.rows.length===500,'500 rows: report');
      assert(writeOps===2,'500 rows: two D1 calls');
      assert(new TextEncoder().encode(JSON.stringify(r.rows)).length<MAX_IMPORT_REPORT_BYTES,'500 rows: bounded report');
      store.ops=0;const dry=await runImport(store,bulk,{csv:csv(500),mapping,dryRun:true});const dryOps=store.ops;
      assert(dry.imported===0&&dry.duplicates===500&&dryOps<=7,'500 rows: dryRun within budget');
      const retry=await runImport(store,bulk,{csv:csv(500),mapping});assert(retry.imported===0&&retry.duplicates===500,'500 rows: retry');
      const limited=await account('runtime-limited');let limitedError=false;
      try{await runImport(store,limited,{csv:csv(501),mapping});}catch(e:any){limitedError=e.status===413;}
      assert(limitedError&&await count('entries',limited)===0&&await count('import_batches',limited)===0,'501 rows: rejected before write');
      const failure=await account('runtime-failure');
      for(const stage of ['entry','report']) {
        await env.DB.prepare(stage==='entry' ? `CREATE TRIGGER runtime_failure BEFORE INSERT ON entries WHEN NEW.account_id='runtime-failure' AND NEW.value=-4100 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END` : `CREATE TRIGGER runtime_failure BEFORE INSERT ON import_batches WHEN NEW.account_id='runtime-failure' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`).run();
        let failed=false;try{await runImport(store,failure,{csv:csv(50),mapping});}catch(e:any){failed=e.code==='import_failed';}
        assert(failed&&await count('entries',failure)===0&&await count('counterparties',failure)===0&&await count('import_batches',failure)===0,`${stage}: rollback in D1`);
        await env.DB.prepare('DROP TRIGGER runtime_failure').run();
      }
      const concurrent=await account('runtime-concurrent');
      const pair=await Promise.all([runImport(store,concurrent,{csv:csv(50),mapping}),runImport(store,concurrent,{csv:csv(50),mapping})]);
      assert(pair.reduce((n,r)=>n+r.imported,0)===50&&pair.reduce((n,r)=>n+r.duplicates,0)===50&&await count('entries',concurrent)===50,'concurrent: exact statuses');
      return Response.json({passed:true,checks,writeOps,dryOps});
    } catch(e:any) { return Response.json({passed:false,checks,failedCheck:String(e.message)},{status:500}); }
  }
};
