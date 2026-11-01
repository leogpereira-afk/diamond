// Prévia isolada da previsão de custo: apenas dados sintéticos em memória.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {criarServidorVendas} from './serve-vendas-preview.mjs';

export function criarServidorPrevisao(port=8794){
  const fixture=criarServidorVendas(port),{b}=fixture;
  const primeiro=b.table('vendas_condicoes').get('u-101');
  b.table('vendas_condicoes').set('u-101',{
    ...primeiro,
    // R$ 335 mil: 35 mil de entrada + 60 mil de permuta + 120 mil comuns + 120 mil finais.
    parcelas:[
      {descricao:'Mensais sintéticas',quantidade:12,valor:1000000,primeiro:'2026-11-10',intervalo:1},
      {descricao:'Final sintético na entrega',quantidade:1,valor:12000000,primeiro:'2028-11-10',intervalo:1},
    ],
    observacoes:'Contrato sintético com permuta e série final para a prévia de custo.',
  });
  const segunda=b.table('unidades').get('u-102');
  b.table('unidades').set('u-102',{...segunda,clienteId:'preview-cliente-2',compradorNome:'Cliente Exemplo Dois'});
  b.table('vendas_condicoes').set('u-102',{
    unidadeId:'u-102',clienteId:'preview-cliente-2',unidadeRevisao:segunda.atualizadoEm,revisao:1,
    total:36500000,entrada:6500000,permutas:[],data:'2026-10-20',
    parcelas:[
      {descricao:'Mensais sintéticas',quantidade:20,valor:1000000,primeiro:'2026-11-10',intervalo:1},
      {descricao:'Final sintético na entrega',quantidade:1,valor:10000000,primeiro:'2028-11-10',intervalo:1},
    ],
    observacoes:'Segundo contrato sintético para comparar a contribuição das vendas.',
    correcao:'Valores nominais de teste',historico:[],atualizadoEm:segunda.atualizadoEm,atualizadoPor:'domo',
  });
  const disponivel=b.table('unidades').get('u-103');
  for(const u of [
    {...disponivel,id:'u-105',unidade:'105',precoBase:410000,area:54},
    {...disponivel,id:'u-106',unidade:'106',precoBase:455000,area:58},
  ])b.table('unidades').set(u.id,u);
  return fixture;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT)||8794,{server,base}=criarServidorPrevisao(port);
  server.listen(port,'127.0.0.1',()=>console.log('Prévia isolada de custo: '+base+'/#/admin/painel?visao=previsao'));
}
