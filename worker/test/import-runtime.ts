// Isolated local workerd entry point. Never used by the production wrangler.toml.
import { deleteTransactions } from '../src/domain/money/entries';
import { loginOptions } from '../src/auth';
import { Store } from '../src/env';
import { runImport, getBatch, undoBatch } from '../src/domain/money/import';
import {clearHistory} from '../src/domain/money/history';
import { MAX_IMPORT_REPORT_BYTES } from '../src/domain/money/import-limits';
import { createCategory, updateCategory, deleteCategory } from '../src/domain/money/categories';

type Fixture = {bank:string; pdfBase64:string; expected:{imported:number;rejected:number;service:number;total:number}};
export default {
  async fetch(req:Request, env:{DB:D1Database}) {
    if(req.method==='GET') return new Response('local import check');
    const checks:string[]=[];
    const assert=(ok:unknown,name:string)=>{if(!ok)throw new Error(name);checks.push(name);};
    try {
      const {schema,fixtures,serviceBackfill}=await req.json() as {schema:string[];fixtures:Fixture[];serviceBackfill:string};
      for(const sql of schema) await env.DB.prepare(sql).run();
      const store=new Store(env.DB);
      const account=async(id:string)=>{
        await env.DB.prepare('INSERT INTO accounts (id,login,display_name,pass_hash,pass_salt,pass_iter,queue_key,created_at,updated_at) VALUES (?,?,?,?,?,1,?,0,0)').bind(id,id,'SYNTHETIC','not-a-real-hash','synthetic','synthetic').run();return id;
      };
      const count=async(table:string,id:string)=>Number((await store.first<{n:number}>(`SELECT count(*) n FROM ${table} WHERE account_id=?`,id))!.n);
      const mapping={dateCol:0,amountCol:1,counterpartyCol:2};
      const csv=(n:number)=>'date;amount;name\n'+Array.from({length:n},(_,i)=>`01.11.2026;-${i+1};TEST ${i}`).join('\n');
      const other=await account('runtime-other');
      const picker=await loginOptions(store,'runtime-other,missing');assert(picker.length===1&&picker[0].login==='runtime-other'&&Object.keys(picker[0]).sort().join(',')==='login,name','login picker: configured metadata only');
      assert((await loginOptions(store)).length===0,'login picker: private by default');
      const legacyRows=[{line:2,status:'imported'},{line:3,status:'rejected',reason:'служебная строка или продолжение описания',preview:'SYNTHETIC FOOTER'},{line:4,status:'rejected',reason:'операция не завершена'}];
      await store.run("INSERT INTO import_batches (id,account_id,source,filename,created_at,total,imported,duplicates,rejected,report_json) VALUES ('legacy-runtime',?,'kaspi','synthetic.pdf',0,3,1,0,2,?)",other,JSON.stringify(legacyRows));
      const legacy=await getBatch(store,other,'legacy-runtime');assert(legacy.service===1&&legacy.rejected===1,'legacy report: read compatibility');
      await store.run(serviceBackfill);const migrated=await store.first<any>("SELECT service,rejected,report_json FROM import_batches WHERE account_id=? AND id='legacy-runtime'",other);
      assert(migrated.service===1&&migrated.rejected===1&&JSON.parse(migrated.report_json)[1].status==='service'&&await count('entries',other)===0,'legacy report: migration metadata only');
      const sameCategory=await Promise.allSettled([1,2].map(()=>createCategory(store,other,{name:'AUDIT «Ёлка» 😀',type:'expense'})));
      assert(sameCategory.filter(r=>r.status==='fulfilled').length===1&&sameCategory.filter(r=>r.status==='rejected'&&r.reason.status===409).length===1,'categories: concurrent create');
      const original=(sameCategory.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
      const a=await createCategory(store,other,{name:'AUDIT A',type:'expense'}),b=await createCategory(store,other,{name:'AUDIT B',type:'expense'});
      const renamed=await Promise.allSettled([a,b].map(c=>updateCategory(store,other,c.id,{name:'AUDIT RENAMED'})));
      assert(renamed.filter(r=>r.status==='fulfilled').length===1&&renamed.filter(r=>r.status==='rejected'&&r.reason.status===409).length===1,'categories: concurrent rename');
      await deleteCategory(store,other,original.id);const replacement=await createCategory(store,other,{name:original.name,type:'expense'});
      assert(replacement.id!==original.id,'categories: recreated id does not revive history');
      for(const [i,f] of fixtures.entries()) {
        const id=await account(`runtime-fixture-${i}`);const input={bank:f.bank,pdfBase64:f.pdfBase64};
        const dry=await runImport(store,id,{...input,dryRun:true});assert(dry.imported===f.expected.imported,`fixture ${i}: dryRun`);
        const r=await runImport(store,id,input);
        assert(r.total===f.expected.total&&r.imported===f.expected.imported&&r.rejected===f.expected.rejected&&r.service===f.expected.service&&r.imported+r.duplicates+r.rejected+r.service===r.total&&r.rows.length===r.total,`fixture ${i}: report`);
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
      const large=await account('runtime-large');store.ops=0;
      const max=await runImport(store,large,{csv:csv(1000),mapping});const maxOps=store.ops;
      assert(max.imported===1000&&max.rows.length===1000&&maxOps===2,'1000 rows: atomic report and budget');
      store.ops=0;const maxDry=await runImport(store,large,{csv:csv(1000),mapping,dryRun:true});assert(maxDry.duplicates===1000&&store.ops<=13,'1000 rows: dryRun budget');
      const limited=await account('runtime-limited');let limitedError=false;
      try{await runImport(store,limited,{csv:csv(1001),mapping});}catch(e:any){limitedError=e.status===413;}
      assert(limitedError&&await count('entries',limited)===0&&await count('import_batches',limited)===0,'1001 rows: rejected before write');
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
      store.ops=0;const deleted=await undoBatch(store,bulk,r.batchId!);const deleteOps=store.ops;
      assert(deleted.removed===500&&deleteOps===1&&await count('entries',bulk)===0&&await count('counterparties',bulk)===0,'document delete: 500 rows, one atomic D1 batch');
      await env.DB.prepare("CREATE TRIGGER runtime_delete_failure BEFORE DELETE ON import_batches BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
      let deleteFailed=false;try{await clearHistory(store,large);}catch{deleteFailed=true;}
      assert(deleteFailed&&await count('entries',large)===1000&&await count('import_batches',large)===1,'history delete: rollback in D1');
      await env.DB.prepare('DROP TRIGGER runtime_delete_failure').run();store.ops=0;const cleared=await clearHistory(store,large);const clearOps=store.ops;
      assert(cleared.removed===1000&&clearOps===1&&await count('entries',large)===0&&await count('counterparties',large)===0,'history delete: 1000 rows, one atomic D1 batch');
      const selectedAccount=await account('runtime-selected');
      await runImport(store,selectedAccount,{csv:csv(1000),mapping});
      const selectedIds=(await store.all<{id:string}>('SELECT id FROM entries WHERE account_id=?',selectedAccount)).map(e=>e.id);
      const foreignId=(await store.first<{id:string}>('SELECT id FROM entries WHERE account_id=?',concurrent))!.id;
      await env.DB.prepare("CREATE TRIGGER runtime_selected_failure BEFORE UPDATE OF deleted_at ON entries WHEN NEW.id='"+selectedIds[1]+"' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
      let selectedFailed=false;try{await deleteTransactions(store,selectedAccount,selectedIds);}catch{selectedFailed=true;}
      assert(selectedFailed&&(await store.first<any>('SELECT count(*) AS n FROM entries WHERE account_id=? AND deleted_at IS NOT NULL',selectedAccount))!.n===0,'selected delete: atomic rollback');
      await env.DB.prepare('DROP TRIGGER runtime_selected_failure').run();store.ops=0;
      const selectedResult=await deleteTransactions(store,selectedAccount,[...selectedIds.slice(0,999),foreignId]);const selectedOps=store.ops;
      assert(selectedResult.removed===999&&selectedOps===1,'selected delete: bounded single statement');
      assert((await store.first<any>('SELECT deleted_at FROM entries WHERE account_id=? AND id=?',concurrent,foreignId))!.deleted_at===null,'selected delete: account isolation');
      assert((await deleteTransactions(store,selectedAccount,selectedIds.slice(0,999))).removed===0,'selected delete: safe retry');
      return Response.json({passed:true,checks,writeOps,dryOps});
    } catch(e:any) { return Response.json({passed:false,checks,failedCheck:String(e.message)},{status:500}); }
  }
};
