# ERP SHKT

Sistema de gestão web da **SHKT INDÚSTRIA IMPORTAÇÃO & EXPORTAÇÃO LTDA**.

Funciona inteiramente no navegador — notebook, tablet ou celular, de qualquer
lugar, com login e senha. Não há programa para instalar na máquina do usuário.

**Estado atual: FASE 1 concluída e testada.** O núcleo crítico da operação está
pronto ponta a ponta:

```
Cadastros → Estoque → Fumigação → Certificado → Carregamento/Exportação → Financeiro
```

---

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Painel** | Indicadores de estoque, saldo fumigado, financeiro e operação, com alertas do que está travando o dia. Somente leitura. |
| **Cadastros** | Clientes, fornecedores, fumigadoras, transportadoras, produtos, lotes, veículos, motoristas, funcionários e tabelas de apoio. |
| **Estoque** | Posição por produto/local/lote (físico, reservado, disponível, fumigado, expedido), movimentações, ajustes com motivo, transferências e estornos. |
| **Fumigação** | Pedido numerado, Comunicado obrigatório para validar, conta-corrente de saldo fumigado. |
| **Certificados** | Emissão a partir do saldo fumigado; ao validar, gera o Contas a Pagar automaticamente. |
| **Carregamento** | Programação com reserva de estoque, expedição com baixa física, documentos (DANFE, MIC-DTA, CRT) e romaneio impresso. |
| **Financeiro** | Contas a pagar e receber, baixas parciais, estornos, caixa e bancos com extrato. |
| **Relatórios** | Estoque, fumigação, certificados, carregamentos, financeiro, fluxo de caixa e DRE gerencial — com impressão e exportação para planilha. |
| **Auditoria** | Registro imutável de quem fez o quê, quando, com valor anterior e posterior. |
| **Administração** | Usuários, perfis de permissão por módulo/ação e parâmetros da empresa. |

As próximas fases (Compras/Recebimento/Vendas, RH, Abastecimento, Viagens,
Manutenção, Impostos) estão descritas em [`docs/ROADMAP.md`](docs/ROADMAP.md).

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
| Senha | valor de `ADMIN_SENHA` |

O sistema **obriga a troca da senha** no primeiro login. Depois, crie um usuário
para cada pessoa em **Administração → Usuários**: a auditoria só tem valor se
cada um entrar com o seu próprio acesso.

---

## Colocar no ar (acesso de qualquer lugar)

O sistema é uma aplicação Node + PostgreSQL comum, e sobe em qualquer servidor
com Docker. O caminho mais simples:

1. **Contrate um servidor** (VPS de 2 GB já roda com folga) ou use um provedor
   gerenciado (Render, Railway, Fly.io) apontando para um PostgreSQL gerenciado.
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

São 26 testes automatizados que rodam contra um banco de teste separado
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
