// Prévia de vendas inteiramente local: somente registros sintéticos em memória.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {backend} from './helpers.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const revisao='2026-10-21T12:00:00.000Z';

export function criarFixtureVendas(){
  const b=backend();
  b.table('unidades').clear();
  const usuarios=[
    {usuario:'domo',nome:'Domo',hash:'fake',papel:'corretor',ativo:true,hashCorretores:'fake',corretores:[{nome:'Corretor Exemplo',telefone:''}]},
    {usuario:'equipe-exemplo',nome:'Equipe Exemplo',hash:'fake',papel:'corretor',ativo:true,hashCorretores:'fake',corretores:[{nome:'Corretor Exemplo',telefone:''}]},
    {usuario:'admin',nome:'Admin da prévia',hash:'fake',papel:'admin',ativo:true},
  ];
  b.table('cfg').set('usuarios',usuarios);
  const cfg={dataTabela:'20/10/2026',versao:'v2',tabelaId:'preview-tabela-v2',precosRevisao:2,precosModelo:1,reajuste:0,atualizadoEm:revisao,corretagem:.05,quemPaga:'Construtora',correcaoMensal:.006,correcaoDesde:13,balQtde:0,balValor:10000,balPrimeiro:6,balIntervalo:6,chavesMes:36,diaVenc:10};
  b.table('cfg').set('cfg',cfg);
  const unidades=[
    {id:'u-101',unidade:'101',status:'Vendido',clienteId:'preview-cliente-1',compradorNome:'Cliente Exemplo Um',vendedorNome:'corretor exemplo',vendedorEmpresa:'domo',precoBase:350000,area:45,andar:1},
    {id:'u-102',unidade:'102',status:'Vendido',vendedorNome:'CORRETOR EXEMPLO',vendedorEmpresa:'Domo',precoBase:365000,area:47,andar:1},
    {id:'u-103',unidade:'103',status:'Disponível',precoBase:345000,area:43,andar:1},
    {id:'u-104',unidade:'104',status:'Reservado',precoBase:380000,area:50,andar:1,reserva:{prazo:'2027-12-31T20:00:00Z',cliente:'Cliente Exemplo Dois',corretor:'Corretor Exemplo',empresa:'Equipe Exemplo',empresaUsuario:'equipe-exemplo'}},
  ].map(u=>({...u,desconto:0,precoVersao:'preview-tabela-v2',atualizadoEm:revisao}));
  unidades.forEach(u=>b.table('unidades').set(u.id,u));
  const lead={id:'preview-cliente-1',cliente:'Cliente Exemplo Um',clienteTel:'',email:'cliente.um@example.invalid',empresaUsuario:'domo',empresaNome:'Domo',corretorNome:'corretor exemplo',estagio:'ganho',unidade:'101',primeiroContato:'2026-10-05',temp:'quente',criadoEm:'2026-10-05T12:00:00.000Z',atualizadoEm:revisao,cadastro:{tipoPessoa:'PF',email:'cliente.um@example.invalid',observacoes:'Cadastro fictício para conferir a preservação das informações.'}};
  b.table('leads').set(lead.id,lead);
  b.table('leads').set('preview-cliente-2',{id:'preview-cliente-2',cliente:'Cliente Exemplo Dois',clienteTel:'',empresaUsuario:'equipe-exemplo',empresaNome:'Equipe Exemplo',corretorNome:'Corretor Exemplo',estagio:'contato',primeiroContato:'2026-10-10',criadoEm:'2026-10-10T12:00:00.000Z',atualizadoEm:revisao});
  b.table('propostas').set('preview-proposta-1',{id:'preview-proposta-1',unidadeId:'u-101',unidade:'101',cliente:lead.cliente,clienteTel:'',corretor:'corretor exemplo',corretorUsuario:'domo',corretorEmpresa:'Domo',neg:335000,forma:'perso',formaLabel:'Personalizado',leadId:lead.id,criadoEm:'2026-10-15T12:00:00.000Z',inp:{entradaPct:10,finalPct:30,nParcelas:24,chavesMes:36,dataProposta:'2026-10-15',diaVenc:10}});
  b.table('propostas').set('preview-proposta-2',{id:'preview-proposta-2',unidadeId:'u-104',unidade:'104',cliente:'Cliente Exemplo Dois',clienteTel:'',corretor:'Corretor Exemplo',corretorUsuario:'equipe-exemplo',corretorEmpresa:'Equipe Exemplo',neg:380000,forma:'perso',formaLabel:'Personalizado',leadId:'preview-cliente-2',criadoEm:'2026-10-20T12:00:00.000Z',inp:{entradaPct:20,finalPct:30,nParcelas:24,chavesMes:36,dataProposta:'2026-10-20',diaVenc:10}});
  const tabelas=[
    {id:'preview-tabela-v1',versaoAnterior:'v1',versaoNova:'v1',dataTabela:'05/10/2026',criadoEm:'2026-10-05T12:00:00.000Z',origem:'reajuste',percentual:0,cfgAntes:{versao:'v1',dataTabela:'05/10/2026',tabelaId:'preview-tabela-v1'},cfgDepois:{versao:'v1',dataTabela:'05/10/2026',tabelaId:'preview-tabela-v1'},observacao:'Tabela inicial fictícia.',itens:unidades.map(u=>({id:u.id,unidade:u.unidade,status:u.status,anterior:u.id==='u-103'?300000:u.precoBase,novo:u.id==='u-103'?300000:u.precoBase,desconto:0,alterada:false}))},
    {id:'preview-tabela-v2',versaoAnterior:'v1',versaoNova:'v2',dataTabela:'20/10/2026',criadoEm:'2026-10-20T12:00:00.000Z',origem:'reajuste',percentual:15,cfgAntes:{versao:'v1',dataTabela:'05/10/2026',tabelaId:'preview-tabela-v1'},cfgDepois:{versao:'v2',dataTabela:'20/10/2026',tabelaId:'preview-tabela-v2'},observacao:'Atualização fictícia: somente a unidade disponível mudou de preço.',itens:unidades.map(u=>({id:u.id,unidade:u.unidade,status:u.status,anterior:u.id==='u-103'?300000:u.precoBase,novo:u.precoBase,desconto:0,alterada:u.id==='u-103'}))},
  ];
  tabelas.forEach(t=>b.table('precos_historico').set(t.id,t));
  b.table('vendas_condicoes').set('u-101',{
    unidadeId:'u-101',clienteId:lead.id,unidadeRevisao:revisao,revisao:1,total:33500000,entrada:3500000,data:'2026-10-16',
    permutas:[{descricao:'Bem fictício recebido como parte da entrada',valor:6000000}],
    parcelas:[{descricao:'Mensais de exemplo',quantidade:24,valor:1000000,primeiro:'2026-11-10',intervalo:1}],
    observacoes:'Condições sintéticas. Preserve esta observação ao editar valor e tabela.',correcao:'Índice contratual de exemplo',historico:[],
    tabelaVenda:{key:'tabela:preview-tabela-v1',tabelaId:'preview-tabela-v1',versao:'v1',dataTabela:'05/10/2026',origem:'historico',observacao:'Tabela inicial fictícia.',valorTabela:350000,desconto:0,neg:350000},
    atualizadoEm:revisao,atualizadoPor:'domo',
  });
  const estadoVagas={fonte:{lidoEm:revisao,abaUnica:true},unidades:[],ajustes:{},historico:[],vagas:Array.from({length:8},(_,i)=>({numero:i+1,codigo:'V'+String(i+1).padStart(2,'0'),piso:0,apartamento:i===0?'Apto 101':'',cliente:i===0?lead.cliente:'',situacao:i===0?'vendida':'disponivel',area:'12 m²',contrato:'',reserva:'',expiracao:'',observacoes:'',alertas:[],avisos:[],origem:{vinculos:[],gestao:{}},assinatura:'preview'}))};
  b.table('domo_vagas_estado').set('diamond',{estado:estadoVagas,revisao:1});
  const session={usuario:'domo',senhaHash:'fake',nome:'Domo',papel:'corretor',ehMaster:true,temSenhaEquipe:true,corretores:usuarios[0].corretores,corretorAtivo:{nome:'Corretor Exemplo'},empresa:'Domo'};
  return {b,session,estadoVagas};
}

export function criarServidorVendas(port=8791){
  const {b,session,estadoVagas}=criarFixtureVendas();
  const base='http://127.0.0.1:'+port,events=[];
  const leituras=new Set(['list','getCfg','listLeads','listReservas','listPropostas','listEnvios','getFoto','precosHistorico','disponibilidadeAoVivo']);
  const server=http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,base);let text='',type='application/json';
      if(u.pathname==='/api/dmd-api'){
        let raw='';for await(const chunk of req)raw+=chunk;
        const data=JSON.parse(raw||'{}');
        const leitura=leituras.has(data.action)||(data.action==='vendasCondicoes'&&['listar','carregar'].includes(data.operacao))||(data.action==='vagas'&&['carregar','paraProposta'].includes(data.operacao))||(data.action==='clienteCadastro'&&data.operacao==='carregar')||(data.action==='previsaoCusto'&&data.operacao==='carregar');
        if(!leitura)events.push({action:data.action,operacao:data.operacao,em:new Date().toISOString()});
        const r=data.action==='vagas'&&data.operacao==='carregar'?{status:200,ok:true,estado:estadoVagas,revisao:1}:data.action==='vagas'&&data.operacao==='paraProposta'?{status:200,ok:true,vagas:[{codigo:'V02',pavimento:'Térreo'}]}:await b.request(data.action,data,data.auth?.usuario||null);
        res.statusCode=r.status;text=JSON.stringify(r);
      }else if(u.pathname==='/audit-state'){
        text=JSON.stringify({events,previsao:b.table('previsao_custo').get('diamond')||null,previsaoOperacoes:[...b.table('previsao_custo_operacoes').values()],unidades:[...b.table('unidades').values()],clientes:[...b.table('leads').values()],condicoes:[...b.table('vendas_condicoes').values()],tabelas:[...b.table('precos_historico').values()],propostas:[...b.table('propostas').values()],reservas:[...b.table('reservas').values()]});
      }else if(u.pathname==='/fixture.js'){
        type='application/javascript';
        // A fixture apenas fornece a sessão sintética. Dados, fila e edições nunca
        // são zerados em recargas: o backend desta prévia mantém os salvamentos.
        text=`if(!localStorage.getItem('dv_user')&&!sessionStorage.getItem('dv_user')){localStorage.setItem('dv_user',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('dv_owner','domo');}`;
      }else if(u.pathname==='/config.js'){
        type='application/javascript';text=`window.API_BASE=${JSON.stringify(base+'/api')};window.APP_TOKEN='fake';window.P_URL=${JSON.stringify(base+'/api/dmd-p')};`;
      }else if(u.pathname==='/sw.js'){
        type='application/javascript';text='self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.registration.unregister()));';
      }else{
        const name=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).slice(1),filename=path.resolve(root,name),relative=path.relative(root,filename);
        if(relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){
          res.statusCode=404;text='Not found';
        }else{
          type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(filename)]||'application/octet-stream';
          text=fs.readFileSync(filename);
          if(name==='index.html')text=Buffer.from(text.toString().replace(/<script src="config.js\?v=[^"]+">/,tag=>'<script src="fixture.js"></script>'+tag).replace('<body>','<body><div style="padding:7px 12px;background:#fff3cd;color:#423600;text-align:center;font:600 12px/1.4 system-ui">PRÉVIA LOCAL · Vendas e tabelas · Dados fictícios · Nenhuma alteração no sistema real</div>'));
        }
      }
      res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Security-Policy',"connect-src 'self' data:; object-src 'none'; form-action 'self'; base-uri 'self'");
      res.end(text);
    }catch(e){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({erro:e.message}));}
  });
  return {server,base,b};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT)||8791,{server,base}=criarServidorVendas(port);
  server.listen(port,'127.0.0.1',()=>console.log('Prévia isolada: '+base+'/#/admin/vendas'));
}
