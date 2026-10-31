# Unidades e vendas — prévia local

Branch: `codex/vendas-tabelas-clientes`. Base: `05f95d3`.
Nenhum cadastro real foi alterado. Publicação e aplicação de migração autorizadas por Léo em 31/10/2026, após aprovação da prévia.

## Comportamento

- Valor vendido e referência de tabela usam `vendas_condicoes`; não substituem `precoBase` nem alteram disponibilidade.
- A tabela da venda é um snapshot resolvido no servidor. A tabela exibida no formulário precisa continuar igual ao salvar. Reajustes posteriores não alteram a referência já gravada.
- Entrada, permutas, parcelas e observações são preservadas. O usuário pode autorizar explicitamente salvar a composição incompleta; o saldo a informar aparece no painel e no CSV, sem representar recebimento.
- Gravação atômica confere unidade, comprador, revisão de condições e fonte da tabela. Conflitos não sobrescrevem registros.
- Cadastro a partir da unidade abre a ficha canônica do cliente, com retorno para o recorte de vendas.
- Corretores usam identidade de equipe e nome normalizado na apresentação. Históricos não são reescritos ou excluídos. Equipes distintas permanecem separadas.
- Novo `vendedorUsuario` identifica a equipe quando há cadastro confirmado; reservas e reabertura não carregam uma identidade antiga para uma venda futura.

## Executar a prévia

```sh
node tests/serve-vendas-preview.mjs
```

Abrir `http://127.0.0.1:8791/#/admin/vendas`. Dados inteiramente fictícios. O servidor mantém as edições em memória entre recargas; reiniciá-lo restaura os exemplos. `/audit-state` permite conferir somente o estado desse servidor de teste.

```sh
node --test tests/*.test.mjs tests-vagas.cjs
```

## Ordem de publicação

1. Conferir novamente a main e reexecutar testes sobre a base atual.
2. Validar/aplicar `202610311100_vendas_condicoes_tabelas.sql` no ambiente aprovado.
3. Publicar `dmd-api` com `condicoes-tabelas.mjs` e demais alterações autorizadas.
4. Publicar o shell v57 (inclui editor, catálogo e estilos no service worker).
5. Conferir versão servida, permissões e um fluxo sintético autorizado no oficial.

A aplicação anterior continua compatível com o backend novo; a tela nova deve entrar após a função e a migração. Esta prévia não comprova publicação ou sincronização no ambiente oficial.

## Conferência realizada

- 389 testes automatizados passaram, zero falhas e zero testes ignorados.
- SQL executado em PostgreSQL temporário: inserção/revisão, conflitos e permissões conferidos.
- Navegador em 390 px e 1440 px: sem rolagem horizontal; valor com centavos e tabela preservados após recarregar.
- Cadastro sintético abriu a ficha canônica e manteve vínculo de unidade.
- Troca de equipe persistiu o login correto; homônimos de outra equipe permaneceram separados.
- Conferência do servidor local comprovou preservação de entrada, permuta, 24 parcelas, observações e preços base.
- Shell v57: 38 scripts/estilos presentes no cache versionado.
