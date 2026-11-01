// Cross-device audit. Every API and record is synthetic and isolated in memory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {criarServidorPrevisao} from './serve-previsao-preview.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/leonardopereira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const port=Number(process.env.PREVIEW_PORT)||8841,{server,base,b}=criarServidorPrevisao(port);
const output=path.join(root,'output-previsao-sync');fs.mkdirSync(output,{recursive:true});
const results=[],errors=[],responses=[];
const report=label=>{results.push(label);console.log('PASS '+label);};
const remote=()=>structuredClone(b.table('previsao_custo').get('diamond'));
const legacyKey='dv_previsao_custo_v1:'+encodeURIComponent(base)+':domo';
const defaults=()=>({settings:{targetCents:1700000000,futurePaymentShare:.5,futureCommissionRate:null},contributionsReviewed:false,contributions:[],contracts:{},receipts:[]});
const contribution=(id,socio,valorCents)=>({id,socio,data:'2026-10-20',valorCents,observacao:'Registro sintético da auditoria'});
const envelope=data=>({schema:1,revision:3,updatedAt:'2026-10-21T12:00:00.000Z',status:'Salvo neste navegador',data});
const initial=defaults();initial.contributions=[contribution('legacy-aporte-1','Sócio legado',1000000)];
const legacyRaw=JSON.stringify(envelope(initial));
let browser;
const snapshot=async(page,name)=>{await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>window.scrollY===0);return page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
const text=async(page,selector)=>(await page.locator(selector).textContent()).replaceAll('\u00a0',' ').trim();
const saved=async(page,action)=>{const old=await page.locator('#pc-settings').elementHandle();await action();await old.waitForElementState('hidden',{timeout:15000});await page.locator('#pc-settings').waitFor();};
const open=async(page,name)=>{const d=page.locator('[data-section="'+name+'"]');if(!await d.evaluate(n=>n.open))await d.locator('summary').click();};
const waitError=async page=>{await page.waitForFunction(()=>document.querySelector('#pc-message')?.classList.contains('pc-warning')&&document.querySelector('#pc-message')?.textContent.trim());return text(page,'#pc-message');};
const settings=async(page,target)=>{await page.locator('#pc-settings [name=target]').fill(target);await saved(page,()=>page.locator('#pc-settings button').click());};
const refresh=async page=>page.evaluate(()=>DiamondPrevisao.refresh());
const waitTarget=async(page,value)=>page.waitForFunction(expected=>document.querySelector('#pc-settings [name=target]')?.value===expected,value);
async function fillContribution(page,name,value){
 await open(page,'contributions');await page.locator('#pc-aporte [name=socio]').fill(name);await page.locator('#pc-aporte [name=data]').fill('2026-10-21');await page.locator('#pc-aporte [name=valor]').fill(value);
}
async function fillReceipt(page,value){
 await open(page,'receipts');await page.locator('#pc-receipt [name=unitId]').selectOption('u-101');await page.locator('#pc-receipt [name=data]').fill('2026-10-21');await page.locator('#pc-receipt [name=natureza]').selectOption('comum');await page.locator('#pc-receipt [name=valor]').fill(value);
}
async function device({width=1440,legacy,session}={}){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'pt-BR',isMobile:width<600,hasTouch:width<600});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 if(legacy!==undefined||session)await context.addInitScript(({key,legacy,session})=>{
  if(legacy!==undefined&&!localStorage.getItem(key))localStorage.setItem(key,legacy);
  if(session){localStorage.setItem('dv_user',JSON.stringify(session));localStorage.setItem('dv_owner',session.usuario);}
 },{key:legacyKey,legacy,session});
 const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
 page.on('response',response=>{if(response.url()===base+'/api/dmd-api'){const payload=response.request().postDataJSON();if(payload?.action==='previsaoCusto')responses.push({operation:payload.operacao,status:response.status()});}});
 await page.goto(base+'/#/admin/painel?visao=previsao',{waitUntil:'networkidle'});
 if(!session)await page.locator('#pc-settings').waitFor({timeout:15000});
 return {context,page};
}
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
 const desktop=await device({legacy:legacyRaw}),p=desktop.page;
 assert.equal(remote().revision,1);assert.deepEqual(remote().data,initial);
 assert.equal(await p.evaluate(key=>localStorage.getItem(key),legacyKey),legacyRaw);
 assert.equal((await p.evaluate(()=>DiamondPrevisaoStore.legacyStatus())).migrated,true);
 report('empty system migrates the old browser ledger once and retains its original bytes');
 await p.locator('#pc-settings [name=commission]').fill('5');await settings(p,'2.000.000,00');
 await fillContribution(p,'Sócio desktop','25.000,00');await saved(p,()=>p.locator('#pc-aporte button').click());
 await open(p,'contracts');await p.locator('[data-pc-contract="u-101"]').click();
 await p.locator('#pc-contract-form [name=commission]').fill('16.750,00');
 await p.locator('#pc-contract-form [name=finalSeries][value="1"]').check();
 await p.locator('#pc-contract-form [name=finalReviewed]').check();
 await p.locator('#pc-contract-form button:not([type])').click();await p.locator('.pc-dialog').waitFor({state:'detached'});
 await fillReceipt(p,'5.000,00');await saved(p,()=>p.locator('#pc-receipt button').click());
 const desktopRecord=remote();assert.equal(desktopRecord.data.receipts.length,1);
 const mobile=await device({width:390}),m=mobile.page;
 assert.equal(await m.evaluate(key=>localStorage.getItem(key),legacyKey),null,'mobile must not receive browser-only storage');
 assert.deepEqual((await m.evaluate(()=>DiamondPrevisaoStore.load())).data,desktopRecord.data);
 await waitTarget(m,'2.000.000,00');assert.match(await text(m,'[data-section="contributions"]'),/Sócio desktop/);
 assert.match(await text(m,'[data-section="receipts"]'),/5.000,00/);
 report('desktop saves appear in a separate mobile browser context without transferring local storage');
 await settings(m,'2.200.000,00');await refresh(p);await waitTarget(p,'2.200.000,00');
 report('manual refresh loads financial changes made by another device');
 await settings(m,'2.300.000,00');await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitTarget(p,'2.300.000,00');
 await settings(m,'2.400.000,00');await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await waitTarget(p,'2.400.000,00');
 report('focus and visibility restore the latest shared forecast');
 await p.locator('#pc-settings [name=payment]').fill('60');
 await settings(m,'2.500.000,00');await refresh(p);
 await p.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await p.locator('#pc-settings [name=payment]').inputValue(),'60');
 assert.equal(await p.locator('#pc-settings [name=target]').inputValue(),'2.400.000,00');
 assert.match(await text(p,'#pc-draft'),/não salva/);
 const beforeConflict=remote();
 await p.locator('#pc-settings button').click();assert.match(await waitError(p),/mudou|atualiz|outro/i);
 assert.deepEqual(remote(),beforeConflict);assert.equal(await p.locator('#pc-settings [name=payment]').inputValue(),'60');
 assert.equal(responses.some(r=>r.operation==='salvar'&&r.status===409),true);
 report('concurrent stale save receives HTTP 409, preserves the draft and does not overwrite remote changes');
 let releaseReload,notifyReload,holdNextReload=true,savesDuringReload=0;
 const reloadGate=new Promise(resolve=>{releaseReload=resolve;}),reloadStarted=new Promise(resolve=>{notifyReload=resolve;});
 const slowReloadRoute=async route=>{
  const body=route.request().postDataJSON();
  if(body?.action==='previsaoCusto'&&body.operacao==='salvar')savesDuringReload++;
  if(body?.action==='previsaoCusto'&&body.operacao==='carregar'&&holdNextReload){holdNextReload=false;notifyReload();await reloadGate;}
  await route.continue();
 };
 await desktop.context.route('**/api/dmd-api',slowReloadRoute);
 const priorReloadForm=await p.locator('#pc-settings').elementHandle();
 try{
  await p.locator('[data-pc-reload]').click();await reloadStarted;
  await p.locator('#pc-settings button').click();
  await p.waitForFunction(()=>/Aguarde o carregamento/.test(document.querySelector('#pc-message')?.textContent||''));
  assert.equal(savesDuringReload,0,'saving during an unresolved central load must not send a write request');
  assert.deepEqual(remote(),beforeConflict);assert.equal(await p.locator('#pc-settings [name=payment]').inputValue(),'60');
 }finally{releaseReload();}
 await priorReloadForm.waitForElementState('hidden',{timeout:15000});await p.locator('#pc-settings').waitFor();
 await desktop.context.unroute('**/api/dmd-api',slowReloadRoute);
 assert.equal(await p.locator('#pc-settings [name=payment]').inputValue(),'60');
 report('saving while the conflict reload is pending sends no write and explains the wait without losing the draft');
 await p.locator('#pc-settings [name=target]').fill('2.500.000,00');await saved(p,()=>p.locator('#pc-settings button').click());
 assert.equal(remote().data.settings.futurePaymentShare,.6);assert.equal(remote().data.settings.targetCents,250000000);
 report('conflict recovery reloads the current revision while retaining the form for explicit reapplication');
 await fillContribution(p,'Sócio sem conexão','1.234,56');
 const beforeOffline=remote();await desktop.context.setOffline(true);
 await p.locator('#pc-aporte button').click();await waitError(p);
 assert.deepEqual(remote(),beforeOffline);assert.equal(await p.locator('#pc-aporte [name=socio]').inputValue(),'Sócio sem conexão');
 assert.equal(await p.locator('#pc-message').getAttribute('role'),'alert');
 await desktop.context.setOffline(false);await saved(p,()=>p.locator('#pc-aporte button').click());
 assert.equal(remote().data.contributions.filter(x=>x.socio==='Sócio sem conexão').length,1);
 report('offline save remains an error with its form preserved; retry creates one contribution');
 await fillReceipt(p,'1.111,11');
 const beforeLost=remote(),observedOperations=[];let loseOnce=true;
 await desktop.context.route('**/api/dmd-api',async route=>{
  const body=route.request().postDataJSON();
  if(body?.action==='previsaoCusto'&&body.operacao==='salvar'){
   observedOperations.push(body.operacaoId);
   if(loseOnce){loseOnce=false;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');return;}
  }
  await route.continue();
 });
 await p.locator('#pc-receipt button').click();await waitError(p);
 assert.equal(remote().data.receipts.length,beforeLost.data.receipts.length+1);
 assert.equal(await p.locator('#pc-receipt [name=valor]').inputValue(),'1.111,11');
 const committedRevision=remote().revision;
 await saved(p,()=>p.locator('#pc-receipt button').click());
 assert.equal(observedOperations.length,2);assert.equal(observedOperations[0],observedOperations[1]);
 assert.equal(remote().revision,committedRevision);assert.equal(remote().data.receipts.length,beforeLost.data.receipts.length+1);
 await desktop.context.unroute('**/api/dmd-api');
 report('a committed receipt with a lost response retries the same operation without duplicate receipt or revision');
 await refresh(m);assert.deepEqual((await m.evaluate(()=>DiamondPrevisaoStore.load())).data,remote().data);
 await m.reload({waitUntil:'networkidle'});await m.locator('#pc-settings').waitFor();
 assert.equal((await m.evaluate(()=>DiamondPrevisaoStore.load())).data.receipts.length,2);
 report('reload and the second device retain confirmed receipts after an ambiguous network failure');
 // Keep a real DOM callback to prove a route-owned form cannot submit against a later view.
 await open(p,'contracts');await p.locator('[data-pc-contract="u-101"]').click();
 await p.locator('#pc-contract-form [name=commission]').fill('1.000,00');
 await p.evaluate(()=>{window.__staleForecastForm=document.querySelector('#pc-contract-form');});
 await p.evaluate(()=>{location.hash='#/admin/painel?visao=resumo';});
 await p.locator('#pc-root').waitFor({state:'detached'});
 await p.locator('.pc-dialog').waitFor({state:'detached',timeout:5000});
 await m.evaluate(async()=>{const record=await DiamondPrevisaoStore.load();record.data.contracts['u-101'].commissionCents=1800000;await DiamondPrevisaoStore.save(record.data,record.revision);});
 await p.evaluate(()=>{location.hash='#/admin/painel?visao=previsao';});await p.locator('#pc-settings').waitFor();
 const afterNewContract=remote(),writesBeforeStale=responses.filter(r=>r.operation==='salvar').length;
 await p.evaluate(async()=>{const form=window.__staleForecastForm;await form.onsubmit({preventDefault(){},target:form});delete window.__staleForecastForm;});
 assert.deepEqual(remote(),afterNewContract);assert.equal(responses.filter(r=>r.operation==='salvar').length,writesBeforeStale);
 assert.equal(await p.locator('.pc-dialog').count(),0);
 report('navigation closes a contract dialog and its obsolete callback cannot overwrite a newer device confirmation');
 const beginDelayedImport=async(page,record)=>{
  await page.evaluate(()=>{
   window.__originalForecastFileText=File.prototype.text;
   File.prototype.text=function(){if(this.name!=='delayed-previsao.json')return window.__originalForecastFileText.call(this);window.__pendingForecastRead=new Promise(resolve=>{window.__resolveForecastRead=resolve;});return window.__pendingForecastRead;};
  });
  await page.locator('#pc-import-file').setInputFiles({name:'delayed-previsao.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record))});
  await page.waitForFunction(()=>typeof window.__resolveForecastRead==='function');
 };
 const finishDelayedImport=async(page,record)=>page.evaluate(async value=>{
  const pending=window.__pendingForecastRead;window.__resolveForecastRead(JSON.stringify(value));await pending;await Promise.resolve();
  File.prototype.text=window.__originalForecastFileText;delete window.__originalForecastFileText;delete window.__pendingForecastRead;delete window.__resolveForecastRead;
 },record);
 const beforeDelayedImport=remote();await beginDelayedImport(p,beforeDelayedImport);
 await p.evaluate(()=>{location.hash='#/admin/painel?visao=resumo';});await p.locator('#pc-root').waitFor({state:'detached'});
 await p.evaluate(()=>{location.hash='#/admin/painel?visao=previsao';});await p.locator('#pc-settings').waitFor();
 await finishDelayedImport(p,beforeDelayedImport);
 assert.equal(await p.locator('.pc-dialog').count(),0);assert.deepEqual(remote(),beforeDelayedImport);
 report('a file read completing after navigation cannot open an import dialog in the new forecast view');
 await beginDelayedImport(p,beforeDelayedImport);
 const originalSession=await p.evaluate(()=>{const original=STORE.getUser();STORE.setUser({usuario:'admin',senhaHash:'fake',nome:'Admin da prévia',papel:'admin',ehMaster:true},true);return original;});
 await finishDelayedImport(p,beforeDelayedImport);
 assert.equal(await p.locator('.pc-dialog').count(),0);assert.deepEqual(remote(),beforeDelayedImport);
 await p.evaluate(session=>STORE.setUser(session,true),originalSession);
 report('a file read completing after a session change cannot open or apply an import for the new user');
 const beforeMerge=remote(),mergeData=structuredClone(beforeMerge.data);
 mergeData.contributions.push(contribution('legacy-aporte-merge','Sócio outra cópia',200000));
 const mergeRaw=JSON.stringify(envelope(mergeData)),legacyDevice=await device({legacy:mergeRaw});
 assert.deepEqual(remote(),beforeMerge,'nonempty remote must not be automatically replaced');
 await saved(legacyDevice.page,()=>legacyDevice.page.locator('[data-pc-migrate]').click());
 assert.equal(remote().data.contributions.length,beforeMerge.data.contributions.length+1);
 assert.deepEqual(remote().data.receipts,beforeMerge.data.receipts);assert.deepEqual(remote().data.settings,beforeMerge.data.settings);
 assert.equal(await legacyDevice.page.evaluate(key=>localStorage.getItem(key),legacyKey),mergeRaw);
 report('an explicit compatible legacy merge adds missing IDs and preserves central receipts, settings and legacy bytes');
 const conflictData=structuredClone(remote().data);conflictData.settings.targetCents=99900000;
 const conflictingRaw=JSON.stringify(envelope(conflictData)),conflictingDevice=await device({legacy:conflictingRaw});
 const beforeLegacyConflict=remote();await conflictingDevice.page.locator('[data-pc-migrate]').click();
 assert.match(await waitError(conflictingDevice.page),/conflit|diferem|preservad/i);
 assert.deepEqual(remote(),beforeLegacyConflict);
 assert.equal(await conflictingDevice.page.evaluate(key=>localStorage.getItem(key),legacyKey),conflictingRaw);
 report('conflicting legacy settings are rejected without replacing the central forecast or deleting old bytes');
 const unauthorized=await device({session:{usuario:'equipe-exemplo',senhaHash:'fake',nome:'Equipe Exemplo',papel:'corretor',ehMaster:true,empresa:'Equipe Exemplo'}});
 assert.equal(await unauthorized.page.locator('#pc-settings').count(),0);
 const denial=await unauthorized.page.evaluate(async()=>{try{await DiamondPrevisaoStore.load();return {allowed:true};}catch(error){return {allowed:false,status:error.status,message:error.message};}});
 assert.equal(denial.allowed,false);assert.equal(denial.status,403);
 const httpDenial=await b.request('previsaoCusto',{operacao:'carregar'},'equipe-exemplo');assert.equal(httpDenial.status,403);
 assert.deepEqual(remote(),beforeLegacyConflict);
 report('an unrelated brokerage has neither the management form nor forecast access in client or server');
 await refresh(m);
 for(const width of [390,320]){
  await m.setViewportSize({width,height:844});
  const dimensions=await m.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.document<=dimensions.viewport+1,JSON.stringify({width,...dimensions}));
  await snapshot(m,'sync-mobile-'+width);
 }
 await snapshot(p,'sync-desktop');report('synced forecast has no horizontal page overflow at 390px and 320px');
 const audit=await (await fetch(base+'/audit-state')).json();
 assert.equal(audit.events.some(e=>e.action==='vendasCondicoes'),false);
 assert.ok(audit.events.filter(e=>e.action==='previsaoCusto').every(e=>e.operacao==='salvar'));
 assert.deepEqual(errors,[]);report('no uncaught browser exceptions or changes to sales contracts');
 fs.writeFileSync(path.join(output,'audit-result.json'),JSON.stringify({status:'PASS',checks:results,responses,errors},null,2));
 console.log(JSON.stringify({status:'PASS',checks:results.length,screenshots:output}));
}catch(error){
 for(const [index,context] of (browser?.contexts()||[]).entries()){const page=context.pages()[0];if(page)await snapshot(page,'failure-'+index).catch(()=>{});}
 fs.writeFileSync(path.join(output,'audit-result.json'),JSON.stringify({status:'FAIL',checks:results,error:error.message,stack:error.stack,responses,errors},null,2));
 console.error(error);process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
