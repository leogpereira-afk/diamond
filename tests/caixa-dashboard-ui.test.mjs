import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../caixa-dashboard.js',import.meta.url),'utf8');
function renderer(){let calls=0;const context=vm.createContext({Intl,Date,fetch:()=>{calls++;throw Error('Não pode consultar fonte');}});context.window=context;vm.runInContext(code,context);return {render:context.DiamondCaixaDashboard.render,calls:()=>calls};}
function model(){return {
 mes:'2026-10',periodo:{inicio:'2026-10',fim:'2027-03',quantidade:6},
 mensal:[
  {mes:'2026-10',previsto:150000,recebido:50000,aReceber:100000,parcelas:3,conferir:false,semParcelas:false},
  {mes:'2026-11',previsto:200000,recebido:100000,aReceber:100000,parcelas:2,conferir:false,semParcelas:false},
  {mes:'2026-12',previsto:0,recebido:0,aReceber:0,parcelas:0,conferir:false,semParcelas:true},
  {mes:'2027-01',previsto:60000,recebido:null,aReceber:null,parcelas:1,conferir:true,semParcelas:false},
  {mes:'2027-02',previsto:30000,recebido:30000,aReceber:0,parcelas:1,conferir:false,semParcelas:false},
  {mes:'2027-03',previsto:0,recebido:0,aReceber:0,parcelas:1,conferir:false,semParcelas:false},
 ],
 ranking:{disponivel:true,total:100000,clientes:[{id:'client-1',nome:'Cliente Exemplo',unidades:['101','102'],previsto:120000,recebido:50000,aReceber:70000,parcelas:2,participacao:.7},{id:'client-2',nome:'Outro Cliente',unidades:['103'],previsto:30000,recebido:0,aReceber:30000,parcelas:1,participacao:.3}]},
 cobertura:{pendencias:[{motivo:'Plano a conferir'}],incompleta:true},
};}
const normalize=html=>html.replaceAll('\u00a0',' ');

test('fonte ausente mostra aguardo, sem gráficos fabricados ou saldo zero',()=>{
 const html=renderer().render(null);assert.match(html,/Aguardando a consulta confirmada/);assert.doesNotMatch(html,/data-cxd-month|data-cxd-client|R\$/);assert.equal((html.match(/class="cxd-card"/g)||[]).length,2);
});

test('série traz seis meses, escala comum e acesso exato por teclado e tabela',()=>{
 const html=normalize(renderer().render(model()));
 assert.match(html,/Previsão por mês/);assert.match(html,/Escala comum até R\$ 2\.000,00/);assert.match(html,/outubro de 2026 a março de 2027/);
 assert.equal((html.match(/class="cxd-month /g)||[]).length,6);assert.equal((html.match(/data-cxd-month="2026-10"/g)||[]).length,2);
 assert.match(html,/aria-label="outubro de 2026\. Previsto: R\$ 1\.500,00\. Recebido: R\$ 500,00\. A receber: R\$ 1\.000,00/);
 assert.match(html,/style="height:75\.0000%"/);assert.match(html,/style="height:33\.3333%"/);
 assert.match(html,/Ver valores exatos dos 6 meses/);assert.match(html,/<th scope="col">Previsto<\/th>/);assert.match(html,/R\$ 1\.500,00<\/td><td>R\$ 500,00<\/td><td>R\$ 1\.000,00/);
});

test('sem parcelas, valor desconhecido e zero conhecido têm estados distintos',()=>{
 const html=normalize(renderer().render(model()));
 const december=html.split('data-cxd-month="2026-12"')[1].split('</button>')[0];assert.match(december,/Sem parcelas no recorte; não significa mês fechado/);assert.doesNotMatch(december,/Sem saldo pendente/);
 const january=html.split('data-cxd-month="2027-01"')[1].split('</button>')[0];assert.match(january,/Recebido: A conferir\. A receber: A conferir/);assert.match(january,/cxd-chart-unknown/);
 const february=html.split('data-cxd-month="2027-02"')[1].split('</button>')[0];assert.match(february,/A receber: R\$ 0,00/);assert.match(february,/Sem saldo pendente/);
 assert.match(html,/<td>—<\/td><td>—<\/td><td>—<\/td><td>Sem parcelas no recorte/);
});

test('ranking usa IDs distintos mesmo com nomes iguais, saldo e participação do domínio',()=>{
 const m=model();m.ranking.clientes[1].nome=m.ranking.clientes[0].nome;
 const html=normalize(renderer().render(m));
 assert.equal((html.match(/data-cxd-client="client-1"/g)||[]).length,2);assert.equal((html.match(/data-cxd-client="client-2"/g)||[]).length,2);
 assert.match(html,/70% do saldo/);assert.match(html,/30% do saldo/);assert.match(html,/2 unidade\(s\)/);assert.match(html,/style="width:42\.8571%"/);
 assert.match(html,/sobre R\$ 1\.000,00/);assert.match(html,/Unid\. 101, <wbr>102/);assert.match(html,/Unid\. 103/);
 assert.match(html,/aria-label="Abrir parcelas de Cliente Exemplo\.[^"]+2 unidade\(s\)\. Unidades: 101, 102\./);
 assert.match(html,/aria-label="Abrir parcelas de Cliente Exemplo\.[^"]+1 unidade\(s\)\. Unidades: 103\./);
 assert.match(html,/Barras proporcionais ao maior saldo; percentuais sobre/);assert.doesNotMatch(html,/Clientes são identificados pelo cadastro/);
});

test('oito clientes aparecem diretamente com ação de detalhe',()=>{
 const m=model();m.ranking.clientes=Array.from({length:8},(_,i)=>({id:'id-'+i,nome:'Cliente Exemplo '+i,unidades:['10'+i],previsto:(8-i)*10000,recebido:0,aReceber:(8-i)*10000,parcelas:1,participacao:(8-i)/36}));m.ranking.total=360000;
 const html=renderer().render(m);assert.equal((html.match(/class="cxd-client"/g)||[]).length,8);assert.match(html,/8 clientes com saldo/);assert.match(html,/Ver todos os 8 clientes e valores/);assert.equal((html.match(/data-cxd-client="id-7"/g)||[]).length,2);
});

test('render escapa nomes, identificadores e rótulos sem cortar nome completo',()=>{
 const m=model();m.ranking.clientes[0].id='id" onclick="evil';m.ranking.clientes[0].nome='<script>alert(1)</script> Cliente com Nome Completo Muito Longo';m.ranking.clientes[0].unidades=['101<img src=x>'];
 const html=renderer().render(m);assert.doesNotMatch(html,/<script>|<img src=x>|data-cxd-client="id" onclick/);assert.match(html,/data-cxd-client="id&quot; onclick=&quot;evil"/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; Cliente com Nome Completo Muito Longo/);assert.match(html,/101&lt;img src=x&gt;/);
});

test('sem vencimento mantém ranking, mas não fabrica meses',()=>{
 const m=model();m.mes='sem-data';m.periodo=null;m.mensal=[];
 const html=renderer().render(m);assert.match(html,/Escolha um mês de vencimento/);assert.doesNotMatch(html,/data-cxd-month=/);assert.match(html,/data-cxd-client="client-1"/);assert.match(html,/Sem vencimento · saldo conhecido do recorte atual/);
});

test('janela sem fonte numérica não inventa escala zero e cobertura parcial explicita o denominador',()=>{
 const m=model();m.mensal=m.mensal.map(month=>({...month,previsto:null,recebido:null,aReceber:null,conferir:true,semParcelas:false}));
 let html=renderer().render(m);assert.match(html,/Escala a conferir/);assert.doesNotMatch(html,/Escala comum até/);assert.match(html,/70% do saldo conhecido/);assert.match(html,/Totais disponíveis das parcelas cadastradas e conhecidas/);assert.match(html,/Previsto e recebido apenas das parcelas com saldo; parcelas quitadas ficam fora desta tabela/);
 m.mensal=m.mensal.map(month=>({...month,previsto:0,recebido:0,aReceber:0,conferir:false,semParcelas:true}));html=renderer().render(m);assert.match(html,/Sem parcelas nesta janela/);assert.doesNotMatch(html,/Escala comum até/);
});

test('saldo indisponível e saldo zero explícito são comunicados sem alegar fechamento',()=>{
 const m=model();m.ranking={disponivel:false,total:null,clientes:[]};let html=renderer().render(m);assert.match(html,/Saldo por cliente a conferir/);assert.doesNotMatch(html,/Nenhum saldo a receber identificado/);
 m.ranking={disponivel:true,total:0,clientes:[]};html=normalize(renderer().render(m));assert.match(html,/Nenhum saldo a receber identificado nas parcelas deste recorte/);assert.match(html,/Saldo identificado: <strong>R\$ 0,00/);assert.match(html,/Previsão parcial/);
});

test('render é puro, não consulta fontes nem modifica o modelo',()=>{
 const m=model(),before=JSON.stringify(m),r=renderer();const freeze=o=>{if(o&&typeof o==='object'){Object.freeze(o);Object.values(o).forEach(freeze);}};freeze(m);const first=r.render(m);assert.equal(r.render(m),first);assert.equal(JSON.stringify(m),before);assert.equal(r.calls(),0);
});

test('estilos oferecem grade responsiva sem truncar nomes e com foco visível',()=>{
 const css=fs.readFileSync(new URL('../caixa-dashboard.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:950px\).*grid-template-columns:minmax\(0,1fr\)/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/:focus-visible/);assert.match(css,/\.cxd-table-wrap\{max-width:100%;overflow:auto/);assert.doesNotMatch(css,/text-overflow:ellipsis|line-clamp/);
});
