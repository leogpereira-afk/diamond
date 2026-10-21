/* Modelo único para indicadores, listas e exportações. Valores em centavos. */
(function(root){
 const D=root.DiamondGestaoDomain;
 const text=v=>String(v??'').trim(),norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const cents=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?Math.round(n*100):null;
 function build({unidades=[],leads=[],condicoes=[],historico=[],cfg={},filtros={},now=new Date()}={}){
  const hoje=D.todaySP(now),vistos=new Set(),duplicadas=[];
  const all=unidades.filter(u=>{if(!u.id||vistos.has(u.id)){duplicadas.push(u);return false;}vistos.add(u.id);return true;});
  const rows=all.map(u=>{
   const cliente=leads.find(l=>l.id===u.clienteId),c=condicoes.find(c=>c.unidadeId===u.id);
   const contrato=c&&c.clienteId===u.clienteId&&c.unidadeRevisao===u.atualizadoEm&&u.status==='Vendido'?c:null;
   const nome=cliente?.cliente||u.clienteVinculadoNome||u.compradorNome||u.comprador||'';
   const preco=typeof u.precoBase==='number'&&u.precoBase>0?cents(u.precoBase*(u.precoVersao?1:1+Number(cfg.reajuste||0))*(1-Number(u.desconto||0))):null;
   return {u,nome,clienteId:u.clienteId||'',contrato,pendenteContrato:!!c&&!contrato,preco,tipo:text(u.unidade).toUpperCase()==='LOJA'?'loja':'apartamento',data:contrato?.data||'',corretor:text(u.vendedorNome),empresa:text(u.vendedorEmpresa)};
  });
  const filtered=rows.filter(r=>(!filtros.tipo||filtros.tipo==='todos'||r.tipo===filtros.tipo)&&(!filtros.andar||String(r.u.andar)===filtros.andar)&&(!filtros.corretor||r.corretor===filtros.corretor)&&(!filtros.status||r.u.status===filtros.status)&&(!filtros.busca||norm([r.u.unidade,r.nome,r.corretor,r.empresa].join(' ')).includes(norm(filtros.busca)))&&(!filtros.min||r.preco!==null&&r.preco>=Number(filtros.min)*100)&&(!filtros.max||r.preco!==null&&r.preco<=Number(filtros.max)*100));
  const vendidas=filtered.filter(r=>r.u.status==='Vendido'),disponiveis=filtered.filter(r=>r.u.status==='Disponível'),reservadas=filtered.filter(r=>r.u.status==='Reservado');
  const faixa=r=>(!filtros.de||r.data>=filtros.de)&&(!filtros.ate||r.data<=filtros.ate);
  const noPeriodo=vendidas.filter(r=>r.contrato&&faixa(r));
  const temPeriodo=!!(filtros.de||filtros.ate),vendas=temPeriodo?noPeriodo:vendidas,confirmadas=vendas.filter(r=>r.contrato);
  const soma=k=>confirmadas.reduce((n,r)=>n+k(r.contrato),0);
  const total=confirmadas.length?soma(c=>c.total):vendas.length?null:0;
  const grupos=new Map();for(const r of vendas){if(!r.clienteId)continue;const g=grupos.get(r.clienteId)||{id:r.clienteId,nome:r.nome||'Cliente sem nome',unidades:[],total:0,contratos:0};g.unidades.push(r);if(r.contrato){g.total+=r.contrato.total;g.contratos++;}grupos.set(r.clienteId,g);}
  const meses=D.charts({now}).months.map(m=>({...m,value:0,total:0}));for(const r of noPeriodo){const m=meses.find(m=>m.key===r.data.slice(0,7));if(m){m.value++;m.total+=r.contrato.total;}}
  const near=reservadas.filter(r=>{const t=Date.parse(r.u.reserva?.prazo);return t>now.getTime()&&t<=now.getTime()+72*3600000;});
  const semComprador=vendidas.filter(r=>!r.clienteId),semContrato=vendidas.filter(r=>!r.contrato),semCorretor=vendidas.filter(r=>!r.corretor);
  const invalidas=reservadas.filter(r=>!Number.isFinite(Date.parse(r.u.reserva?.prazo))),vencidas=reservadas.filter(r=>Date.parse(r.u.reserva?.prazo)<=now.getTime());
  const statusConflito=filtered.filter(r=>r.u.status!=='Reservado'&&r.u.reserva);
  const ranking=D.rankingCorretores(vendas.map(r=>r.u));
  ranking.lista.forEach(g=>{const rr=vendas.filter(r=>norm(r.corretor).replace(/\s+/g,' ')===norm(g.nome).replace(/\s+/g,' ')&&norm(r.empresa).replace(/\s+/g,' ')===norm(g.empresa).replace(/\s+/g,' '));g.total=rr.filter(r=>r.contrato).reduce((n,r)=>n+r.contrato.total,0);g.cobertura=rr.filter(r=>r.contrato).length;});
  return {hoje,rows,filtered,duplicadas,vendas,vendidas,disponiveis,reservadas,confirmadas,total,temPeriodo,entrada:soma(c=>c.entrada),permuta:soma(c=>c.permutas.reduce((n,p)=>n+p.valor,0)),parcelado:soma(c=>c.parcelas.reduce((n,p)=>n+p.valor*p.quantidade,0)),potencial:disponiveis.some(r=>r.preco!==null)?disponiveis.reduce((n,r)=>n+(r.preco||0),0):disponiveis.length?null:0,semPreco:disponiveis.filter(r=>r.preco===null).length,compradores:[...grupos.values()],semComprador,semContrato,semCorretor,near,invalidas,vencidas,statusConflito,meses,ranking,ajustes:historico.filter(h=>['reabrir','cancelar'].includes(h.acao)&&filtered.some(r=>r.u.id===h.unidadeId))};
 }
 root.DiamondInsights={build,norm};
})(typeof window!=='undefined'?window:globalThis);
