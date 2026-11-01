// Prévia isolada: clientes, contratos e recebimentos inteiramente fictícios.
import {criarServidorCaixa} from './serve-caixa-preview.mjs';
const port=Number(process.env.PORT)||8798,{b,server,base}=criarServidorCaixa(port);
const stamp='2026-10-21T12:00:00.000Z',precoVersao=b.table('cfg').get('cfg').tabelaId;
const exemplos=[
 ['201','Cliente Exemplo Três',150000,18,1,'2026-10-12'],
 ['202','Cliente Exemplo Quatro',250000,6,2,'2026-10-25'],
 ['203','Cliente Exemplo Cinco',1250000,1,1,'2026-12-15'],
 ['204','Cliente Exemplo Seis',80000,12,1,'2026-10-18'],
 ['205','Cliente Exemplo Sete',630000,1,1,'2026-10-25'],
 ['206','Cliente Exemplo Oito',480000,3,3,'2026-10-28'],
];
for(const [unidade,cliente,valor,quantidade,intervalo,primeiro] of exemplos){
 const id='dashboard-u-'+unidade,clienteId='dashboard-c-'+unidade,total=valor*quantidade;
 b.table('unidades').set(id,{id,unidade,status:'Vendido',clienteId,compradorNome:cliente,vendedorNome:'Corretor Exemplo',vendedorEmpresa:'Domo',precoBase:total/100,precoVersao,desconto:0,area:45,andar:2,atualizadoEm:stamp});
 b.table('leads').set(clienteId,{id:clienteId,cliente,empresaUsuario:'domo',empresaNome:'Domo',corretorNome:'Corretor Exemplo',estagio:'ganho',primeiroContato:'2026-10-01',criadoEm:stamp,atualizadoEm:stamp});
 b.table('vendas_condicoes').set(id,{unidadeId:id,clienteId,unidadeRevisao:stamp,revisao:1,data:'2026-10-01',total,entrada:0,permutas:[],parcelas:[{descricao:'Parcelas fictícias da prévia',quantidade,valor,primeiro,intervalo}],correcao:'Valores nominais da prévia',historico:[],atualizadoEm:stamp,atualizadoPor:'domo'});
}
server.listen(port,'127.0.0.1',()=>console.log('Prévia isolada dos dashboards: '+base+'/#/admin/painel?visao=caixa&mes=2026-10'));
