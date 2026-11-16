"""Confronta o motor JavaScript com Decimal e verifica compatibilidade histórica."""
import argparse
import json
import random
import shutil
import subprocess
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_FLOOR
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--node', default=shutil.which('node'))
parser.add_argument('--output', default='/private/tmp/diamond-auditoria-calculos-final.json')
args = parser.parse_args()
if not args.node:
    parser.error('Informe --node com o executável Node.js')
root = Path(__file__).resolve().parent.parent
random.seed(36)
values = [D('373563.84'), D('100000.01'), D('150000.05'), D('299999.95'), D('1000000.99')]
values += [D(random.randrange(10000000, 150000000)) / 100 for _ in range(150)]
cases = []
for total in values:
    for n, options in [(36, [10,20,30]), (48, [10,15,20])]:
        for entry_pct in [10, 20, 30]:
            for final_pct in options:
                for balloons in [0, 5]:
                    entry = (total * entry_pct / 100).quantize(D('.01'), rounding=ROUND_HALF_UP)
                    final = (total * final_pct / 100).quantize(D('.01'), rounding=ROUND_HALF_UP)
                    remaining = total - entry - final - balloons * D(10000)
                    if remaining <= 0:
                        continue
                    monthly = (remaining / n).quantize(D('.01'), rounding=ROUND_FLOOR)
                    last = remaining - monthly * (n - 1)
                    cases.append({'input': {'neg': float(total), 'forma': 'perso', 'entradaPct': entry_pct / 100,
                        'finalPct': final_pct / 100, 'nParcelas': n, 'balQtde': balloons, 'balValor': 10000,
                        'chavesMes': n}, 'expected': {'ent': float(entry), 'fin': float(final), 'vParc': float(monthly),
                        'ultimaParcela': float(last), 'totalNominal': float(total)}})
code = r"""
const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const context=code=>{const c={window:{},Date};vm.runInNewContext(code,c);return c.window.PLANO;};
const P=context(fs.readFileSync('plano.js','utf8'));
const antigo=context(cp.execFileSync('git',['show','HEAD:plano.js'],{encoding:'utf8'}));
const data=JSON.parse(fs.readFileSync(0,'utf8')),failures=[],legacyFailures=[];
for(const c of data){
 const input={...c.input,dataProposta:new Date('2026-11-16T12:00:00-03:00')};
 const p=P.calc({...input,arredondamento:'decimal-v1'});
 const diff=Object.entries(c.expected).filter(([k,v])=>p[k]!==v).map(([k,v])=>({key:k,expected:v,actual:p[k]}));
 const minPct=10,announced=P.valorPercentual(c.input.neg,minPct);
 if(c.input.finalPct===minPct/100&&p.fin<announced)diff.push({key:'minimoAnunciado',expected:announced,actual:p.fin});
 if(P.linhasSeparadas(p).reduce((s,l)=>s+Math.round(l.total*100),0)!==Math.round(c.expected.totalNominal*100))diff.push({key:'cronograma'});
 if(p.cronograma.find(l=>l.chaves)?.m!==c.input.chavesMes)diff.push({key:'mesFinal'});
 if(diff.length)failures.push({input:c.input,diff});
 if(JSON.stringify(P.calc(input))!==JSON.stringify(antigo.calc(input)))legacyFailures.push(c.input);
}
console.log(JSON.stringify({cases:data.length,failures,legacyCases:data.length,legacyFailures}));
"""
run = subprocess.run([args.node, '-e', code], cwd=root, input=json.dumps(cases), text=True, capture_output=True, check=True)
result = json.loads(run.stdout)
Path(args.output).write_text(json.dumps(result, indent=2))
print(json.dumps({'cases': result['cases'], 'failures': len(result['failures']),
                  'legacyCases': result['legacyCases'], 'legacyFailures': len(result['legacyFailures'])}, indent=2))
raise SystemExit(bool(result['failures'] or result['legacyFailures']))
