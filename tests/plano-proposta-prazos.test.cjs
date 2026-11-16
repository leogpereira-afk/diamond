const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {window:{}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../plano.js'),'utf8'),ctx);
const P = ctx.window.PLANO;
const cfg = {planoParcelas:[12,24,36],planoFinalOpcoes:[30,40,50],planoFinalPct:.3,chavesMes:36};
const valor = 373563.84;
const plano = (n, final, balQtde=5) => P.calc({arredondamento:'decimal-v1',neg:valor,forma:'perso',entradaPct:.20,
  finalPct:final/100,nParcelas:n,balQtde,balValor:10000,balPrimeiro:6,balIntervalo:6,
  chavesMes:P.condicoesProposta(n,cfg).mesFinal});

test('36 e 48 estão disponíveis com configuração anterior, sem modificá-la',()=>{
  const antes=JSON.stringify(cfg);
  assert.deepEqual([...P.opcoesParcelasProposta(cfg)],[12,24,36,48]);
  assert.equal(JSON.stringify(cfg),antes);
  assert.deepEqual([...P.opcoesParcelasProposta({planoParcelas:[48,36,36,18]})],[18,36,48]);
});
test('mínimo e opções da final acompanham o prazo, inclusive com opções antigas menores',()=>{
  const antes=JSON.stringify(cfg);
  for(const [n,minimo,opcoes,mes] of [[36,30,[30,40,50],36],[48,20,[20,30,40,50],48]]){
    const r=P.condicoesProposta(n,{...cfg,planoFinalOpcoes:[10,20,30,40,50]});
    assert.equal(r.minimoFinalPct,minimo);
    assert.equal(r.finalPadraoPct,minimo);
    assert.deepEqual([...r.opcoesFinal],opcoes);
    assert.equal(r.mesFinal,mes);
  }
  assert.equal(JSON.stringify(cfg),antes);
  assert.equal(P.condicoesProposta(24,cfg).minimoFinalPct,0);
});
test('exemplo da imagem em 36 vezes fecha ao centavo com final de 30%',()=>{
  const p=plano(36,30);
  assert.equal(p.ent,74712.77);assert.equal(p.fin,112069.15);
  assert.equal(p.somaBaloes,50000);assert.equal(p.somaParcelas,136781.92);
  assert.equal(p.vParc,3799.49);assert.equal(p.ultimaParcela,3799.77);
  assert.equal(p.totalNominal,valor);assert.equal(p.fecha,true);
  assert.equal(p.cronograma.find(x=>x.chaves).m,36);
  assert.equal(P.linhasSeparadas(p).reduce((s,x)=>s+Math.round(x.total*100),0),37356384);
});
test('48 vezes fecha ao centavo e só cobra a final de 20% no mês 48',()=>{
  const p=plano(48,20);
  assert.equal(p.ent,74712.77);assert.equal(p.fin,74712.77);
  assert.equal(p.somaBaloes,50000);assert.equal(p.somaParcelas,174138.30);
  assert.equal(p.vParc,3627.88);assert.equal(p.ultimaParcela,3627.94);
  assert.equal(p.totalNominal,valor);assert.equal(p.fecha,true);
  assert.equal(p.cronograma.filter(x=>x.parcela).length,48);
  assert.equal(p.cronograma.find(x=>x.m===36).chaves,0);
  assert.equal(p.cronograma.find(x=>x.chaves).m,48);
  assert.deepEqual([...p.cronograma.filter(x=>x.balao).map(x=>x.m)],[6,12,18,24,30]);
  assert.equal(P.linhasSeparadas(p).reduce((s,x)=>s+Math.round(x.total*100),0),37356384);
});
test('final maior e balões diluídos mantêm soma exata nos dois prazos',()=>{
  for(const n of [36,48])for(const final of [30,40,50])for(const bal of [0,5]){
    const p=plano(n,final,bal);
    assert.equal(p.fecha,true);assert.equal(p.totalNominal,valor);
    assert.equal(p.fin,Math.round(valor*final)/100);
    assert.equal(p.somaBaloes,bal*10000);
  }
});
test('o motor mantém condições de registros antigos sem aplicar pisos retroativamente',()=>{
  const p=P.calc({neg:valor,forma:'perso',entradaPct:.2,finalPct:0,nParcelas:36,balQtde:0});
  assert.equal(p.fin,0);assert.equal(p.fecha,true);
  const p48=P.calc({neg:valor,forma:'perso',entradaPct:.2,finalPct:.1,nParcelas:48,chavesMes:36});
  assert.equal(p48.fin,37356.38);assert.equal(p48.chavesMes,36);
});

test('arredondamento decimal dos novos planos respeita o piso até nos meios centavos',()=>{
  const base={neg:150000.05,forma:'perso',entradaPct:.2,finalPct:.3,nParcelas:36,balQtde:5,balValor:10000};
  const novo=P.calc({...base,arredondamento:'decimal-v1'});
  assert.equal(novo.fin,45000.02);
  assert.equal(novo.totalNominal,150000.05);
  assert.equal(P.valorPercentual(base.neg,30),novo.fin);
  assert.equal(P.calc(base).fin,45000.01,'registro antigo mantém seu cálculo anterior');
});

test('valor personalizado aceita formatos monetários e rejeita sinais e separadores inválidos',()=>{
  for(const txt of ['150.000,00','R$ 150.000,00','150000.00','150000,00','150.000','150000'])assert.equal(P.lerValorMonetario(txt),150000);
  for(const txt of ['-150.000,00','+150000','120.000,00,50','120.00,00','150000.001','1e5','NaN','Infinity','abc150000',''])assert.ok(Number.isNaN(P.lerValorMonetario(txt)),txt);
  assert.equal(P.lerValorMonetario('0'),0);
  assert.equal(P.lerValorMonetario('0,01'),.01);
});
