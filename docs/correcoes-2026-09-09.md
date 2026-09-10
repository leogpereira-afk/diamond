# Correções de funcionamento — 09/09/2026

Base do pacote: e60eff39577e3c30dacf63f63ca42ba32f552727. Publicação autorizada em 09/09/2026. Identidade visual preservada. A etapa posterior está em [Navegação e organização](navegacao-2026-09-09.md).

## Comportamento corrigido

- Consulta interna de unidades exige sessão, preservando o acesso do perfil cliente autorizado.
- Primeiro pedido de reserva é mantido em concorrência; unidade inexistente ou indisponível é rejeitada. Usa INSERT sobre a chave primária existente `(store, key)`, sem migração.
- SCP usa o valor descontado e o mesmo identificador para a proposta salva e o envio. O nome do cliente é exigido para enviar pelo fluxo SCP.
- Falha de atualização da nuvem fica visível. Data da última atualização só avança quando as leituras necessárias terminam. Requisições têm limite de 20 segundos. Cliente somente leitura não consulta CRM.
- Datas sem horário e data-base de propostas noturnas preservam o dia local.
- Prévia interna preserva a indicação no PDF e não permite registrar interesse.
- A página do cliente só confirma uma resposta depois do sucesso do servidor; erros permitem nova tentativa. WhatsApp exige a ação explícita de continuar e enviar a mensagem.
- O adaptador respeita prefixos: excluir eventos de um envio não inclui os de outros envios.
- O serviço de cache remove apenas versões antigas do próprio Diamond.

Não há reconciliação automática de registros históricos. A etapa de navegação corrigiu indicadores, reabertura do histórico e associações exibidas no CRM; numeração repetida e vínculos históricos pendentes continuam separados. O pedido não é uma transação conjunta com alteração simultânea de status da unidade.

## Verificação

Executar com Node 22 ou posterior:

```sh
TZ=America/Sao_Paulo node --test tests/*.test.mjs
```

26 testes passaram em 09/09/2026. Incluem autenticação, concorrência, disponibilidade, datas, falhas parciais, timeout, fluxo real de envio SCP com dependências simuladas, página pública e isolamento de cache. A conferência no navegador local usou dados fictícios. Nenhuma escrita de teste foi feita em produção.

`tests/serve-preview.mjs` oferece ambiente manual isolado em 127.0.0.1:8767, com API e sessão fictícias. Usar somente localmente; não publicar essa página de teste como um sistema real. Os arquivos de teste não contêm credenciais de produção.

## Publicação, quando autorizada

Publicar as duas funções `dmd-api` e `dmd-p` com o adaptador compartilhado atualizado, além de `app.js`, `store.js`, `styles.css`, `p.html` e `sw.js` (cache v16, incluindo navegação). Não há migração de banco neste pacote. A mudança do servidor é compatível com clientes autenticados existentes.

Após publicar, conferir login e leitura por perfil, uma prévia de proposta existente e carregamento da versão nova. Reservas, novos envios e interações devem ser testados em ambiente de teste ou em registros explicitamente autorizados. Não tratar a aprovação dos testes locais como comprovação de implantação em produção.
