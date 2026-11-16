// Rodar com o servidor de serve-planos-preview.mjs. Nenhum acesso externo é permitido.
const {chromium}=require(process.env.DIAMOND_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:8771',results=[];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.DIAMOND_CHROME?{executablePath:process.env.DIAMOND_CHROME}:{})});
 try{
  for(const width of [320,390,768,1360]){
   const c=await browser.newContext({viewport:{width,height:1000},locale:'pt-BR',serviceWorkers:'block'}),p=await c.newPage(),errors=[];
   p.on('pageerror',e=>errors.push(e.message));await c.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
   await p.goto(base+'/#/sim/u-1');await p.locator('#u-plano').check();
   const summary=async()=>(await p.locator('.uni-plano').innerText()).replace(/\s+/g,' ');
   await p.locator('#u-fin-valor').fill('150.000,00');await p.locator('[data-n="36"]').click();
   assert.equal(await p.locator('[data-n].on').innerText(),'36x');assert.match(await summary(),/112\.069,15/);
   assert.equal(await p.locator('[data-fin],#u-fin-valor').count(),0);
   await p.locator('#u-ent-valor').fill('80.000,00');await p.locator('[data-n="48"]').click();
   assert.equal(await p.locator('[data-n].on').innerText(),'48x');assert.match(await summary(),/80\.000,00/);
   await p.locator('#u-ent-valor').fill('90.000,00');await p.locator('#u-diluir').click();
   assert.equal(await p.locator('#u-diluir').isChecked(),true);assert.match(await summary(),/balões diluídos/);
   await p.locator('#u-ent-valor').fill('80.000,00');await p.locator('#u-ent-valor').press('Tab');
   assert.equal(await p.evaluate(()=>document.activeElement.textContent),'12x');
   await p.locator('[data-ent="20"]').click();
   for(const value of ['-150.000,00','120.000,00,50','abc150000','Infinity']){
    await p.locator('#u-ent-valor').fill(value);await p.locator('#u-ent-valor').press('Enter');
    assert.match(await summary(),/Entrada \(20%\).*74\.712,77/);assert.match(await p.locator('.toast').last().innerText(),/valor válido/);
   }
   await p.locator('#u-diluir').uncheck();
   for(const [n,pct,amount] of [[36,30,'112.069,15'],[48,20,'74.712,77'],[36,30,'112.069,15'],[48,20,'74.712,77']]){
    await p.locator(`[data-n="${n}"]`).click();
    assert.equal(await p.locator('[data-fin],#u-fin-valor').count(),0);
    assert.ok((await p.locator('#u-final-regra').innerText()).includes(pct+'%'));
    assert.ok((await p.locator('#u-final-regra').innerText()).includes(amount));
    assert.match(await summary(),new RegExp('Parcela final \\('+pct+'%\\).*mês '+n));
   }
   assert.match(await summary(),/47 x R\$ 3\.627,88 \+ última de R\$ 3\.627,94/);
   assert.match(await summary(),/20%.*mês 48.*74\.712,77/);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await p.locator('#u-cliente').fill('Auditoria plano inviável '+width);
   await p.locator('#u-ent-valor').fill('350.000,00');await p.locator('#u-pdf').click();
   assert.match(await p.locator('.toast').last().innerText(),/Não sobra valor/);
   const state=await(await p.request.get(base+'/audit-state')).json();assert.ok(!state.propostas.some(x=>x.cliente==='Auditoria plano inviável '+width));
   assert.deepEqual(errors,[]);results.push({width,status:'passed',checks:['final automática sem opções extras','troca de prazo descarta final personalizada anterior','clique após digitar entrada','diluição após digitar','foco por Tab','entradas inválidas','totais e final no mês 48','layout sem corte','plano inviável bloqueado']});await c.close();
  }
  // Preço de teste que gerava final 1 centavo abaixo do mínimo e impedia a emissão.
  const c=await browser.newContext({viewport:{width:1360,height:1000},locale:'pt-BR',serviceWorkers:'block'}),p=await c.newPage();
  await c.route('**/*',async r=>{
   if(!r.request().url().startsWith(base))return r.abort();
   if(r.request().url().includes('/api/dmd-api')&&r.request().postDataJSON()?.action==='list'){
    const response=await r.fetch(),data=await response.json();for(const u of data.unidades||[])if(u.id==='u-1')u.precoBase=150000.05;
    return r.fulfill({response,json:data});
   }
   return r.continue();
  });
  await p.goto(base+'/#/sim/u-1');await p.locator('#u-plano').check();await p.locator('[data-n="36"]').click();
  assert.match(await p.locator('#u-final-regra').innerText(),/45\.000,02/);
  assert.match(await p.locator('.uni-plano').innerText(),/45\.000,02/);
  await p.locator('#u-cliente').fill('Auditoria centavos 15000005');
  const download=p.waitForEvent('download');await p.locator('#u-pdf').click();await(await download).saveAs('/private/tmp/diamond-auditoria-centavos.pdf');
  const state=await(await p.request.get(base+'/audit-state')).json(),saved=state.propostas.find(x=>x.cliente==='Auditoria centavos 15000005');
  assert.ok(saved);assert.equal(saved.inp.arredondamento,'decimal-v1');assert.equal(saved.inp.regrasPlano,'36-48-v1');assert.equal(saved.inp.nParcelas,36);
  assert.match(saved.resumoEnvio.itens.find(x=>x.rotulo==='Parcela final').valor,/45\.000,02/);
  results.push({case:'150000.05',status:'passed',checks:['mínimo e final coincidem','PDF emitido','versão do cálculo salva','resumo e registro conferem']});await c.close();
  fs.writeFileSync('/private/tmp/diamond-auditoria-browser-final.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
