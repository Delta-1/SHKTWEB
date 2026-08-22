# ERP SHKT

Sistema de gestão web da **SHKT INDÚSTRIA IMPORTAÇÃO & EXPORTAÇÃO LTDA**.

Funciona inteiramente no navegador — notebook, tablet ou celular, de qualquer
lugar, com login e senha. Não há programa para instalar na máquina do usuário.

**Estado atual: FASES 1 e 2 concluídas, com o núcleo da SHKT Transportes
entregue e testado.** O ciclo comercial e operacional está fechado ponta a
ponta:

```
Compra → Recebimento → Estoque → Fumigação → Certificado
                                                  ↓
                        Venda → Carregamento/Exportação → Financeiro
```

Regra que organiza tudo: **pedido não move estoque**. Quem coloca grão no
armazém é o *recebimento*; quem tira é a *expedição* do carregamento.

---

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Painel** | Indicadores de estoque, saldo fumigado, financeiro e operação, com alertas do que está travando o dia. Somente leitura. |
| **Cadastros** | Clientes, fornecedores, fumigadoras, transportadoras, produtos, lotes, veículos, motoristas, funcionários e tabelas de apoio. |
| **Compras** | Pedido numerado (mercadoria, frete ou serviço) com itens, Incoterm, moeda e prazo. Aprovar trava o pedido e gera a previsão em Contas a Pagar. |
| **Recebimento** | Entrada física com pesagem, veículo, motorista e nota fiscal. Recebimento parcial com saldo em aberto e registro de divergência entre previsto e recebido. Confirmar é o que dá entrada no estoque. |
| **Vendas** | Pedido de venda com itens por produto/local. Aprovar reserva o estoque (sem tirar do físico) e gera o Contas a Receber. Cada carregamento consome o saldo do pedido. |
| **Estoque** | Posição por produto/local/lote (físico, reservado, disponível, fumigado, expedido), movimentações, ajustes com motivo, transferências e estornos. |
| **Fumigação** | Pedido numerado, Comunicado obrigatório para validar, conta-corrente de saldo fumigado. |
| **Certificados** | Emissão a partir do saldo fumigado; ao validar, gera o Contas a Pagar automaticamente. |
| **Carregamento** | Programação com reserva de estoque, expedição com baixa física, vínculo opcional ao pedido de venda, documentos (DANFE, MIC-DTA, CRT) e romaneio impresso. |
| **Financeiro** | Contas a pagar e receber, baixas parciais, estornos, caixa e bancos com extrato. |
| **SHKT Transportes** | Viagem numerada com rota, veículo, motorista e frete; abastecimento, despesas e manutenção; receita, custo direto, margem e km/l por viagem. |
| **Relatórios** | Estoque, fumigação, certificados, carregamentos, financeiro, fluxo de caixa e DRE gerencial — com impressão e exportação para planilha. |
| **Auditoria** | Registro imutável de quem fez o quê, quando, com valor anterior e posterior. |
| **Administração** | Usuários, perfis de permissão por módulo/ação e parâmetros da empresa. |

As próximas fases (RH, acerto completo de viagens e Impostos) estão
descritas em [`docs/ROADMAP.md`](docs/ROADMAP.md).

### Como o sistema se apresenta

Quem abre o sistema não vê um painel de doze números: vê **o que fazer agora**,
nas seis etapas da operação, na ordem em que elas acontecem. Abaixo, só o que
está travando o dia. Os números ficam mais embaixo, para quem quiser.

- **Assistente de primeiro acesso** — quatro telas curtas que explicam o fluxo
  e recolhem o mínimo para sair do zero. Dá para pular.
- **Primeiros passos** — checklist na tela inicial que se marca sozinho
  conforme os cadastros existem de verdade, e some quando termina.
- **Formulários em etapas** — pedido de compra, recebimento e pedido de venda
  são divididos em três passos, com conferência por escrito antes de gravar.
  Sem JavaScript o formulário aparece inteiro e funciona igual.
- **Tema claro e escuro, letras grandes e alto contraste**, ajustáveis no
  cabeçalho e lembrados neste aparelho.
- Pensado para o celular no pátio: tabelas viram fichas empilhadas, botões com
  área de toque grande, fonte hospedada junto (não depende de CDN) e
  instalação como aplicativo (PWA).

---

## Instalação

> **Onde isso roda?** Não é um site estático — tem banco de dados, então não
> funciona no GitHub Pages. O guia passo a passo, do teste local até o domínio
> próprio, está em **[docs/PUBLICAR.md](docs/PUBLICAR.md)**.

### Opção A — Docker (recomendada)

Um comando sobe banco, aplicação e rotina de backup:

```bash
cp .env.example .env      # edite as senhas antes de subir
docker compose up -d
```

Acesse `http://localhost:3000`. O primeiro acesso pede a troca da senha.

### Opção B — Node + PostgreSQL instalados na máquina

```bash
npm install
cp .env.example .env      # ajuste DATABASE_URL
npm run setup             # cria as tabelas e a carga inicial
npm start
```

### Primeiro acesso

| | |
|---|---|
| E-mail | valor de `ADMIN_EMAIL` (padrão `admin@shkt.com.br`) |
| Senha | valor obrigatório de `ADMIN_SENHA` definido antes do primeiro seed |

O sistema **obriga a troca da senha** no primeiro login. Depois, crie um usuário
para cada pessoa em **Administração → Usuários**: a auditoria só tem valor se
cada um entrar com o seu próprio acesso.

---

## Colocar no ar (acesso de qualquer lugar)

O sistema é uma aplicação Node + PostgreSQL comum, e sobe em qualquer servidor
com Docker. O caminho mais simples:

1. **Contrate um servidor** (VPS de 2 GB já roda com folga) ou use um provedor
   gerenciado (Render, Railway, Fly.io) apontando para um PostgreSQL gerenciado.
   Para Supabase, siga também **[docs/SUPABASE.md](docs/SUPABASE.md)**.
2. **Aponte um domínio** para o servidor, por exemplo `erp.shkt.com.br`.
3. **Coloque um HTTPS na frente** — nginx com Certbot, Caddy ou Cloudflare.
   Sem HTTPS, senha e sessão trafegam abertas.
4. No `.env` do servidor, defina:
   ```
   NODE_ENV=production
   SESSION_SECURE=true          # exige HTTPS no cookie de sessão
   SESSION_SECRET=<openssl rand -base64 48>
   DB_PASSWORD=<senha forte>
   ```
5. `docker compose up -d`.

Exemplo de nginx como proxy reverso:

```nginx
server {
    server_name erp.shkt.com.br;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

O código não tem nada preso ao servidor local: banco, sessão, anexos e dados da
empresa vêm todos de variáveis de ambiente, então migrar para outro provedor é
trocar o `.env`.

---

## Backup e restauração

O `docker compose` já sobe um serviço que roda o backup diariamente, verifica a
integridade do arquivo gerado e guarda os últimos 30 dias em `./backups`.

Backup manual:

```bash
docker compose exec backup sh /backup.sh
```

**Testar a restauração** (faça isso pelo menos uma vez por mês — backup que
nunca foi restaurado não é backup):

```bash
# cria um banco temporário e restaura o backup mais recente nele
docker compose exec banco createdb -U shkt shkt_teste_restore
docker compose exec banco sh -c \
  'pg_restore -U shkt -d shkt_teste_restore $(ls -t /backups/*.dump | head -1)'
docker compose exec banco psql -U shkt -d shkt_teste_restore \
  -c "select count(*) from certificados_fumigacao"
docker compose exec banco dropdb -U shkt shkt_teste_restore
```

O histórico das rotinas fica em `backups/backups.log`.

---

## Testes

```bash
npm test
```

São 50 testes automatizados que rodam contra um banco de teste separado
(`shkt_erp_test`) e provam as regras que não podem falhar:

- o roteiro de aceite completo da Fase 1 (600 t → fumigação 500 t → certificado
  100 t → saldo 400 t → carregamento → expedição → financeiro);
- estoque nunca fica negativo, nem com duas expedições simultâneas;
- certificado nunca ultrapassa o saldo fumigado, nem com duas validações
  simultâneas;
- fumigação não é validada sem Comunicado — nem por um `UPDATE` direto no banco;
- a mesma origem nunca gera dois títulos financeiros;
- numeração documental sem duplicidade sob concorrência;
- cancelamentos e estornos devolvem saldos e preservam o histórico;
- auditoria e movimentos de estoque são imutáveis.
- viagem, frete e abastecimento geram receita/custo uma única vez e calculam
  margem e consumo corretamente.

---

## Estrutura do projeto

```
db/migrations/     estrutura do banco (uma migração por arquivo, aplicada uma vez)
src/
  config.js        configuração por variáveis de ambiente
  db/              conexão, transações, migrações e carga inicial
  lib/             decimal exato, permissões, auditoria, numeração, validação
  services/        REGRAS DE NEGÓCIO (estoque, fumigação, certificados, ...)
  routes/          endereços web e leitura de formulários
  views/           telas (EJS) e documentos para impressão
  public/          CSS, JS e imagens
scripts/backup.sh  rotina de backup com verificação de integridade
tests/             testes automatizados
docs/              arquitetura, operação e roadmap
```

Leitura recomendada antes de mexer no código:
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o sistema |
| `npm run dev` | Sobe recarregando a cada alteração |
| `npm run migrate` | Aplica migrações pendentes no banco |
| `npm run seed` | Carga inicial (idempotente) |
| `npm run setup` | `migrate` + `seed` |
| `npm test` | Roda os testes |
