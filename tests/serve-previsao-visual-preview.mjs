// Prévia visual isolada. Somente exemplos fictícios, sem conexão com produção.
import {criarServidorPrevisao} from './serve-previsao-preview.mjs';
import '../previsao-custo-domain.js';
import '../previsao-custo-schema.js';
const port=Number(process.env.PORT)||8799;
const {server,base,b}=criarServidorPrevisao(port);
const data=globalThis.DiamondPrevisaoSchema.defaults();
data.settings={targetCents:200000000,futurePaymentShare:.5,futureCommissionRate:.05};
data.contributions=[{id:'preview-aporte-consolidado',socio:'Sócios de exemplo',data:'2026-10-15',valorCents:25000000,observacao:'Saldo fictício para conferir o layout, sem dados de clientes ou sócios reais.'}];
data.contributionsReviewed=true;
if(process.argv.includes('--partial')){
 const unit={...b.table('unidades').get('u-103'),status:'Vendido',clienteId:'preview-cliente-3',compradorNome:'Cliente Exemplo Três'};
 b.table('unidades').set(unit.id,unit);
 b.table('leads').set(unit.clienteId,{id:unit.clienteId,cliente:unit.compradorNome,empresaUsuario:'domo'});
 b.table('vendas_condicoes').set(unit.id,{unidadeId:unit.id,clienteId:unit.clienteId,unidadeRevisao:unit.atualizadoEm,revisao:1,total:35000000,entrada:0,permutas:[],parcelas:[],data:'2026-10-20',observacoes:'Condição fictícia com composição incompleta.',composicaoPendente:true,saldoAInformar:35000000});
 data.settings.futureCommissionRate=null;
}
for(const [id,contrato] of b.table('vendas_condicoes')){
 const u=b.table('unidades').get(id);
 data.contracts[id]={contractKey:globalThis.DiamondPrevisaoDomain.contractKey({u,contrato}),commissionCents:0,finalSeriesIndices:contrato.parcelas.length?[1]:[],receiptsReviewed:false};
}
globalThis.DiamondPrevisaoSchema.validate(data);
b.table('previsao_custo').set('diamond',{schema:1,revision:1,updatedAt:'2026-11-01T12:00:00.000Z',updatedBy:'admin-da-previa',status:'Salvo no sistema',data});
server.listen(port,'127.0.0.1',()=>console.log('Prévia visual fictícia: '+base+'/#/admin/painel?visao=previsao'));
