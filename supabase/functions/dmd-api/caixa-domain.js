/* Caixa contratual: centavos inteiros, vencimentos nominais e baixas explícitas. */
(function (root) {
  'use strict';
  const text = v => String(v ?? '').trim();
  const norm = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const money = v => Number.isSafeInteger(v) && v >= 0 && v <= 1e12;
  function dia(v) {
    if (typeof v !== 'string' || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  const hoje = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date());
  function somarMeses(primeiro, n) {
    if (!dia(primeiro) || !Number.isSafeInteger(n) || n < 0) throw Error('Vencimento inválido.');
    const [y, m, d] = primeiro.split('-').map(Number), ano = y + Math.floor((m - 1 + n) / 12), mes = (m - 1 + n) % 12;
    if (ano > 2199) throw Error('O cronograma ultrapassa o ano 2199. Confira o intervalo das parcelas.');
    return [ano, String(mes + 1).padStart(2, '0'), String(Math.min(d, new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate())).padStart(2, '0')].join('-');
  }
  function cronograma(c, u) {
    const invalid = erro => ({ok:false, erro, chave:null, parcelas:[], pendente:true, semData:false, permuta:0, saldoAInformar:null});
    if (!u || u.status !== 'Vendido') return invalid('Unidade não está vendida.');
    if (!c) return invalid('Condições da venda não informadas.');
    if (!u.id || !u.clienteId || c.unidadeId !== u.id || c.clienteId !== u.clienteId || !u.atualizadoEm || c.unidadeRevisao !== u.atualizadoEm) return invalid('Revalidar as condições: unidade ou comprador mudou.');
    if (!dia(c.data) || !money(c.total) || !c.total || !money(c.entrada) || !Array.isArray(c.permutas) || c.permutas.length > 20 || !Array.isArray(c.parcelas) || c.parcelas.length > 20) return invalid('Condições inválidas: confira valores, datas e parcelas.');
    let permuta = 0, soma = c.entrada;
    const parcelas = [], termos = [];
    if (c.entrada) parcelas.push({id:'entrada', descricao:'Entrada em dinheiro', vencimento:null, valor:c.entrada, tipo:'entrada', serie:null, numero:1});
    for (const p of c.permutas) {
      if (!p || !money(p.valor) || !p.valor) return invalid('Valor da permuta inválido.');
      permuta += p.valor;
    }
    soma += permuta;
    try {
      c.parcelas.forEach((p, s) => {
        if (!money(p.valor) || !p.valor || !Number.isSafeInteger(p.quantidade) || p.quantidade < 1 || p.quantidade > 600 || !Number.isSafeInteger(p.intervalo) || p.intervalo < 1 || p.intervalo > 120 || !dia(p.primeiro) || p.primeiro < c.data) throw Error('Série de parcelas inválida.');
        soma += p.valor * p.quantidade;
        if (!Number.isSafeInteger(soma) || soma > c.total) throw Error('A composição ultrapassa o valor vendido.');
        termos.push([p.quantidade, p.valor, p.primeiro, p.intervalo]);
        for (let n = 0; n < p.quantidade; n++) parcelas.push({id:`parcela:${s}:${n + 1}`, descricao:text(p.descricao) || 'Parcela', vencimento:somarMeses(p.primeiro, n * p.intervalo), valor:p.valor, tipo:'parcela', serie:s, numero:n + 1, quantidade:p.quantidade});
      });
    } catch (err) { return invalid(err.message); }
    if (soma > c.total || (soma < c.total && c.composicaoPendente !== true)) return invalid('A composição da venda precisa ser conferida.');
    // Serialização canônica sem hash: não há risco de colisão nem dependência de crypto.
    const chave = JSON.stringify(['caixa-v1', u.id, c.clienteId, c.data, c.total, c.entrada, permuta, termos, text(c.correcao)]);
    return {ok:true, erro:null, chave, parcelas, permuta, saldoAInformar:c.total-soma, pendente:soma<c.total, semData:c.entrada>0};
  }
  function confirmacaoHistorica(ev) {
    const h=ev?.confirmacaoHistorica,c=h?.consolidacao;
    if(ev?.tipo!=='receber'||!h||h.versao!==1||!dia(h.ate)||ev.data!==h.ate||!dia(ev.fonte?.vencimento)||ev.fonte.vencimento>h.ate) return null;
    if(c!==null&&(!c||!text(c.grupoId)||!dia(c.dataBase)||c.dataBase<h.ate||!money(c.recebidoCentavos))) return null;
    return h;
  }
  function validarLedger(registro) {
    if (registro == null) return true;
    if (!text(registro.unidadeId) || !Number.isSafeInteger(registro.revisao) || !Array.isArray(registro.eventos) || registro.revisao !== registro.eventos.length || registro.eventos.length > 10000) return false;
    const ids = new Map(), operacoes = new Set(), estornados = new Set();
    for (const ev of registro.eventos) {
      if (!ev || !text(ev.id) || ids.has(ev.id) || !text(ev.operacaoId) || operacoes.has(ev.operacaoId) || !money(ev.valor) || !ev.valor || !dia(ev.data) || !text(ev.parcelaId) || !text(ev.cronogramaChave)) return false;
      if(ev.confirmacaoHistorica!==undefined&&!confirmacaoHistorica(ev))return false;
      if (ev.tipo === 'estornar') {
        const original = ids.get(ev.eventoId);
        if (!original || original.tipo !== 'receber' || estornados.has(ev.eventoId) || original.valor !== ev.valor || original.parcelaId !== ev.parcelaId || original.cronogramaChave !== ev.cronogramaChave) return false;
        estornados.add(ev.eventoId);
      } else if (ev.tipo !== 'receber') return false;
      ids.set(ev.id, ev); operacoes.add(ev.operacaoId);
    }
    return true;
  }
  function eventosAtivos(registro) {
    if (!validarLedger(registro)) throw Error('Histórico de recebimentos inválido. Confira os registros antes de continuar.');
    const estornados = new Set((registro?.eventos || []).filter(e => e.tipo === 'estornar').map(e => e.eventoId));
    return (registro?.eventos || []).filter(e => e.tipo === 'receber' && !estornados.has(e.id));
  }
  function build({unidades=[],condicoes=[],leads=[],recebimentos=[],hoje:diaHoje=hoje(),mes=diaHoje.slice(0,7),busca='',status=''}={}) {
    if (![unidades,condicoes,leads,recebimentos].every(Array.isArray) || !dia(diaHoje)) throw Error('Fontes de caixa indisponíveis. Atualize os dados.');
    if (mes !== 'sem-data' && !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(mes)) mes=diaHoje.slice(0,7);
    const indices = arr => {const m=new Map();for(const r of arr){const id=r.unidadeId||r.id;if(m.has(id))m.set(id,null);else m.set(id,r);}return m;};
    const cMap=indices(condicoes), rMap=indices(recebimentos), uMap=indices(unidades), lMap=new Map(leads.map(l=>[l.id,l]));
    const linhas=[],pendencias=[],ativos=[],historico=[],vistos=new Set();let permutas=0, ledgerInvalido=false;
    const nome = u => text(lMap.get(u?.clienteId)?.cliente || u?.clienteVinculadoNome || u?.compradorNome || u?.comprador) || 'Comprador não identificado';
    for (const [id,u] of uMap) {
      if (!u) {pendencias.push({unidadeId:id,unidade:id,cliente:'',motivo:'Unidade duplicada. Conferir cadastro.'});continue;}
      if(u.status!=='Vendido')continue;
      const cliente=nome(u), fonte={unidadeId:id,unidade:u.unidade||id,cliente,clienteId:u.clienteId};
      const c=cMap.get(id), plano=cronograma(c,u), ledger=rMap.get(id), ledgerOk=(!rMap.has(id)||ledger!==null)&&validarLedger(ledger);
      if(!ledgerOk){ledgerInvalido=true;pendencias.push({...fonte,motivo:'Histórico de recebimentos inválido ou duplicado. Saldos não calculados.'});}
      if(!plano.ok){pendencias.push({...fonte,motivo:plano.erro});continue;}
      if(!lMap.has(u.clienteId)){pendencias.push({...fonte,motivo:'Comprador não localizado no cadastro.'});continue;}
      permutas+=plano.permuta;
      if(plano.pendente)pendencias.push({...fonte,motivo:'Composição do pagamento a completar.',valor:plano.saldoAInformar});
      if(plano.semData)pendencias.push({...fonte,motivo:'Entrada em dinheiro sem vencimento. Consulte “Sem data” para confirmar o recebimento.',valor:c.entrada});
      const recebidos=ledgerOk?eventosAtivos(ledger):[],confere=recebidos.some(e=>e.cronogramaChave!==plano.chave || !plano.parcelas.some(p=>p.id===e.parcelaId));
      if(confere)pendencias.push({...fonte,motivo:'O cronograma mudou após uma confirmação. Confira o histórico antes de registrar novas baixas.'});
      for(const p of plano.parcelas){
        const eventos=recebidos.filter(e=>e.cronogramaChave===plano.chave&&e.parcelaId===p.id),recebido=eventos.reduce((s,e)=>s+e.valor,0),conferir=!ledgerOk||confere||recebido>p.valor;
        if(recebido>p.valor)pendencias.push({...fonte,motivo:'Recebimentos ultrapassam a parcela. Confira o histórico.'});
        const saldo=conferir?null:p.valor-recebido;
        linhas.push({...p,...fonte,id:id+'|'+p.id,parcelaId:p.id,cronogramaChave:plano.chave,revisaoLedger:ledger?.revisao||0,recebido:conferir?null:recebido,saldo,status:saldo===0?'recebido':recebido>0?'parcial':'aberto',vencida:!!p.vencimento&&p.vencimento<diaHoje&&saldo>0,conferir,eventos,correcao:text(c.correcao)});
      }
    }
    // O caixa real conserva também baixas de cronogramas antigos e unidades reabertas.
    for(const registro of recebimentos){
      const id=registro?.unidadeId,u=uMap.get(id),cliente=nome(u),base={unidadeId:id,unidade:u?.unidade||id,cliente,revisaoLedger:registro?.revisao||0};
      if(!id||vistos.has(id)||rMap.get(id)===null||!validarLedger(registro)){ledgerInvalido=true;if(!pendencias.some(p=>p.unidadeId===id&&p.motivo.includes('Histórico de recebimentos inválido')))pendencias.push({...base,motivo:'Histórico de recebimentos inválido ou duplicado. Caixa real a conferir.'});continue;}
      vistos.add(id);const evs=eventosAtivos(registro),activeIds=new Set(evs.map(e=>e.id));
      for(const ev of registro.eventos){
        const meta={...base,unidade:u?.unidade||ev.fonte?.unidade||id,cliente:lMap.get(ev.fonte?.clienteId)?.cliente||ev.fonte?.cliente||cliente,descricao:ev.fonte?.descricao||'Recebimento',vencimento:ev.fonte?.vencimento||null};
        const item={...ev,...meta,ativo:activeIds.has(ev.id)};historico.push(item);if(item.ativo)ativos.push(item);
      }
      if(evs.length&&(!u||u.status!=='Vendido'))pendencias.push({...base,motivo:'Há recebimentos em unidade reaberta ou fora do estoque. Histórico preservado para conferência.'});
    }
    linhas.sort((a,b)=>(a.vencimento||'9999').localeCompare(b.vencimento||'9999')||String(a.unidade).localeCompare(String(b.unidade),'pt-BR',{numeric:true})||a.parcelaId.localeCompare(b.parcelaId));
    const casa = r => !busca || norm([r.unidade,r.cliente,r.descricao].join(' ')).includes(norm(busca));
    const doMes=linhas.filter(r=>casa(r)&&(mes==='sem-data'?!r.vencimento:r.vencimento?.slice(0,7)===mes));
    const filtradas=doMes.filter(r=>!status||status==='todos'||(status==='pendentes'&&r.saldo!==0)||(status==='recebidas'&&r.saldo===0)||(status==='vencidas'&&r.vencida)||r.status===status);
    const soma = k => filtradas.reduce((s,r)=>s+(r[k]||0),0), parcial=filtradas.some(r=>r.conferir);
    const resumo={previsto:soma('valor'),recebidoParcelas:parcial?null:soma('recebido'),aReceber:parcial?null:soma('saldo'),vencido:parcial?null:filtradas.filter(r=>r.vencida).reduce((s,r)=>s+r.saldo,0),recebidoNoMes:ledgerInvalido?null:ativos.filter(r=>casa(r)&&!confirmacaoHistorica(r)&&r.data.slice(0,7)===mes).reduce((s,r)=>s+r.valor,0),recebidoSemDataExata:ledgerInvalido?null:ativos.filter(r=>casa(r)&&confirmacaoHistorica(r)).reduce((s,r)=>s+r.valor,0)};
    const mesesSet=new Set([diaHoje.slice(0,7),...(mes!=='sem-data'?[mes]:[]),...linhas.filter(r=>r.vencimento).map(r=>r.vencimento.slice(0,7)),...ativos.map(r=>r.data.slice(0,7))]);
    // Inclui meses vazios entre os vencimentos, para que outubro/novembro sejam comparáveis.
    const ordenados=[...mesesSet].sort(),meses=[];let m=ordenados[0];
    while(m<=ordenados.at(-1)){meses.push(m);if(m==='2199-12')break;m=somarMeses(m+'-01',1).slice(0,7);}
    historico.sort((a,b)=>String(b.em).localeCompare(String(a.em)));
    return {linhas,filtradas,meses,resumo,pendencias,recebimentos:ativos,historico,permutas,hoje:diaHoje,mes,ledgerInvalido};
  }
  const api={dia,hoje,somarMeses,cronograma,confirmacaoHistorica,validarLedger,eventosAtivos,build};
  root.DiamondCaixaDomain=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
