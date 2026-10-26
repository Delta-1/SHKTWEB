# SHKTWEB — fluxo operacional e arquivos assíncronos

## Operação

Depois do login, o usuário entra em **Operações**. As etapas consultam o banco e
mostram cadastros, pendências de aprovação, estoque, fumigação, certificados,
vendas, carregamentos e financeiro. Transportes, RH, obrigações, importações e
relatórios continuam disponíveis no apoio e no menu, conforme as permissões.

O assistente de instalação permanece disponível. Alterar a empresa requer
administração; cadastrar produto/local requer permissão de cadastro. Os dados
salvos da empresa são reutilizados nos documentos e nos PDFs.

## Formulários e continuidade

Os formulários operacionais usam rascunho por usuário e endereço de formulário.
O salvamento não aprova documentos, reserva estoque ou lança financeiro. O
usuário pode recuperar o conteúdo por **Continuar rascunho**, inclusive várias
linhas de itens e a etapa em que parou. Os rascunhos aparecem em Operações.

Cada gravação exige a versão anteriormente lida. Em conflito entre duas abas,
o servidor responde 409 e preserva a versão mais recente. A gravação final de
negócio apaga apenas a revisão enviada; erro de validação conserva o rascunho.
Sem conexão, a tela informa alterações pendentes e avisa ao tentar sair.

Compras, vendas, recebimentos, viagens e manutenção já possuem passos próprios.
Os grupos dos formulários de fumigação, certificado e carregamento também são
apresentados como etapas. Sem JavaScript, os formulários continuam completos.

## PDFs e anexos

**Gerar PDF** na tela de compra, venda, recebimento, fumigação, certificado ou
carregamento solicita uma tarefa e retorna HTTP 202. **Arquivos** mostra a fila,
o progresso e o download. A mesma versão solicitada duas vezes reutiliza a
tarefa. Alterações no documento produzem uma nova cópia.

A tarefa guarda um retrato dos dados. O processador usa atribuição atômica,
`FOR UPDATE SKIP LOCKED`, token e lease de cinco minutos; tarefas interrompidas
podem ser retomadas. Há até três tentativas automáticas e reprocessamento manual
após falha. A geração não modifica documentos, estoque ou títulos financeiros.
A permissão é conferida ao solicitar, processar e baixar; a tarefa pertence ao
usuário que a solicitou.

Os PDFs (até 10 MiB) e os novos anexos (até 20 MiB) ficam no banco. Reiniciar ou
substituir o container não remove esses arquivos. Os anexos anteriores em disco
continuam sendo lidos pelo caminho original; devem ser migrados antes de retirar
seu volume. O envio de anexos exibe progresso sem recarregar o formulário.

## Banco e publicação

O Supabase é acessado somente pelo servidor Express. A credencial dedicada
`shkt_backend` não tem superusuário, criação de banco/roles nem bypass de RLS.
Políticas exclusivas desse papel permitem as operações do servidor. `anon` e
`authenticated` não recebem acesso às tabelas do ERP. A credencial de login é
configurada no ambiente, fora do Git e das migrações.

`SHKT_SUPABASE_URL`, quando definida, tem prioridade sobre `DATABASE_URL`.
Conexões Supabase usam TLS. A conexão direta requer saída IPv6 quando o projeto
não possui IPv4; o Session pooler é alternativa para redes somente IPv4.

O predeploy confere a origem anterior antes de alternar uma instalação vazia.
Cadastros compatíveis são transferidos em uma transação, com salvaguarda
privada da origem e do destino, preservando o acesso já utilizado. Se houver
operações, aborta para exigir uma migração específica. A origem não é apagada. Após conferência,
`SHKT_ORIGEM_CONFERIDA=true` evita depender da origem antiga em novos deploys.

Migrações: 020 (fila/conteúdo de anexos), 021 (papel do servidor) e 999
(rascunhos protegidos). Em produção com o papel dedicado, aplique novas DDLs
com uma conexão administrativa antes de publicar; o papel da aplicação não
recebe privilégio de alterar o esquema.

Endpoints: `/health/live` verifica o processo; `/health/ready` confirma acesso à
tabela da fila. A prontidão é usada pelo healthcheck da hospedagem.

## Backup e recuperação

`npm run backup` gera dump customizado com a conexão ativa, verifica o índice e
aplica retenção. Use pg_dump da mesma versão principal do servidor ou superior
(PostgreSQL 17 no Supabase SHKTWEB). PDFs e novos anexos estão incluídos no dump.
A rotina não substitui o teste de restauração nem configura, por si só, um
agendamento externo. Configure o agendamento e a cópia fora da hospedagem de
acordo com a política operacional da empresa. O Docker existente já contém a
rotina diária de backup; para hospedagem gerenciada use a política do provedor
ou um job dedicado. Consulte também `docs/OPERACAO.md`.

## Validação

- `npm test`: regras de estoque, fumigação, certificados, comercial, frota,
  caixa, cálculos, concorrência e as integrações HTTP de rascunhos/PDF/anexos.
- `npx playwright install chromium` e `npm run test:browser`: login, fluxo,
  pedido com dois itens, salvamento/recuperação das linhas e etapa, gravação e
  download do PDF, com viewport de computador e celular.
- `SHKT_BROWSER_BIN` permite informar um Chromium já instalado.
- Testes usam exclusivamente `TEST_DATABASE_URL`; nunca aponte para produção.
