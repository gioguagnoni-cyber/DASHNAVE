# Agendamentos de campanhas

## Entrega em duas etapas

Nesta etapa: área independente na lateral, catálogo de campanhas Meta por ID de
conta, horários e dias em Brasília, controle de acesso, registro de execuções,
worker e Cron preparados. O Cron nasce **inativo**, todas as contas com execução
**desabilitada**, e nenhum token da Meta é incluído no código.

Ao abrir sem login, o usuário pode experimentar os horários na tela. A interface
identifica explicitamente a simulação: ela não salva nem executa. Para salvar,
é necessário um usuário do Supabase Auth autorizado em `automation_members` para
a conta selecionada. O login protege só os agendamentos; os relatórios continuam
públicos. O provisionamento desse administrador será concluído junto à conexão
da Meta, sem criar senhas nem conceder acesso a visitantes automaticamente.

## Regras

- Contas e campanhas identificadas pelos IDs da Meta, nunca pelo sufixo.
- Fuso exclusivo `America/Sao_Paulo`, independente do fuso financeiro da conta.
- Uma janela por campanha/dia, com início anterior ao fim. Início inclusivo e
  término exclusivo; horários de dias diferentes não são aceitos nesta versão.
- Dias não selecionados ficam pausados. Desabilitar a automação interrompe os
  comandos futuros e mantém o estado atual da campanha.
- Cada transição é executada uma vez por revisão/horário. Uma pausa manual após
  a ativação programada não é desfeita a cada minuto; a próxima ativação será na
  próxima janela. Editar uma regra habilitada inicia uma nova revisão.
- O worker reconcilia o horário atual: um atraso após o fim da janela nunca
  provoca ativação tardia. O Cron trabalha em minutos, sem promessa de execução
  instantânea; rede e disponibilidade da Meta podem gerar atrasos.
- Antes de uma alteração, confirmar conta e campanha na Meta, revisar as travas
  e registrar a tentativa. Enviar exclusivamente `{status: ACTIVE|PAUSED}`.
- Confirmar o status retornado pela Meta. Até três tentativas com intervalo e
  lease; idempotência por conta/campanha/revisão/janela. Conflitos entre estados
  concorrentes da mesma campanha são serializados.
- Nenhuma alteração em orçamento, criativo, público, conjuntos ou finanças.

## Finalização quando o aplicativo estiver disponível

1. Vincular aplicativo e usuário de sistema às contas desejadas; validar os
   escopos e a identidade com chamadas de leitura. A credencial pode expirar ou
   ser revogada: isso deve interromper as execuções e aparecer no monitoramento.
2. Definir `META_GRAPH_VERSION` (versão suportada validada nessa data) e
   `META_ACCESS_TOKEN_<ID_DA_CONTA>` nos segredos das Edge Functions. Não enviar
   tokens ao frontend, ao Git, ao log ou a documentos públicos.
3. Criar `AUTOMATION_CRON_SECRET` aleatório no ambiente da função e uma cópia no
   Vault com nome `dashnave_automation_cron_secret`. Configurar o segredo por um
   canal seguro; o token da Meta não precisa ser colado nesta conversa.
4. Provisionar o administrador no Auth e inserir seu ID em `automation_members`
   apenas para as contas autorizadas. Cadastro público não concede privilégios.
5. Executar a sincronização autenticada em `campaign-scheduler` com
   `{operation:"sync",account_id:"..."}`. Conferir paginação e campanhas reais.
6. Salvar horários inicialmente desabilitados. Rodar simulação e revisar dias,
   próximo disparo e separação de contas com o responsável.
7. Só após essa conferência, habilitar as contas desejadas em
   `automation_accounts.execution_enabled`, o segredo global
   `AUTOMATION_EXECUTION_ENABLED=true`, as regras escolhidas e o job
   `dashnave-campaign-scheduler` no Cron. Não é necessário republicar relatórios.
8. Verificar primeira ativação e primeira pausa, registros de erro e retry.

O endpoint exige autorização: Cron usa segredo próprio; sincronização manual
usa JWT de usuário confirmado no Auth + autorização por conta. O parâmetro
`verify_jwt=false` permite o segredo do Cron; não torna a função pública.

## Estrutura e reversão

`docs/assets/schedules.mjs` e seu CSS são carregados só ao abrir Agendamentos.
`schedule-core.mjs` contém apenas regras puras compartilhadas pelo frontend e
pelo worker. A integração no HTML se limita ao botão e ao carregamento isolado.

As tabelas `automation_*` não alteram nem recalculam `msgs_results`, `days`,
`campaigns`, `dashboard_accounts` ou as views/RPCs financeiras. O catálogo público
expõe apenas nomes/IDs/status já exibidos no painel; regras e logs exigem acesso
por conta. Não existe token armazenado em tabela pública.

Reversão operacional: desativar o job ou definir
`AUTOMATION_EXECUTION_ENABLED=false`; novos disparos não alteram a Meta.
Reversão visual: reverter o commit do módulo. As tabelas novas podem permanecer
sem uso para preservar configurações/logs, sem prejudicar os relatórios.

Arquivos de importação e backups locais não são ativos baixados pelo navegador.
Não devem ser apagados sob a suposição de que causam lentidão. A nova área não
depende desses arquivos e não introduz uma segunda dashboard.

## Auditoria da preparação — 05/09/2026

- `npm test`: 50 testes aprovados; lint e build aprovados.
- `tests/schedules-database.sql`: teste transacional aprovado no Supabase, com
  rollback integral. Conferidos RLS, isolamento por conta, bloqueio de ativação
  pendente, duplicidade, concorrência e validade das tentativas.
- As impressões digitais de todas as linhas das tabelas financeiras/cadastrais
  permaneceram idênticas: 2.525 resultados, 79 registros de dias, 275 campanhas
  e quatro contas. Nenhum recálculo ou lançamento foi feito.
- Cron inativo; zero regras, zero execuções e zero contas com execução liberada.
  Chamada pública ao worker sem autenticação retorna HTTP 401.
- Catálogo inicial consultado na Meta: oito campanhas ativas na DIZZ 1 USD;
  nenhuma ativa nas outras duas contas consultáveis. A conta BRL antiga está
  sinalizada como indisponível para consulta operacional, sem afetar o histórico.
- Interface conferida em desktop e celular: pesquisa, prévia sem gravação,
  restauração da rolagem e fluxo existente mês → dia → campanha. Os três arquivos
  da interface nova são carregados somente quando ela é aberta.
- Advisor de segurança sem alertas. Dois índices novos aparecem como ainda não
  utilizados, esperado enquanto não existem regras/execuções; são mantidos para
  as relações e consultas operacionais. [Orientação do Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

A execução real na Meta e o login administrativo ainda dependem do aplicativo,
das credenciais e do provisionamento do administrador. Não foram apresentados
como testados em produção nesta etapa.
