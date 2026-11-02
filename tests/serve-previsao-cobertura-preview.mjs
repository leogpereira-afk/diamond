// Prévia isolada da cobertura: somente dados fictícios em memória, sem produção.
import {criarServidorPrevisao} from './serve-previsao-preview.mjs';
import '../previsao-custo-domain.js';
import '../previsao-custo-schema.js';
const port=Number(process.env.PORT)||8801;
const {server,base,b}=criarServidorPrevisao(port);
const partial=process.argv.includes('--partial');
const data=globalThis.DiamondPrevisaoSchema.defaults();
data.settings={targetCents:200000000,futurePaymentShare:.5,futureCommissionRate:partial?null:.05};
data.contributions=[{id:'preview-aporte-cobertura',socio:'Sócios de exemplo',data:'2026-10-15',valorCents:25000000,observacao:'Aporte fictício independente dos contratos de venda SCP.'}];
data.contributionsReviewed=true;
for(const [id,contract] of b.table('vendas_condicoes')){
 contract.observacoes=id==='u-101'?'Origem da venda: SCP. Contrato sintético de sociedade em conta de participação, com unidade vinculada.':'Origem da venda: venda direta. Contrato sintético de compra e venda.';
}
const available=b.table('unidades').get('u-103');
for(const [unit,price] of [['201',360000],['202',390000],['203',420000],['301',440000],['302',480000],['LOJA',700000]]){
 const id='u-'+unit.toLowerCase();
 b.table('unidades').set(id,{...available,id,unidade:unit,precoBase:price,andar:unit==='LOJA'?0:Number(unit[0]),area:unit==='LOJA'?100:50});
}
if(partial){
 const unit={...available,id:'u-107',unidade:'107',status:'Vendido',clienteId:'preview-cliente-3',compradorNome:'Cliente Exemplo Três'};
 b.table('unidades').set(unit.id,unit);
 b.table('leads').set(unit.clienteId,{id:unit.clienteId,cliente:unit.compradorNome,empresaUsuario:'domo'});
 b.table('vendas_condicoes').set(unit.id,{unidadeId:unit.id,clienteId:unit.clienteId,unidadeRevisao:unit.atualizadoEm,revisao:1,total:35000000,entrada:0,permutas:[],parcelas:[],data:'2026-10-20',observacoes:'Composição fictícia ainda incompleta; origem não informada.',composicaoPendente:true,saldoAInformar:35000000});
}
for(const [id,contrato] of b.table('vendas_condicoes')){
 const u=b.table('unidades').get(id),key=globalThis.DiamondPrevisaoDomain.contractKey({u,contrato});
 data.contracts[id]={contractKey:key,commissionCents:0,finalSeriesIndices:contrato.parcelas.length?[1]:[],receiptsReviewed:!partial};
 if(!partial)data.receipts.push({id:'preview-receipt-'+id,unitId:id,contractKey:key,data:'2026-10-20',valorCents:contrato.entrada,natureza:'comum',observacao:'Recebimento fictício para demonstrar a separação de caixa e cobertura.'});
}
globalThis.DiamondPrevisaoSchema.validate(data);
b.table('previsao_custo').set('diamond',{schema:1,revision:1,updatedAt:'2026-11-01T12:00:00.000Z',updatedBy:'admin-da-previa',status:'Salvo no sistema',data});
server.listen(port,'127.0.0.1',()=>console.log('Prévia da cobertura com dados fictícios: '+base+'/#/admin/painel?visao=previsao'));
