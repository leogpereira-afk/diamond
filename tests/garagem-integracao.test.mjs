import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {backend,copy} from './helpers.mjs';
import {reconcile,confirm} from '../supabase/functions/dmd-sheets/sync.mjs';

const V=createRequire(import.meta.url)('../vagas-domain.js'),SHEET='integracao-local';
function fixture({semLinha=false,rawVaga='',beforeReservaCommit}={}){
  const b=backend({beforeReservaCommit});
  const u={id:'u-701',unidade:'701',status:'Vendido',precoBase:401234.4375,desconto:.04,precoM2:9512.73,area:42.18,precoVersao:'tabela-v2',compradorNome:'Comprador anterior',clienteId:'cliente-anterior',vendedorNome:'Corretor anterior',vendedorEmpresa:'Empresa anterior',atualizadoEm:'2026-10-05T12:00:00Z'};
  b.table('unidades').set(u.id,copy(u));
  b.table('unidades').set('u-1001',{id:'u-1001',unidade:'1001',status:'Vendido',precoBase:550000,compradorNome:'Outro comprador',atualizadoEm:'2026-10-05T12:00:00Z'});
  const f={spreadsheetId:SHEET,vinculos:[['Apartamento','Tipologia / Área','Cliente / Proprietário','Vaga Vinculada','Confirmação (V/R)','Pavimento da Vaga','Status','Contratos','Início','Término','Contador de Dias','Observações'],...Array.from({length:82},(_,i)=>['Apto '+(i===0?(semLinha?'999':'701'):i===1?'1001':800+i),'42,18 m²','','','','','Disponível','','','','fórmula',''])]};
  f.vinculos[1]=[f.vinculos[1][0],'42,18 m²','Comprador anterior',rawVaga,'V','Térreo','Vinculada / Vendida','Finalizado','01/10/2026','05/10/2026','fórmula','Observação anterior'];
  f.vinculos[2]=['Apto 1001','50 m²','Outro comprador','','V','Térreo','Vinculada / Vendida','Assinaturas','','','fórmula','Observação da outra unidade'];
  b.table('domo_vagas_estado').set('diamond',{estado:V.importar(f),revisao:10});
  const row=()=>b.table('domo_vagas_estado').get('diamond');
  const unit=()=>b.table('unidades').get(u.id);
  async function reabrir(){return b.request('reservasPainel',{operacao:'reabrir',unidadeId:u.id,revisao:unit().atualizadoEm,motivo:'Distrato confirmado'});}
  function sync(){
    const atual=row(),p=reconcile(V,atual.estado,f,'consulta','operacao-sync',SHEET);
    assert.deepEqual(p.sync.conflitos,[]);assert.deepEqual(p.sync.conflitosUnidades,[]);
    if(p.sync.pendente){
      for(const x of p.sync.pendente.patches){
        const m=x.celula.match(/^([B-M])(\d+)$/),linha=f.vinculos[+m[2]-8],col=m[1].charCodeAt(0)-66;
        assert.equal(x.aba,'Vagas de Garagem');assert.equal(String(linha[col]||''),x.antes);linha[col]=x.depois;
      }
      atual.estado=confirm(V,p,f,'operacao-sync','confirmada',SHEET);
    }else atual.estado=p;
    atual.revisao++;return p;
  }
  return {b,u,f,row,unit,reabrir,sync};
}

test('API reabre 701 sem vaga e sincroniza sem alterar a vaga vendida de 1001',async()=>{
  const {b,u,f,row,unit,reabrir,sync}=fixture();f.vinculos[2][3]='V18';row().estado=V.importar(f);
  const outraLinha=copy(f.vinculos[2]),outraUnidade=copy(b.table('unidades').get('u-1001'));
  const r=await reabrir();assert.equal(r.status,200,r.erro);sync();
  assert.equal(unit().status,'Disponível');assert.equal(unit().compradorNome,undefined);assert.equal(unit().vendedorNome,undefined);
  for(const k of ['precoBase','desconto','precoM2','area','precoVersao'])assert.equal(unit()[k],u[k],k);
  assert.equal(f.vinculos[1][2],'');assert.equal(f.vinculos[1][3],'');assert.equal(f.vinculos[1][4],'');assert.equal(f.vinculos[1][6],'Disponível');
  assert.deepEqual(f.vinculos[2],outraLinha);assert.deepEqual(b.table('unidades').get('u-1001'),outraUnidade);
  assert.equal(V.efetivas(row().estado)[17].apartamento,'Apto 1001');assert.equal(V.efetivas(row().estado)[17].situacao,'vendida');
  assert.equal([...b.table('reservas_historico').values()].find(h=>h.acao==='reabrir').antes.compradorNome,'Comprador anterior');
});

test('transferir V18 para 1001 e reabrir 701 antes do sync preserva a transferência inteira',async()=>{
  const {b,f,row,reabrir,sync}=fixture({rawVaga:'V18'});
  const atual=V.efetivas(row().estado)[17];
  const transferencia=await b.request('vagas',{operacao:'salvar',codigo:'V18',revisao:row().revisao,ajuste:{...atual,apartamento:'Apto 1001',cliente:'Outro comprador',contrato:'Assinaturas',reserva:'',expiracao:'',observacoes:'Observação da outra unidade',motivo:'Transferência conferida'}});
  assert.equal(transferencia.status,200,transferencia.erro);
  const reaberta=await reabrir();assert.equal(reaberta.status,200,reaberta.erro);
  const p=sync();assert.deepEqual(p.sync.pendente.codigos,['V18']);assert.equal(p.sync.pendente.unidades[0].apartamento,'Apto 701');
  assert.equal(f.vinculos[1][3],'');assert.equal(f.vinculos[1][4],'');assert.equal(f.vinculos[1][2],'');assert.equal(f.vinculos[1][6],'Disponível');
  assert.equal(f.vinculos[2][3],'V18');assert.equal(f.vinculos[2][4],'V');assert.equal(f.vinculos[2][2],'Outro comprador');
  assert.equal(V.efetivas(row().estado)[17].apartamento,'Apto 1001');assert.equal(V.efetivas(row().estado)[17].cliente,'Outro comprador');
});

test('reabertura sem linha na planilha preserva todas as linhas e não inventa ajuste',async()=>{
  const {f,row,reabrir,sync,unit}=fixture({semLinha:true}),antes=copy(f);
  const r=await reabrir();assert.equal(r.status,200,r.erro);assert.equal(unit().status,'Disponível');
  assert.deepEqual(row().estado.ajustesUnidades,{});const p=sync();assert.equal(p.sync.pendente,null);assert.deepEqual(f,antes);
});

test('preço alterado durante reabertura impede gravar unidade ou planilha parcialmente',async()=>{
  const {b,f,row,reabrir,unit}=fixture({beforeReservaCommit:({table})=>{table('unidades').get('u-701').precoBase=430000;}}),antes=copy(f);
  const r=await reabrir();assert.equal(r.status,409,r.erro);assert.equal(unit().status,'Vendido');assert.equal(unit().precoBase,430000);
  assert.equal(row().estado.ajustesUnidades,undefined);assert.equal(b.table('reservas_historico').size,0);assert.deepEqual(f,antes);
});

test('vínculo novo aguarda limpeza da reabertura para não ressuscitar a venda antiga',async()=>{
  const {b,row,reabrir,unit,sync}=fixture();assert.equal((await reabrir()).status,200);
  const r=await b.request('vagas',{operacao:'vincularUnidade',unidadeId:'u-701',codigo:'V19',revisao:row().revisao,unidadeRevisao:unit().atualizadoEm});
  assert.equal(r.status,409,r.erro);assert.equal(V.efetivas(row().estado)[18].apartamento,'');
  sync();const depois=await b.request('vagas',{operacao:'vincularUnidade',unidadeId:'u-701',codigo:'V19',revisao:row().revisao,unidadeRevisao:unit().atualizadoEm});
  assert.equal(depois.status,200,depois.erro);sync();assert.equal(V.efetivas(row().estado)[18].situacao,'disponivel');assert.equal(V.efetivas(row().estado)[18].cliente,'');
});

test('reserva em vaga estrutural aguarda limpeza comercial da reabertura',async()=>{
  const {b,row,reabrir,unit,sync}=fixture({rawVaga:'V18'});
  const v=V.efetivas(row().estado)[17];row().estado.ajustes={V18:{...v,vinculoEstrutural:true}};
  assert.equal((await reabrir()).status,200);
  const r=await b.request('reservasPainel',{operacao:'reservar',unidadeId:'u-701',revisao:unit().atualizadoEm,cliente:'Novo comprador',corretor:'Corretor atual',prazo:'2030-01-01T15:00:00Z',motivo:'Nova reserva'});
  assert.equal(r.status,409,r.erro);assert.equal(unit().status,'Disponível');assert.equal(V.efetivas(row().estado)[17].situacao,'disponivel');
  sync();const depois=await b.request('reservasPainel',{operacao:'reservar',unidadeId:'u-701',revisao:unit().atualizadoEm,cliente:'Novo comprador',corretor:'Corretor atual',prazo:'2030-01-01T15:00:00Z',motivo:'Nova reserva'});
  assert.equal(depois.status,200,depois.erro);sync();assert.equal(V.efetivas(row().estado)[17].situacao,'reservada');assert.equal(V.efetivas(row().estado)[17].cliente,'Novo comprador');
});

test('transferência após troca de apartamento pré-sync não libera origem se destino divergir',async()=>{
  const {b,f,row}=fixture({rawVaga:'V18'});
  const atual=V.efetivas(row().estado)[17];
  const trocaApartamento=await b.request('vagas',{operacao:'salvar',codigo:'V18',revisao:row().revisao,ajuste:{...atual,apartamento:'Apto 1001',cliente:'Outro comprador',contrato:'Assinaturas',reserva:'',expiracao:'',observacoes:'Observação da outra unidade',motivo:'Alterar o apartamento'}});
  assert.equal(trocaApartamento.status,200,trocaApartamento.erro);
  const trocaVaga=await b.request('vagas',{operacao:'salvar',codigo:'V18',destino:'V19',revisao:row().revisao,ajuste:{...V.efetivas(row().estado)[17],motivo:'Escolher outra vaga'}});
  assert.equal(trocaVaga.status,200,trocaVaga.erro);
  f.vinculos[3][3]='V19';f.vinculos[3][4]='V';f.vinculos[3][2]='Venda concorrente';f.vinculos[3][6]='Vendida';
  const p=reconcile(V,row().estado,f,'consulta','conflito',SHEET);
  assert.equal(p.sync.pendente,null);assert.deepEqual(p.sync.conflitos,['V18','V19']);assert.equal(f.vinculos[1][3],'V18');
});
