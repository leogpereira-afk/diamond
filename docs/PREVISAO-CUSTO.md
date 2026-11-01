# Previsão de custo — Diamond v59

Aba da gestão Diamond em `#/admin/painel?visao=previsao`. Versão aprovada para publicação em 01/11/2026 após revisão local. Os lançamentos financeiros desta aba permanecem no navegador; não há migração de servidor nem alteração dos contratos existentes durante a publicação.

## Funcionamento

- Custo inicial configurável: R$ 17.000.000.
- A cobertura considera todos os contratos atuais do empreendimento, inclusive loja. Os filtros comerciais de outras abas não alteram a base da previsão.
- Cobertura = aportes realizados e conferidos + vendas brutas − comissão total das vendas − séries finais.
- Permutas já integram a venda bruta. Contam na cobertura, mas não são dinheiro recebido.
- Recebimentos comuns e finais têm baixas próprias. Eles decompõem a venda contratada e nunca são somados novamente à cobertura. Toda final permanece excluída, mesmo recebida.
- Falta = máximo de zero e custo menos cobertura. O excedente também aparece.
- Meta bruta de novas vendas = falta ÷ (participação durante a obra − comissão sobre a venda inteira), arredondada para cima no centavo. O padrão é 50% durante a obra e 50% final; a comissão futura precisa ser informada explicitamente, inclusive se zero.
- A seleção de unidades disponíveis usa o preço vigente, com reajustes/descontos aplicados pelo modelo existente. Reservas não entram na seleção nem são tratadas como vendas.
- Enquanto a aba está visível, as fontes são consultadas a cada 30 segundos; edições pendentes e diálogos pausam a atualização para preservar a digitação. Salvar retoma o ciclo. O botão Atualizar dados continua disponível.

## Conferência e persistência

O sistema existente armazena condições contratuais, mas não um livro financeiro de aportes, comissões e baixas efetivas. Esta versão usa um registro local separado por origem e usuário. A tela identifica **Salvo neste navegador**, permite exportar JSON e importar com confirmação de substituição.

Não há sincronização entre dispositivos. A importação valida estrutura, datas, valores e versão. Conflitos de revisão, dados corrompidos e falhas de armazenamento preservam o registro anterior.

Ausência de informação não equivale a zero: aportes, comissão e classificação de finais exigem conferência explícita. O mesmo vale para afirmar que nenhuma parcela foi recebida. Alterações do contrato invalidam a conferência antiga; baixas antigas ficam preservadas, fora dos totais, até revisão de vínculo. Mudar a classificação das finais desmarca a conferência de recebimentos.

Valores e cálculos são em centavos inteiros. Recibos e aportes com datas futuras não são aceitos como realizados. O painel é uma previsão de cobertura econômica da obra: não representa saldo bancário, cronograma mensal ou despesas já pagas.

## Estrutura

- `previsao-custo-domain.js`: cálculo puro e validações econômicas.
- `previsao-custo-store.js`: livro local validado, revisão otimista, backup e importação.
- `previsao-custo.js` e `previsao-custo.css`: interação, conferências, indicadores e simulação.
- `gestao.js`, `gestao-painel.js`, `index.html`: integração com a navegação existente.

Não colocar este registro em `cfg`: a configuração geral é compartilhada por endpoints de outros perfis. Uma evolução para sincronização deve usar armazenamento e API específicos com controle de acesso e revisão; esta implementação não cria nem utiliza ações de servidor desconhecidas.

## Verificação e prévia

Com Node disponível:

```sh
node --test tests/*.test.mjs tests/*.test.cjs tests-vagas.cjs
node tests/serve-previsao-preview.mjs
```

A prévia usa API sintética em memória e fica em `http://127.0.0.1:8794/#/admin/painel?visao=previsao`. Não consulta nem altera o sistema real. Os dados financeiros manuais iniciam a conferir; o custo de 17 milhões é apenas a configuração solicitada.

A auditoria de navegador em `tests/audit-previsao-ui.mjs` usa Playwright e Chrome, gera evidências em `output-previsao` e um servidor sintético próprio. `PLAYWRIGHT_MODULE`, `CHROME_PATH` e `PREVIEW_PORT` permitem adaptar os caminhos ao ambiente.
