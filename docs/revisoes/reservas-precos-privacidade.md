# Reservas: tabela vigente e privacidade

Base: ba6b55d. Implementação e ensaios em cópia isolada. Nenhuma reserva real cancelada para teste.

## Comportamento

- Cancelar reserva/reabrir venda zera o desconto e recupera o preço normal pelo histórico encadeado das tabelas. O multiplicador legado continua aplicado uma só vez.
- Novas reservas guardam a base normal antes das edições da negociação. Edições comuns não podem substituir essa base.
- Histórico incompleto impede a liberação com aviso, em vez de assumir um preço. Registros antigos usam a base e os reajustes existentes no histórico; alterações manuais anteriores ao primeiro histórico não podem ser reconstruídas sem evidência adicional.
- Corretor recebe apenas campos públicos da unidade reservada, sem valores, desconto, reserva ou observações. Gestão conserva acesso.
- O cache do navegador remove valores antigos das reservas; a leitura preserva a versão da tabela para sincronizar corretamente.
- O espelho apresenta “Valor restrito”. O PDF da tabela mostra somente situação/identificação das reservas.

## Verificação

- 328 testes Node e 16 testes da garagem passaram.
- Prévia autenticada com usuários fictícios: corretor sem valores; cancelamento pela tela de gestão; unidade liberada disponível com valor reajustado; demais reservas continuam restritas.
- PDF baixado da prévia e texto inspecionado: valores ausentes nas reservadas.
- Migração validada em PostgreSQL 17.6 isolado: 12 verificações de permissões, rollback e concorrência passaram.
- Documentos/propostas históricos já compartilhados não foram apagados ou revogados. A correção protege os dados atuais da unidade e o PDF da tabela.

## Publicação

Migração aplicada antes da API dmd-api v99. Interface com cache v53.
Conferência de produção deve preservar as reservas reais e distinguir teste isolado de verificação visual.

Prévia: node tests/serve-reservas-preview.mjs (dados fictícios; porta 5524).
Corretor: /?perfil=corretor. Gestão: /?perfil=gestao#/admin/reservas.
