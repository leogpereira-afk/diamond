import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {reconcile as rec,confirm as conf} from '../supabase/functions/dmd-sheets/sync.mjs';
const SHEET='planilha-de-teste';
const reconcile=(...a)=>rec(...a,SHEET),confirm=(...a)=>conf(...a,SHEET);
const V=createRequire(import.meta.url)('../vagas-domain.js');
function source(){const f={spreadsheetId:SHEET,vinculos:[['Apartamento','Tipologia / Área','Cliente / Proprietário','Vaga Vinculada','Confirmação (V/R)','Pavimento da Vaga','Status','Contratos','Início','Término','Contador de Dias','']],gestao:[['Vaga','Pavimento','Apartamento','Cliente / Proprietário','Status','Data da Reserva','Prazo de Expiração','Observações']]};for(let i=1;i<=82;i++){f.vinculos.push(['Apto '+(400+i),'40 m²','','','','','Disponível','','','','formula','']);f.gestao.push([V.codigo(i),V.PISOS[V.piso(i)].nome,'','','Disponível','','','']);}return f;}
function local(f){const s=V.importar(f);s.ajustes={V01:V.validarAjuste('V01',{situacao:'vendida',cliente:'Teste',apartamento:'Apto 401',contrato:'Finalizado',motivo:'conferido'},s)};return s;}
function apply(f,p){for(const x of p.patches){const m=x.celula.match(/([A-Z])(\d+)/);const rows=x.aba==='Gestão de Vagas'?f.gestao:f.vinculos;rows[+m[2]-8][m[1].charCodeAt(0)-66]=x.depois;}return f;}
test('Diamond -> ambas as abas, confirmação, idempotência e fórmulas intactas',()=>{const f=source(),s=local(f),p=reconcile(V,s,f,'agora','x');assert.ok(p.sync.pendente);assert.ok(p.sync.pendente.patches.every(x=>!/^L|^M/.test(x.celula)));apply(f,p.sync.pendente);const done=confirm(V,p,f,'x','depois');assert.equal(done.sync.pendente,null);assert.equal(V.efetivas(done)[0].situacao,'vendida');assert.equal(reconcile(V,done,f,'depois','y').sync.pendente,null);assert.equal(f.vinculos[1][10],'formula');});
test('planilha -> Diamond após confirmação anterior',()=>{const f=source(),p=reconcile(V,local(f),f,'a','x');apply(f,p.sync.pendente);const done=confirm(V,p,f,'x','b');f.gestao[1][3]='Novo';f.vinculos[1][2]='Novo';const next=reconcile(V,done,f,'c','y');assert.equal(next.ajustes.V01,undefined);assert.equal(V.efetivas(next)[0].cliente,'Novo');});
test('edições simultâneas não sobrescrevem nenhuma ponta',()=>{const f=source(),s=local(f);f.gestao[1][7]='Alterado na planilha';const p=reconcile(V,s,f,'a','x');assert.equal(p.sync.pendente,null);assert.deepEqual(p.sync.conflitos,['V01']);assert.equal(V.efetivas(p)[0].situacao,'conferir');});
test('não confirma escrita parcial nem aceita outra planilha',()=>{const f=source(),p=reconcile(V,local(f),f,'a','x');assert.throws(()=>confirm(V,p,f,'x','b'),/confirmou/);assert.throws(()=>reconcile(V,p,{...f,spreadsheetId:'outra'},'a','x'),/autorizada/);});
test('não transfere vaga que já está vinculada na planilha',()=>{const f=source(),s=local(f);f.vinculos[1][3]='V02';const raw=V.importar(f);s.vagas=raw.vagas;s.ajustes.V01.assinatura=raw.vagas[0].assinatura;const p=reconcile(V,s,f,'a','x');assert.deepEqual(p.sync.conflitos,['V01']);assert.equal(p.sync.pendente,null);});

test('coluna vazia do CSV não gera falso conflito',()=>{const f=source(),s=local(f);const old=JSON.parse(s.ajustes.V01.assinatura);old.gestao['']='';s.ajustes.V01.assinatura=JSON.stringify(old);const p=reconcile(V,s,f,'a','x');assert.deepEqual(p.sync.conflitos,[]);assert.ok(p.sync.pendente);});

test('aba única define situação e vincula apartamento sem depender da aba removida',()=>{const f=source();delete f.gestao;f.vinculos[1][2]='Cliente';f.vinculos[1][3]='V19';f.vinculos[1][4]='V';f.vinculos[1][6]='Vinculada / Vendida';const s=V.importar(f);assert.equal(s.fonte.abaUnica,true);assert.equal(s.vagas[18].situacao,'vendida');assert.equal(s.vagas[18].apartamento,'Apto 401');assert.equal(s.vagas[56].situacao,'disponivel');assert.equal(s.vagas.filter(v=>v.alertas.length).length,0);});
test('salvar no Diamond atualiza somente a aba única e confirma retorno',()=>{const f=source();delete f.gestao;const s=local(f),p=reconcile(V,s,f,'a','x');assert.ok(p.sync.pendente.patches.every(x=>x.aba==='Vagas de Garagem'));apply(f,p.sync.pendente);const done=confirm(V,p,f,'x','b');assert.equal(done.sync.pendente,null);assert.equal(V.efetivas(done)[0].cliente,'Teste');});

function soldSource(duasAbas=true){
  const f=source();if(!duasAbas)delete f.gestao;
  const p=reconcile(V,local(f),f,'inicial','venda');apply(f,p.sync.pendente);
  return {f,s:confirm(V,p,f,'venda','confirmada')};
}
function move(s,from='V01',to='V02'){
  const original=V.efetivas(s).find(v=>v.codigo===from);
  const m=V.validarMudancaVaga(from,to,{...original,motivo:'Transferir vaga'},s);
  s.ajustes[from]=m.origem;s.ajustes[to]=m.destino;return s;
}

for(const duasAbas of [true,false])test(`troca de vaga conserva o vínculo completo e confirma ambas as vagas (${duasAbas?'duas abas':'aba única'})`,()=>{
  const {f,s}=soldSource(duasAbas),p=reconcile(V,move(s),f,'troca','mover');
  assert.deepEqual(p.sync.conflitos,[]);
  assert.deepEqual(p.sync.pendente.codigos,['V01','V02']);
  assert.deepEqual(p.sync.pendente.patches.filter(x=>x.aba==='Vagas de Garagem'&&x.celula==='E9'),[{aba:'Vagas de Garagem',celula:'E9',antes:'V01',depois:'V02'}]);
  assert.equal(new Set(p.sync.pendente.patches.map(x=>x.aba+x.celula)).size,p.sync.pendente.patches.length);
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'mover','fim');
  const [origem,destino]=V.efetivas(done);
  assert.equal(origem.situacao,'disponivel');assert.equal(origem.apartamento,'');
  assert.equal(destino.situacao,'vendida');assert.equal(destino.apartamento,'Apto 401');assert.equal(destino.cliente,'Teste');
  assert.equal(done.vagas.filter(v=>v.alertas.length).length,0);
  assert.equal(reconcile(V,done,f,'outra consulta','nova').sync.pendente,null);
});

for(const ponta of ['origem','destino'])test(`conflito na ${ponta} suspende a troca inteira sem liberar a vaga antiga`,()=>{
  const {f,s}=soldSource();move(s);
  f.gestao[ponta==='origem'?1:2][7]='Edição concorrente';
  const p=reconcile(V,s,f,'agora','conflito');
  assert.deepEqual(p.sync.conflitos,['V01','V02']);
  assert.equal(p.sync.pendente,null);
  assert.equal(f.vinculos[1][3],'V01');
  assert.equal(p.ajustes.V02.apartamento,'Apto 401');
});

test('confirmação de troca recusa escrita parcial e mantém a operação pendente',()=>{
  const {f,s}=soldSource(),p=reconcile(V,move(s),f,'troca','mover');
  apply(f,{patches:p.sync.pendente.patches.filter(x=>x.aba==='Gestão de Vagas')});
  assert.throws(()=>confirm(V,p,f,'mover','fim'),/confirmou/);
  assert.equal(p.sync.pendente.id,'mover');assert.equal(f.vinculos[1][3],'V01');
});

test('vaga disponível com vínculo estrutural não vira reserva na planilha',()=>{
  const f=source(),s=V.importar(f);
  s.ajustes={V01:{situacao:'disponivel',apartamento:'Apto 401',cliente:'',contrato:'',reserva:'',expiracao:'',observacoes:'',motivo:'Vincular',vinculoEstrutural:true,assinatura:s.vagas[0].assinatura}};
  const p=reconcile(V,s,f,'agora','vincular');apply(f,p.sync.pendente);
  assert.equal(f.vinculos[1][4],'');assert.equal(f.vinculos[1][6],'Disponível');
  const done=confirm(V,p,f,'vincular','fim');assert.equal(done.vagas[0].situacao,'disponivel');assert.equal(done.vagas[0].apartamento,'Apto 401');
});

function structural(f){
  delete f.gestao;f.vinculos[0][11]='Observações';
  f.vinculos[1]=['Apto 401','40 m²','Cliente original','','','Térreo','Vinculada / Vendida','Em elaboração','','','formula','Observação original'];
  const s=V.importar(f);
  s.ajustes={V01:{situacao:'vendida',apartamento:'Apto 401',cliente:'Cliente original',contrato:'Em elaboração',reserva:'',expiracao:'',observacoes:'Observação original',motivo:'Vincular',vinculoEstrutural:true,somenteVinculo:true,assinatura:s.vagas[0].assinatura}};
  return s;
}

test('primeiro vínculo estrutural preserva todos os dados existentes do apartamento',()=>{
  const f=source(),s=structural(f),antes=structuredClone(f.vinculos[1]);
  const p=reconcile(V,s,f,'agora','vincular');
  assert.deepEqual(p.sync.pendente.patches,[{aba:'Vagas de Garagem',celula:'E9',antes:'',depois:'V01'}]);
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'vincular','fim');
  const esperado=[...antes];esperado[3]='V01';assert.deepEqual(f.vinculos[1],esperado);
  assert.equal(done.ajustes.V01.somenteVinculo,undefined);assert.equal(done.ajustes.V01.vinculoEstrutural,true);
  assert.equal(done.vagas[0].cliente,'Cliente original');assert.equal(done.vagas[0].situacao,'vendida');
  assert.equal(reconcile(V,done,f,'outra consulta','nova').sync.pendente,null);
});

test('primeiro vínculo estrutural exige conferir mudanças concorrentes no apartamento',()=>{
  const f=source(),s=structural(f);f.vinculos[1][2]='Novo proprietário';
  const p=reconcile(V,s,f,'agora','vincular');
  assert.deepEqual(p.sync.conflitos,['V01']);assert.equal(p.sync.pendente,null);assert.equal(f.vinculos[1][3],'');
});

test('confirmação do primeiro vínculo recusa dados alterados durante a escrita',()=>{
  const f=source(),s=structural(f),p=reconcile(V,s,f,'agora','vincular');
  apply(f,p.sync.pendente);f.vinculos[1][2]='Outro proprietário';
  assert.throws(()=>confirm(V,p,f,'vincular','fim'),/divergente/);
  assert.equal(p.sync.pendente.id,'vincular');
});

test('conflito numa troca não impede atualização de outra vaga independente',()=>{
  const {f,s}=soldSource();move(s);
  s.ajustes.V03=V.validarAjuste('V03',{situacao:'vendida',cliente:'Outro cliente',apartamento:'Apto 403',motivo:'Venda independente'},s);
  f.gestao[2][7]='Edição concorrente';
  const p=reconcile(V,s,f,'agora','conflito');
  assert.deepEqual(p.sync.conflitos,['V01','V02']);assert.deepEqual(p.sync.pendente.codigos,['V03']);
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'conflito','fim');
  assert.equal(f.vinculos[1][3],'V01');assert.equal(done.vagas[2].situacao,'vendida');assert.equal(done.vagas[2].apartamento,'Apto 403');
});

test('vínculo estrutural espelha a segunda aba sem alterar dados do apartamento',()=>{
  const f=source(),g=f.gestao,seed=structural(f);f.gestao=g;
  const s=V.importar(f);s.ajustes={V01:{...seed.ajustes.V01,assinatura:s.vagas[0].assinatura}};
  const antes=structuredClone(f.vinculos[1]),p=reconcile(V,s,f,'agora','vincular');
  assert.deepEqual(p.sync.pendente.patches.filter(x=>x.aba==='Vagas de Garagem'),[{aba:'Vagas de Garagem',celula:'E9',antes:'',depois:'V01'}]);
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'vincular','fim');
  const esperado=[...antes];esperado[3]='V01';assert.deepEqual(f.vinculos[1],esperado);
  assert.equal(done.vagas[0].situacao,'vendida');assert.equal(done.vagas[0].cliente,'Cliente original');assert.equal(done.vagas[0].alertas.length,0);
});

test('troca para vaga anterior na numeração preserva o mesmo apartamento',()=>{
  const {f,s}=soldSource(false),p=reconcile(V,move(s),f,'ida','mover');apply(f,p.sync.pendente);
  const done=confirm(V,p,f,'mover','fim'),volta=reconcile(V,move(done,'V02','V01'),f,'volta','voltar');
  assert.deepEqual(volta.sync.conflitos,[]);apply(f,volta.sync.pendente);
  const final=confirm(V,volta,f,'voltar','fim');
  assert.equal(final.vagas[0].apartamento,'Apto 401');assert.equal(final.vagas[1].apartamento,'');assert.equal(final.vagas[1].situacao,'disponivel');
});

test('planilha sem coluna de observações continua aceitando anotações locais',()=>{
  const f=source();delete f.gestao;
  const s=local(f);s.ajustes.V01.observacoes='Anotação mantida no Diamond';
  const p=reconcile(V,s,f,'agora','salvar');apply(f,p.sync.pendente);
  const done=confirm(V,p,f,'salvar','fim');
  assert.equal(V.efetivas(done)[0].observacoes,'Anotação mantida no Diamond');
  assert.equal(done.sync.pendente,null);
});

function reopen(s,apartamento='Apto 401'){
  s.ajustesUnidades={...(s.ajustesUnidades||{}),[apartamento]:{id:'reabertura-401',em:'agora',por:'ADM',motivo:'Reabrir a unidade',antes:structuredClone(s.unidades.find(u=>u.apartamento===apartamento)),depois:{'cliente / proprietario':'','confirmacao (v/r)':'',status:'Disponível',contratos:'',inicio:'',termino:''}}};
  return s;
}

test('reabrir unidade sem vaga limpa somente seus dados comerciais e confirma por apartamento',()=>{
  const f=source();delete f.gestao;
  f.vinculos[1]=['Apto 401','40 m²','Antigo comprador','','V','Térreo','Vinculada / Vendida','Finalizado','01/10/2026','05/10/2026','formula','Observação preservada'];
  f.vinculos[2]=['Apto 402','42 m²','Outro comprador','V01','V','Térreo','Vinculada / Vendida','Finalizado','','','formula',''];
  const outra=structuredClone(f.vinculos[2]),s=reopen(V.importar(f)),p=reconcile(V,s,f,'agora','reabrir');
  assert.deepEqual(p.sync.conflitosUnidades,[]);assert.deepEqual(p.sync.pendente.codigos,[]);
  assert.deepEqual(p.sync.pendente.unidades,[{apartamento:'Apto 401',id:'reabertura-401'}]);
  assert.deepEqual(p.sync.pendente.patches.map(x=>x.celula),['D9','F9','H9','I9','J9','K9']);
  assert.deepEqual(p.sync.pendente.patches.find(x=>x.celula==='F9'),{aba:'Vagas de Garagem',celula:'F9',antes:'V',depois:''});
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'reabrir','fim');
  assert.deepEqual(f.vinculos[1],['Apto 401','40 m²','','','','Térreo','Disponível','','','','formula','Observação preservada']);
  assert.deepEqual(f.vinculos[2],outra);assert.equal(done.vagas[0].apartamento,'Apto 402');assert.equal(done.vagas[0].cliente,'Outro comprador');
  assert.equal(done.ajustesUnidades['Apto 401'],undefined);assert.equal(done.sync.pendente,null);
  assert.equal(reconcile(V,done,f,'seguinte','outra').sync.pendente,null);
});

test('reabertura com linha comercial alterada exige conferência sem sobrescrever',()=>{
  const f=source();delete f.gestao;f.vinculos[1][2]='Comprador';f.vinculos[1][4]='V';f.vinculos[1][6]='Vendida';
  const s=reopen(V.importar(f));f.vinculos[1][2]='Edição concorrente';
  const p=reconcile(V,s,f,'agora','reabrir');
  assert.deepEqual(p.sync.conflitosUnidades,['Apto 401']);assert.equal(p.sync.pendente,null);
  assert.equal(f.vinculos[1][2],'Edição concorrente');assert.ok(p.ajustesUnidades['Apto 401']);
});

test('reabertura com vaga estrutural confirma os dois ajustes sem duplicar células',()=>{
  const {f,s}=soldSource();reopen(s);
  s.ajustes.V01={...s.ajustes.V01,situacao:'disponivel',cliente:'',contrato:'',reserva:'',expiracao:'',vinculoEstrutural:true,motivo:'Reabrir'};
  const p=reconcile(V,s,f,'agora','reabrir');
  assert.deepEqual(p.sync.pendente.codigos,['V01']);assert.equal(p.sync.pendente.unidades.length,1);
  assert.equal(new Set(p.sync.pendente.patches.map(x=>x.aba+x.celula)).size,p.sync.pendente.patches.length);
  apply(f,p.sync.pendente);const done=confirm(V,p,f,'reabrir','fim');
  assert.equal(done.vagas[0].situacao,'disponivel');assert.equal(done.vagas[0].apartamento,'Apto 401');assert.equal(done.unidades[0]['cliente / proprietario'],'');
  assert.equal(done.ajustesUnidades['Apto 401'],undefined);
});

test('conflito na linha comercial suspende também a liberação de sua vaga',()=>{
  const {f,s}=soldSource();reopen(s);
  s.ajustes.V01={...s.ajustes.V01,situacao:'disponivel',apartamento:'',cliente:'',contrato:'',reserva:'',expiracao:'',motivo:'Reabrir'};
  f.vinculos[1][7]='Contrato alterado';
  const p=reconcile(V,s,f,'agora','reabrir');
  assert.deepEqual(p.sync.conflitosUnidades,['Apto 401']);assert.deepEqual(p.sync.conflitos,['V01']);assert.equal(p.sync.pendente,null);
  assert.equal(f.vinculos[1][3],'V01');
});

test('conflito na vaga suspende também a reabertura comercial do apartamento',()=>{
  const {f,s}=soldSource();reopen(s);
  s.ajustes.V01={...s.ajustes.V01,situacao:'disponivel',apartamento:'',cliente:'',contrato:'',reserva:'',expiracao:'',motivo:'Reabrir'};
  f.gestao[1][7]='Conferência concorrente';
  const p=reconcile(V,s,f,'agora','reabrir');
  assert.deepEqual(p.sync.conflitosUnidades,['Apto 401']);assert.deepEqual(p.sync.conflitos,['V01']);assert.equal(p.sync.pendente,null);
  assert.equal(f.vinculos[1][4],'V');
});

test('confirmação de reabertura exige todos os campos comerciais mesmo sem vaga',()=>{
  const f=source();delete f.gestao;f.vinculos[1][2]='Comprador';f.vinculos[1][4]='V';f.vinculos[1][6]='Vendida';
  const p=reconcile(V,reopen(V.importar(f)),f,'agora','reabrir');
  apply(f,{patches:p.sync.pendente.patches.filter(x=>x.celula!=='H9')});
  assert.throws(()=>confirm(V,p,f,'reabrir','fim'),/confirmou/);
  apply(f,p.sync.pendente);f.vinculos[1][7]='Novo contrato';
  assert.throws(()=>confirm(V,p,f,'reabrir','fim'),/divergente/);
});

test('transferências explícitas unem as pontas mesmo após mudar o apartamento antes do sync',()=>{
  const {f,s}=soldSource();s.ajustes.V01.apartamento='Apto 402';move(s);
  s.sync.transferenciasPendentes=[{de:'V01',para:'V02'}];f.gestao[2][7]='Destino alterado';
  const p=reconcile(V,s,f,'agora','mover');
  assert.equal(p.sync.pendente,null);assert.deepEqual(p.sync.conflitos,['V01','V02']);
  assert.deepEqual(p.sync.transferenciasPendentes,[{de:'V01',para:'V02'}]);
});

test('confirmar ambas as vagas encerra também o grupo explícito de transferência',()=>{
  const {f,s}=soldSource();s.ajustes.V01.apartamento='Apto 402';move(s);
  s.sync.transferenciasPendentes=[{de:'V01',para:'V02'}];
  const p=reconcile(V,s,f,'agora','mover');apply(f,p.sync.pendente);
  const done=confirm(V,p,f,'mover','fim');
  assert.deepEqual(done.sync.transferenciasPendentes,[]);assert.equal(done.vagas[0].apartamento,'');assert.equal(done.vagas[1].apartamento,'Apto 402');
});

test('transferência já aplicada na planilha encerra o grupo sem criar nova escrita',()=>{
  const {f,s}=soldSource();move(s);s.sync.transferenciasPendentes=[{de:'V01',para:'V02'}];
  const p=reconcile(V,s,f,'agora','mover');apply(f,p.sync.pendente);
  const novo=reconcile(V,s,f,'nova consulta','outro-id');
  assert.equal(novo.sync.pendente,null);assert.deepEqual(novo.sync.transferenciasPendentes,[]);
});
