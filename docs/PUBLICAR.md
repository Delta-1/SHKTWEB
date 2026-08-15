# Como abrir o ERP SHKT

**GitHub Pages não serve para este sistema.** O Pages publica apenas páginas
estáticas. Este ERP tem banco de dados, login e regras que rodam no servidor —
ele precisa de um lugar que execute Node + PostgreSQL.

Escolha um dos três caminhos abaixo conforme o momento.

---

## Caminho 1 — Ver funcionando no seu computador (5 minutos, sem custo)

Serve para você abrir, mexer e mostrar para o cliente antes de contratar
qualquer coisa.

**Instale o Docker Desktop** (docker.com/products/docker-desktop) e rode:

```bash
git clone https://github.com/Delta-1/SHKTWEB.git
cd SHKTWEB
git checkout claude/shkt-system-from-chat-peojne
cp .env.example .env
docker compose up -d
```

Abra **http://localhost:3000**.

| | |
|---|---|
| E-mail | `admin@shkt.com.br` |
| Senha | `shkt@2026` (o sistema obriga a trocar no primeiro acesso) |

Para parar: `docker compose down`.
Para apagar tudo e recomeçar do zero: `docker compose down -v`.

> Neste modo o endereço só funciona no seu computador. O cliente ainda não
> consegue acessar de fora — para isso, siga o caminho 2 ou 3.

### Sem Docker?

Funciona igual com Node 20+ e PostgreSQL instalados na máquina:

```bash
npm install
cp .env.example .env          # ajuste DATABASE_URL para o seu Postgres
npm run setup                 # cria as tabelas e a carga inicial
npm start
```

---

## Caminho 2 — Colocar online com link próprio (Render, mais fácil)

O jeito mais rápido de o cliente acessar de qualquer lugar. O repositório já traz
o arquivo `render.yaml`, então o Render monta tudo sozinho: banco, aplicação,
HTTPS e um endereço público.

1. Crie a conta em **render.com** e conecte o GitHub.
2. **New → Blueprint**.
3. Escolha o repositório **Delta-1/SHKTWEB** e a branch
   `claude/shkt-system-from-chat-peojne`.
4. O Render lê o `render.yaml` e mostra o que vai criar (um banco e um site).
   Ele vai pedir o valor de **`ADMIN_SENHA`** — defina a senha do primeiro
   acesso ali.
5. **Apply**. Em poucos minutos ele devolve um endereço parecido com
   `https://shkt-erp.onrender.com`.

Pronto: esse link abre no celular e no notebook do cliente, de qualquer lugar.

**Sobre os planos:** o `render.yaml` vem com os planos pagos mais baratos
(`basic-256mb` no banco e `starter` no site), que é o correto para uso real —
nos planos gratuitos o site "dorme" quando ninguém acessa e o banco tem prazo de
validade. Para só testar, troque as duas linhas `plan:` para `free`. Confirme os
valores atuais no site do Render, porque mudam de tempos em tempos.

### Domínio da empresa

Depois de funcionando, em **Settings → Custom Domain** do Render, adicione
`erp.shkt.com.br` e crie o registro CNAME que ele indicar no painel do domínio
da SHKT. O HTTPS é emitido automaticamente.

---

## Caminho 3 — Servidor próprio (produção definitiva)

Indicado quando o cliente quiser os dados em servidor dele. Um VPS de 2 GB
(Hetzner, DigitalOcean, Contabo, Locaweb) roda com folga.

```bash
# no servidor, com Docker instalado
git clone https://github.com/Delta-1/SHKTWEB.git
cd SHKTWEB && git checkout claude/shkt-system-from-chat-peojne
cp .env.example .env
nano .env        # defina DB_PASSWORD, SESSION_SECRET e SESSION_SECURE=true
docker compose up -d
```

Depois coloque um HTTPS na frente. Com **Caddy** são duas linhas — ele cuida do
certificado sozinho:

```
erp.shkt.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

Ou com nginx + Certbot, conforme o exemplo no [README](../README.md).

**Antes de liberar para o cliente, no `.env`:**

```
NODE_ENV=production
SESSION_SECURE=true                        # exige HTTPS no cookie de sessão
SESSION_SECRET=<openssl rand -base64 48>   # segredo aleatório e único
DB_PASSWORD=<senha forte>
```

Sem HTTPS, a senha do cliente trafega aberta na rede.

O backup diário já sobe junto e grava em `./backups`. Copie essa pasta para
fora do servidor (Google Drive, S3, HD externo) — backup que mora só na mesma
máquina não protege contra perda da máquina.

---

## Qual escolher

| Situação | Caminho |
|---|---|
| Quero ver e testar agora | **1** — Docker no seu computador |
| Quero mostrar ao cliente e ele usar já | **2** — Render, com link pronto |
| O cliente aprovou e vai operar de verdade | **2** com plano pago **ou 3** em servidor próprio |

Dá para começar no 2 e migrar para o 3 depois: banco, sessões e dados da empresa
são todos configurados por variáveis de ambiente, então mudar de hospedagem é
trocar o `.env` e restaurar o backup.
