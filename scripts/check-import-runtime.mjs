// Starts only a local Worker with a new, synthetic D1 database. No Cloudflare login.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const root='.wrangler/import-runtime';mkdirSync(root,{recursive:true});
writeFileSync(root+'/wrangler.toml',`name = "qarjy-import-local-test"\nmain = "../../worker/test/import-runtime.ts"\ncompatibility_date = "2025-01-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "synthetic-local"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`);
if(!process.env.npm_execpath)throw new Error('Запустите через npm run test:import-runtime');
const args=[process.env.npm_execpath,'exec','--yes','--package=wrangler@4.156.1','--','wrangler','dev','--local','--config',root+'/wrangler.toml','--ip','127.0.0.1','--port',String(port),'--persist-to',root+'/state-'+Date.now()];
const child=spawn(process.execPath,args,{windowsHide:true,stdio:'ignore',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
child.on('error',()=>{});
try {
  const origin=`http://127.0.0.1:${port}`;let ready=false;
  for(let i=0;i<120;i++) {
    if(child.exitCode!==null)throw new Error('Local Wrangler stopped before startup');
    try{ready=(await fetch(origin,{signal:AbortSignal.timeout(500)})).ok;}catch{}
    if(ready)break;await delay(500);
  }
  if(!ready)throw new Error('Local workerd startup timeout');
  const schema=readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort().flatMap(f=>readFileSync('migrations/'+f,'utf8').replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean));
  const examples=JSON.parse(readFileSync('worker/test/fixtures/examples.json','utf8'));
  const fixtures=examples.cases.filter(c=>c.fixture).map(c=>({bank:c.bank,expected:c.expected,pdfBase64:readFileSync('worker/test/fixtures/'+c.fixture).toString('base64')}));
  const serviceMigration=readFileSync('migrations/0004_import_service_rows.sql','utf8');
  const serviceBackfill=serviceMigration.slice(serviceMigration.indexOf('WITH classified'));
  const response=await fetch(origin,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schema,fixtures,serviceBackfill}),signal:AbortSignal.timeout(90000)});
  const result=await response.json();console.log(JSON.stringify(result,null,2));
  if(!response.ok||!result.passed)process.exitCode=1;
} catch(e) { console.error(e.message);process.exitCode=1; }
finally {
  if(child.pid) {
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else child.kill('SIGTERM');
  }
}
