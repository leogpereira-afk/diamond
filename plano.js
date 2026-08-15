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
    const neg = +inp.neg || 0;
    const f = inp.forma;
    const preset = { '12x': 12, '24x': 24, '36x': 36 }[f] || null;

    let ent, fin, nParc, vParc, balQtde;
    if (f === 'avista') { ent = neg; fin = 0; nParc = 0; vParc = 0; balQtde = 0; }
    else if (preset) { ent = neg / preset; fin = 0; nParc = preset - 1; vParc = neg / preset; balQtde = 0; }
    else {
      ent = neg * (+inp.entradaPct || 0);
      fin = neg * (+inp.finalPct || 0);
      nParc = Math.max(0, Math.round(+inp.nParcelas || 0));
      balQtde = Math.max(0, Math.round(+inp.balQtde || 0));
      const balTot = balQtde * (+inp.balValor || 0);
      vParc = nParc > 0 ? (neg - ent - fin - balTot) / nParc : 0;
    }
    const balValor = f === 'perso' ? (+inp.balValor || 0) : 0;
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
      const parcela = (m >= 1 && m <= nParc) ? vParc : 0;
      const balao = (balQtde > 0 && m >= 1 && m >= balPrimeiro && (m - balPrimeiro) % balIntervalo === 0
        && (m - balPrimeiro) / balIntervalo + 1 <= balQtde) ? balValor : 0;
      const chaves = (m === chavesMes && fin > 0) ? fin : 0;
      const total = entrada + parcela + balao + chaves;
      const fator = Math.pow(1 + corr, Math.max(0, m - (desde - 1)));
      const corrigido = (parcela + balao) * fator;
      somaParcelas += parcela; somaBaloes += balao; totalCorrigido += corrigido;
      if (total > 0 || m === 0) {
        cronograma.push({ m, data: dataVenc(base, m, dia), entrada, parcela, balao, chaves, total, fator, corrigido });
      }
    }
    const totalNominal = ent + somaParcelas + somaBaloes + fin;
    return {
      forma: f, formaLabel: formaLabel(f), neg,
      ent, fin, nParc, vParc, balQtde, balValor, chavesMes,
      balPrimeiro, balIntervalo, // valores efetivos (sanitizados) usados no cronograma
      somaParcelas, somaBaloes, totalNominal, totalCorrigido,
      ganhoCorrecao: totalCorrigido - totalNominal,
      cronograma,
      fecha: Math.abs(totalNominal - neg) < 0.01,
      parcelaNegativa: vParc < -0.005,
    };
  }

  return { FORMAS, formaLabel, calc, dataVenc };
})();
window.PLANO = PLANO;
