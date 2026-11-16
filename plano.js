// plano.js — motor de cálculo do plano de pagamento (mesma lógica da planilha Diamond)
const PLANO = (() => {
  const FORMAS = [
    { id: 'avista', label: 'À vista' },
    { id: '12x', label: '12x sem juros (1+11)', n: 12 },
    { id: '24x', label: '24x sem juros (1+23)', n: 24 },
    { id: '36x', label: '36x sem juros (1+35)', n: 36 },
    { id: 'perso', label: 'Personalizado' },
  ];
  const formaLabel = (id) => (FORMAS.find((f) => f.id === id) || {}).label || id;

  // A versão decimal é optativa e fica gravada nas novas propostas. Assim,
  // corrigir meios centavos não recalcula contratos/propostas anteriores.
  function fracaoDecimal(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw Error('Valor monetário inválido.');
    const [coeficiente, exp = '0'] = String(n).split('e');
    const casas = (coeficiente.split('.')[1] || '').length;
    const potencia = Number(exp) - casas;
    const numerador = BigInt(coeficiente.replace('.', ''));
    return potencia >= 0 ? [numerador * 10n ** BigInt(potencia), 1n]
      : [numerador, 10n ** BigInt(-potencia)];
  }
  const arredondarRazao = (n, d) => {
    const sinal = n < 0n ? -1n : 1n;
    return sinal * ((2n * n * sinal + d) / (2n * d));
  };
  const centavosDecimais = value => {
    const [n, d] = fracaoDecimal(value);
    return arredondarRazao(n * 100n, d);
  };
  function valorProporcao(valor, proporcao) {
    const [n, d] = fracaoDecimal(proporcao);
    return Number(arredondarRazao(centavosDecimais(valor) * n, d)) / 100;
  }
  function valorPercentual(valor, percentual) {
    const [n, d] = fracaoDecimal(percentual);
    return Number(arredondarRazao(centavosDecimais(valor) * n, d * 100n)) / 100;
  }
  function lerValorMonetario(txt) {
    const s = String(txt ?? '').trim().replace(/^R\$\s*/, '');
    let normalizado;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) normalizado = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(?:,\d{1,2})?$/.test(s)) normalizado = s.replace(',', '.');
    else if (/^\d+\.\d{1,2}$/.test(s)) normalizado = s;
    else return NaN;
    const n = Number(normalizado);
    return Number.isFinite(n) && Number.isSafeInteger(Math.round(n * 100)) ? n : NaN;
  }

  // Condições para montar novas propostas na tela da unidade. O cálculo de
  // propostas já salvas continua usando os valores do próprio registro.
  function condicoesProposta(parcelas, cfg = {}) {
    const n = Number(parcelas);
    const opcoesPrazo = ({ 36: [10, 20, 30], 48: [10, 15, 20] })[n];
    const minimoFinalPct = opcoesPrazo ? Math.min(...opcoesPrazo) : 0;
    const padrao = Math.round((cfg.planoFinalPct ?? .30) * 100);
    const opcoesFinal = opcoesPrazo || [...new Set([padrao,
      ...(Array.isArray(cfg.planoFinalOpcoes) ? cfg.planoFinalOpcoes : [30, 40, 50])])]
      .filter(p => Number.isFinite(p) && p > 0 && p < 100 && p >= minimoFinalPct).sort((a, b) => a - b);
    return { minimoFinalPct, opcoesFinal, finalPadraoPct: opcoesPrazo ? opcoesPrazo[opcoesPrazo.length - 1] : padrao,
      mesFinal: n === 48 ? 48 : (cfg.chavesMes ?? 36) };
  }

  function opcoesParcelasProposta(cfg = {}) {
    return [...new Set([...(Array.isArray(cfg.planoParcelas) && cfg.planoParcelas.length
      ? cfg.planoParcelas : [12, 24, 36]), 36, 48])]
      .filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  }

  function dataVenc(base, m, dia) {
    if (m === 0) return new Date(base.getTime());
    const mo = base.getMonth() + m;
    const y = base.getFullYear() + Math.floor(mo / 12);
    const mm = ((mo % 12) + 12) % 12;
    const ultimo = new Date(y, mm + 1, 0).getDate();
    return new Date(y, mm, Math.min(dia, ultimo));
  }

  // inp: { neg, forma, entradaPct, finalPct, nParcelas, balQtde, balValor,
  //        balPrimeiro, balIntervalo, chavesMes, correcaoMensal, correcaoDesde,
  //        dataProposta (Date), diaVenc }
  function calc(inp) {
    const decimal = inp.arredondamento === 'decimal-v1';
    const money = decimal ? n => Number(centavosDecimais(n)) / 100
      : n => Math.round((n + Number.EPSILON) * 100) / 100;
    const neg = money(+inp.neg || 0);
    const f = inp.forma;
    const preset = { '12x': 12, '24x': 24, '36x': 36 }[f] || null;

    let ent, fin, nParc, vParc, balQtde;
    if (f === 'avista') { ent = neg; fin = 0; nParc = 0; vParc = 0; balQtde = 0; }
    else if (preset) { ent = neg / preset; fin = 0; nParc = preset - 1; vParc = neg / preset; balQtde = 0; }
    else {
      ent = decimal ? valorProporcao(neg, +inp.entradaPct || 0) : neg * (+inp.entradaPct || 0);
      fin = decimal ? valorProporcao(neg, +inp.finalPct || 0) : neg * (+inp.finalPct || 0);
      nParc = Math.max(0, Math.round(+inp.nParcelas || 0));
      balQtde = Math.max(0, Math.round(+inp.balQtde || 0));
      const balTot = balQtde * (+inp.balValor || 0);
      vParc = nParc > 0 ? (neg - ent - fin - balTot) / nParc : 0;
    }
    const balValor = f === 'perso' ? money(+inp.balValor || 0) : 0;
    ent = money(ent); fin = money(fin);
    const saldoCentavos = Math.round(neg * 100) - Math.round(ent * 100) - Math.round(fin * 100) - balQtde * Math.round(balValor * 100);
    vParc = nParc ? Math.floor(saldoCentavos / nParc) / 100 : 0;
    const ultimaParcela = nParc ? (saldoCentavos - Math.round(vParc * 100) * (nParc - 1)) / 100 : 0;
    const balPrimeiro = +inp.balPrimeiro || 6;
    const balIntervalo = Math.max(1, +inp.balIntervalo || 6);
    const chavesMes = Math.max(0, Math.round(+inp.chavesMes || 36));
    const corr = +inp.correcaoMensal || 0;
    const desde = f === '12x' ? 999 : (f === '24x' || f === '36x') ? 13 : Math.max(1, +inp.correcaoDesde || 1);
    const dia = Math.min(28, Math.max(1, Math.round(+inp.diaVenc || 10))); // clampa o vencimento a 1..28 (evita meses sem dia 29-31)
    const base = inp.dataProposta instanceof Date && !isNaN(inp.dataProposta) ? inp.dataProposta : new Date();

    const ultimoBal = balQtde > 0 ? balPrimeiro + (balQtde - 1) * balIntervalo : 0;
    const maxM = Math.max(nParc, chavesMes, ultimoBal, 0);

    const cronograma = [];
    let somaParcelas = 0, somaBaloes = 0, totalCorrigido = ent + fin;
    for (let m = 0; m <= maxM; m++) {
      const entrada = m === 0 ? ent : 0;
      const parcela = (m >= 1 && m <= nParc) ? (m === nParc ? ultimaParcela : vParc) : 0;
      const balao = (balQtde > 0 && m >= 1 && m >= balPrimeiro && (m - balPrimeiro) % balIntervalo === 0
        && (m - balPrimeiro) / balIntervalo + 1 <= balQtde) ? balValor : 0;
      const chaves = (m === chavesMes && fin > 0) ? fin : 0;
      const total = money(entrada + parcela + balao + chaves);
      const fator = Math.pow(1 + corr, Math.max(0, m - (desde - 1)));
      const corrigido = (parcela + balao) * fator;
      somaParcelas += parcela; somaBaloes += balao; totalCorrigido += corrigido;
      if (total > 0 || m === 0) {
        cronograma.push({ m, data: dataVenc(base, m, dia), entrada, parcela, balao, chaves, total, fator, corrigido });
      }
    }
    somaParcelas = money(somaParcelas); somaBaloes = money(somaBaloes);
    const totalNominal = money(ent + somaParcelas + somaBaloes + fin);
    return {
      forma: f, formaLabel: formaLabel(f), neg,
      ent, fin, nParc, vParc, ultimaParcela, balQtde, balValor, chavesMes,
      balPrimeiro, balIntervalo, // valores efetivos (sanitizados) usados no cronograma
      somaParcelas, somaBaloes, totalNominal, totalCorrigido,
      ganhoCorrecao: totalCorrigido - totalNominal,
      cronograma,
      fecha: Math.abs(totalNominal - neg) < 0.01,
      parcelaNegativa: vParc < -0.005,
    };
  }

  function linhasSeparadas(plano) {
    return plano.cronograma.flatMap(l => ['entrada', 'parcela', 'balao', 'chaves'].filter(k => l[k] > 0).map(k => ({...l, entrada:0, parcela:0, balao:0, chaves:0, [k]:l[k], total:l[k]})));
  }
  function resumoMensais(plano, fmt) {
    if (!plano.nParc) return 'Sem parcelas mensais';
    if (plano.ultimaParcela !== plano.vParc) return (plano.nParc - 1) + ' x ' + fmt(plano.vParc,2) + ' + última de ' + fmt(plano.ultimaParcela,2);
    return plano.nParc + ' x ' + fmt(plano.vParc,2);
  }
  return { FORMAS, formaLabel, calc, dataVenc, linhasSeparadas, resumoMensais, condicoesProposta, opcoesParcelasProposta, valorPercentual, lerValorMonetario };
})();
window.PLANO = PLANO;
