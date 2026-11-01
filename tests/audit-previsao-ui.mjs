// Browser audit with synthetic contracts and an isolated, in-memory API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {criarServidorVendas} from './serve-vendas-preview.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/leonardopereira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const port=Number(process.env.PREVIEW_PORT)||8795;
const {server,base,b}=criarServidorVendas(port);
const stamp='2026-10-21T12:00:00.000Z';
const units=b.table('unidades');
units.set('u-102',{...units.get('u-102'),clienteId:'preview-cliente-2',compradorNome:'Cliente Exemplo Dois'});
units.set('u-105',{...units.get('u-103'),id:'u-105',unidade:'105',precoBase:500000});
units.set('u-106',{...units.get('u-103'),id:'u-106',unidade:'106',precoBase:800000});
const condition=(id,total,entry,barter,common,final)=>({
 unidadeId:id,clienteId:units.get(id).clienteId,unidadeRevisao:stamp,revisao:1,total:total*100,entrada:entry*100,data:'2026-10-16',
 permutas:barter?[{descricao:'Bem fictício',valor:barter*100}]:[],
 parcelas:[{descricao:'Mensais',quantidade:10,valor:common*10,primeiro:'2026-11-10',intervalo:1},{descricao:'Final',quantidade:1,valor:final*100,primeiro:'2028-12-10',intervalo:1}],
 observacoes:'Contrato sintético da auditoria de UI',correcao:'',historico:[],atualizadoEm:stamp,atualizadoPor:'domo'
});
b.table('vendas_condicoes').set('u-101',condition('u-101',400000,40000,60000,100000,200000));
b.table('vendas_condicoes').set('u-102',condition('u-102',600000,100000,0,200000,300000));
const output=path.join(root,'output-previsao');fs.mkdirSync(output,{recursive:true});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let browser;
const results=[],errors=[];
const report=(label)=>{results.push(label);console.log('PASS '+label);};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'pt-BR'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
 const text=async s=>(await page.locator(s).textContent()).replaceAll('\u00a0',' ').trim();
 const value=key=>text('[data-pc-value="'+key+'"]');
 const metric=label=>page.locator('.pc-metric').filter({has:page.locator('span').filter({hasText:new RegExp('^'+label+'$')})}).locator('strong');
 const metricValue=async label=>(await metric(label).textContent()).replaceAll('\u00a0',' ').trim();
 const open=async name=>{const d=page.locator('[data-section="'+name+'"]');if(!await d.evaluate(n=>n.open))await d.locator('summary').click();};
 await page.goto(base+'/#/admin/painel?visao=previsao',{waitUntil:'networkidle'});
 await page.locator('#pc-settings').waitFor({timeout:15000});
 assert.equal(await value('target'),'R$ 17.000.000,00');
 assert.equal(await value('coverage'),'A conferir');assert.equal(await value('sales-goal'),'A conferir');
 assert.equal(await page.locator('#pc-settings [name=payment]').inputValue(),'50');
 assert.equal(await page.locator('#pc-settings [name=final]').inputValue(),'50');
 assert.equal(await page.locator('#pc-settings [name=commission]').inputValue(),'');
 report('initial unknown values stay unknown; default 17M and 50/50');
 await page.locator('#pc-settings [name=target]').fill('1.000.000,00');
 await page.locator('#pc-settings [name=commission]').fill('5');
 await page.locator('#pc-settings button').click();
 await page.locator('#pc-settings [name=payment]').fill('60');
 await open('contributions');
 await page.locator('#pc-aporte [name=socio]').fill('Sócio de exemplo');
 await page.locator('#pc-aporte [name=data]').fill('2026-10-20');
 await page.locator('#pc-aporte [name=valor]').fill('200.000,00');
 await page.locator('#pc-aporte button').click();
 assert.equal(await value('coverage'),'A conferir');
 assert.equal((await page.evaluate(()=>DiamondPrevisaoStore.load())).data.contributions.length,1,'aporte form must persist (hidden name=id cannot shadow submit routing)');
 assert.equal(await page.locator('#pc-settings [name=payment]').inputValue(),'60','saving aporte must preserve another form draft');
 assert.equal((await page.evaluate(()=>DiamondPrevisaoStore.load())).data.settings.futurePaymentShare,.5,'saving aporte cannot silently save the settings draft');
 assert.match(await text('#pc-draft'),/não salva/);
 await page.locator('#pc-settings [name=payment]').fill('50');
 await page.locator('#pc-settings button').click();
 report('saving a contribution preserves unsaved settings without silently persisting them');
 await open('contributions');
 await page.locator('#pc-aportes-reviewed').check();
 const confirmContract=async(id,commission)=>{
  await page.locator('[data-pc-contract="'+id+'"]').click();
  const form=page.locator('#pc-contract-form');
  await form.locator('[name=commission]').fill(commission);
  await form.locator('[name=finalSeries][value="1"]').check();
  await form.locator('[name=finalReviewed]').check();
  await form.locator('button[type=submit], button:not([type])').last().click();
  await page.locator('.pc-dialog').waitFor({state:'detached'});
 };
 await confirmContract('u-101','20.000,00');await confirmContract('u-102','30.000,00');
 assert.equal(await value('coverage'),'R$ 650.000,00');assert.equal(await value('shortfall'),'R$ 350.000,00');
 assert.equal(await value('sales-goal'),'R$ 777.777,78');
 assert.equal(await metricValue('Permutas'),'R$ 60.000,00');assert.equal(await metricValue('Parcelas finais contratadas'),'R$ 500.000,00');
 await open('cash');assert.equal(await metricValue('Recebido durante a obra'),'A conferir');
 report('contract commissions, explicit finals and contributions produce correct coverage without duplicate barter');
 await open('receipts');
 const receipt=async(nature,amount)=>{
  await page.locator('#pc-receipt [name=unitId]').selectOption('u-101');
  await page.locator('#pc-receipt [name=data]').fill('2026-10-21');
  await page.locator('#pc-receipt [name=natureza]').selectOption(nature);
  await page.locator('#pc-receipt [name=valor]').fill(amount);
  await page.locator('#pc-receipt button').click();
 };
 await receipt('comum','40.000,00');await receipt('final','10.000,00');
 assert.equal(await value('coverage'),'R$ 650.000,00');
 const before=await page.evaluate(()=>DiamondPrevisaoStore.load());
 assert.equal(before.data.receipts.length,2);
 await receipt('comum','101.000,00');
 assert.match(await text('#pc-message'),/superam o valor contratado/);
 assert.equal((await page.evaluate(()=>DiamondPrevisaoStore.load())).revision,before.revision);
 for(const id of ['u-101','u-102']){
  await page.locator('[data-pc-contract="'+id+'"]').click();
  await page.locator('#pc-contract-form [name=receiptsReviewed]').check();
  await page.locator('#pc-contract-form button:not([type])').click();
  await page.locator('.pc-dialog').waitFor({state:'detached'});
 }
 assert.equal(await metricValue('Recebido durante a obra'),'R$ 40.000,00');assert.equal(await metricValue('Final já recebida'),'R$ 10.000,00');
 assert.equal(await metricValue('A receber durante a obra'),'R$ 400.000,00');assert.equal(await metricValue('Final ainda a receber'),'R$ 490.000,00');
 assert.equal(await value('coverage'),'R$ 650.000,00');
 report('actual common and final receipts stay separate; over-receipt is rejected without changing storage');
 await page.reload({waitUntil:'networkidle'});await page.locator('#pc-settings').waitFor();
 assert.equal(await value('coverage'),'R$ 650.000,00');assert.equal(await value('sales-goal'),'R$ 777.777,78');
 const saved=await page.evaluate(()=>DiamondPrevisaoStore.load());assert.equal(saved.data.receipts.length,2);
 assert.equal(saved.data.contributions.length,1);
 await page.locator('#pc-settings [name=payment]').fill('60');
 assert.equal(await page.locator('#pc-settings [name=final]').inputValue(),'40');
 assert.equal(await value('sales-goal'),'R$ 636.363,64');assert.equal(await value('coverage'),'R$ 650.000,00');
 await page.locator('#pc-settings button').click();
 report('reload preserves ledger; live 60/40 changes only the future sales goal');
 await page.locator('#pc-settings [name=commission]').fill('60');assert.equal(await value('sales-goal'),'A conferir');
 await page.locator('#pc-settings button').click();assert.match(await text('#pc-message'),/comissão deve ser menor/);
 assert.equal((await page.evaluate(()=>DiamondPrevisaoStore.load())).data.settings.futureCommissionRate,.05);
 await page.locator('#pc-settings [name=commission]').fill('5');
 await page.locator('#pc-settings button').click();
 report('invalid future net share cannot produce a sale goal or overwrite saved settings');
 await open('inventory');
 assert.equal(await page.locator('[data-pc-stock]').count(),3);
 assert.equal(await metricValue('Estoque em tabela'),'R$ 1.645.000,00');
 await page.locator('[data-pc-stock="u-105"]').check();
 assert.equal(await metricValue('Selecionado para vender'),'R$ 500.000,00');assert.equal(await metricValue('Falta após a seleção'),'R$ 75.000,00');
 report('stock uses current available prices and selected units net of future commission');
 const orig=units.get('u-103');units.set('u-103',{...orig,precoBase:400000});
 await page.evaluate(()=>DiamondPrevisao.refresh());
 assert.equal(await metricValue('Estoque em tabela'),'R$ 1.700.000,00');
 assert.equal(await value('coverage'),'R$ 650.000,00');
 report('refresh recomputes inventory from changed source table without changing contracted sales');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(output,'previsao-desktop-viewport.png')});
 await page.screenshot({path:path.join(output,'previsao-desktop.png'),fullPage:true});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
  const dimensions=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth,root:document.querySelector('#pc-root').getBoundingClientRect().width}));
  assert.ok(dimensions.document<=dimensions.viewport+1,JSON.stringify(dimensions));
  await page.screenshot({path:path.join(output,`previsao-mobile-${width}.png`),fullPage:true});
 }
 report('mobile 390px and 320px have no horizontal page overflow');
 await page.setViewportSize({width:1440,height:1100});
 const currentContract=b.table('vendas_condicoes').get('u-101');
 b.table('vendas_condicoes').set('u-101',{...currentContract,revisao:2});
 await page.evaluate(()=>DiamondPrevisao.refresh());
 assert.equal(await value('coverage'),'A conferir');
 const afterRevision=await page.evaluate(()=>DiamondPrevisaoStore.load());
 assert.equal(afterRevision.data.receipts.length,2);
 await open('receipts');assert.match(await text('[data-section="receipts"]'),/contratos alterados ou inativos/);
 report('changed contract revision invalidates confirmation while preserving old receipt records');
 const audit=await (await fetch(base+'/audit-state')).json();
 assert.equal(audit.events.filter(v=>v.action==='vendasCondicoes').length,0);
 const url=(await page.url());assert.ok(url.startsWith(base));
 assert.deepEqual(errors,[]);report('no uncaught browser exceptions or contract writes to API');
 fs.writeFileSync(path.join(output,'audit-result.json'),JSON.stringify({status:'PASS',checks:results,errors},null,2));
 console.log(JSON.stringify({status:'PASS',checks:results.length,screenshots:output}));
}catch(err){
 const failedPage=browser?.contexts()[0]?.pages()[0];if(failedPage)await failedPage.screenshot({path:path.join(output,'previsao-failure.png'),fullPage:true}).catch(()=>{});
 fs.writeFileSync(path.join(output,'audit-result.json'),JSON.stringify({status:'FAIL',checks:results,error:err.message,stack:err.stack,errors},null,2));
 console.error(err);process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
