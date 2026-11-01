// Dados sintéticos e API em memória: nenhum cadastro real é consultado ou alterado.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {criarServidorVendas} from './serve-vendas-preview.mjs';
const require=createRequire(import.meta.url),D=require('../caixa-domain.js');

export function prepararCaixaFixture(b){
  const units=b.table('unidades'),conditions=b.table('vendas_condicoes'),stamp='2026-10-21T12:00:00.000Z';
  const precoVersao=b.table('cfg').get('cfg').tabelaId;
  const seed=(id,number,client,total,entry,barter,series)=>{
    const existente=units.get(id);
    // A fixture mantém o mesmo contrato de leitura do sistema: toda unidade
    // pertence à versão materializada da configuração, inclusive as vendidas.
    // O preço de tabela permanece independente do valor contratado da venda.
    const u={...existente,id,unidade:number,status:'Vendido',clienteId:'preview-'+id,compradorNome:client,vendedorNome:'Corretor Exemplo',vendedorEmpresa:'Domo',precoBase:existente?.precoBase??total/100,precoVersao,desconto:existente?.desconto??0,area:45,andar:1,atualizadoEm:stamp};
    units.set(id,u);b.table('leads').set(u.clienteId,{id:u.clienteId,cliente:client,empresaUsuario:'domo',empresaNome:'Domo',corretorNome:'Corretor Exemplo',estagio:'ganho',primeiroContato:'2026-10-01',criadoEm:stamp,atualizadoEm:stamp});
    const c={unidadeId:id,clienteId:u.clienteId,unidadeRevisao:stamp,revisao:1,data:'2026-10-01',total,entrada:entry,permutas:barter?[{descricao:'Bem sintético',valor:barter}]:[],parcelas:series,correcao:'Valores nominais da prévia',historico:[],atualizadoEm:stamp,atualizadoPor:'domo'};
    conditions.set(id,c);return {u,c};
  };
  const first=seed('u-101','101','Cliente Exemplo Um',15000000,1000000,2000000,[{descricao:'Mensais de exemplo',quantidade:12,valor:1000000,primeiro:'2026-10-10',intervalo:1}]);
  seed('u-102','102','Cliente Exemplo Dois com Nome Completo para Conferência no Celular',24000000,0,0,[{descricao:'Mensais de exemplo',quantidade:24,valor:1000000,primeiro:'2026-10-20',intervalo:1}]);
  seed('u-105','105','Cliente Exemplo Permuta',6000000,0,6000000,[]);
  units.set('u-106',{id:'u-106',unidade:'106',status:'Vendido',clienteId:'preview-sem-plano',compradorNome:'Cliente Exemplo sem Plano',precoBase:0,precoVersao,desconto:0,atualizadoEm:stamp});
  b.table('leads').set('preview-sem-plano',{id:'preview-sem-plano',cliente:'Cliente Exemplo sem Plano',empresaUsuario:'domo',corretorNome:'Corretor Exemplo',estagio:'ganho'});
  const plan=D.cronograma(first.c,first.u),installment=plan.parcelas.find(p=>p.id==='parcela:0:1');
  const events=[
    {id:'preview-receipt-1',operacaoId:'preview-operation-1',tipo:'receber',parcelaId:installment.id,cronogramaChave:plan.chave,data:'2026-10-15',valor:200000,em:'2026-10-15T15:00:00.000Z',por:'domo',observacao:'Pagamento parcial fictício'},
    {id:'preview-receipt-2',operacaoId:'preview-operation-2',tipo:'receber',parcelaId:installment.id,cronogramaChave:plan.chave,data:'2026-10-22',valor:300000,em:'2026-10-22T15:00:00.000Z',por:'domo',observacao:'Segundo pagamento parcial fictício'},
  ].map(ev=>({...ev,solicitacao:JSON.stringify({origem:'fixture-sintetica',operacaoId:ev.operacaoId}),fonte:{clienteId:first.u.clienteId,cliente:first.u.compradorNome,unidade:first.u.unidade,descricao:installment.descricao,vencimento:installment.vencimento,valorPrevisto:installment.valor}}));
  const ledger={unidadeId:first.u.id,revisao:2,eventos:events,atualizadoEm:stamp,atualizadoPor:'domo'};
  if(!D.validarLedger(ledger))throw Error('Fixture de recebimentos inválida');
  b.table('vendas_recebimentos').set(first.u.id,ledger);
  return {b,ledger};
}

export function criarServidorCaixa(port=8796){const fixture=criarServidorVendas(port);prepararCaixaFixture(fixture.b);return fixture;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT)||8796,{server,base}=criarServidorCaixa(port);
  server.listen(port,'127.0.0.1',()=>console.log('Prévia isolada do caixa: '+base+'/#/admin/painel?visao=caixa&mes=2026-10'));
}
