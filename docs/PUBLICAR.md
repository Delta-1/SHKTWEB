# Como abrir o ERP SHKT

Este sistema tem **banco de dados**: ele guarda estoque, fumigação, certificados
e financeiro. Por isso precisa de um lugar que mantenha **um servidor ligado +
um PostgreSQL**.

**Onde NÃO funciona:**

| Serviço | Por quê |
|---|---|
| **GitHub Pages** | Publica só páginas estáticas. Não roda servidor nem banco. |
| **Vercel / Netlify** | Feitos para sites e funções que sobem e descem a cada acesso. Não têm banco próprio e sofrem com conexões de banco abertas. Daria para forçar, mas com lentidão no primeiro acesso e dor de cabeça — não compensa. |

**Onde funciona bem:** Railway, Render, ou um servidor próprio (VPS). Escolha um
dos caminhos abaixo.

---

## Caminho 1 — Railway (mais fácil para colocar online)

O Railway sobe o sistema e o banco no mesmo lugar, direto do GitHub. O
repositório já traz o `railway.json`, então ele sabe o que fazer sozinho.

1. Entre em **railway.com** e faça login com o GitHub.
2. **New Project → Deploy from GitHub repo** → escolha **Delta-1/SHKTWEB**.
3. Em **Settings → Source**, troque a branch para
   `claude/shkt-system-from-chat-peojne`.
4. No mesmo projeto: **+ New → Database → Add PostgreSQL**.
   O Railway cria o banco e a variável `DATABASE_URL` automaticamente.
5. Clique no serviço do ERP → aba **Variables** → adicione:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao banco criado) |
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | qualquer texto longo e aleatório |
   | `SESSION_SECURE` | `true` |
   | `ADMIN_EMAIL` | `admin@shkt.com.br` |
   | `ADMIN_SENHA` | a senha do primeiro acesso |
   | `TZ_APP` | `America/Sao_Paulo` |

6. Aba **Settings → Networking → Generate Domain**.

Pronto. Ele devolve um endereço como `https://shktweb-production.up.railway.app`
que abre no celular e no notebook, de qualquer lugar.

As tabelas e a carga inicial são criadas sozinhas no primeiro start — não
precisa rodar nada à mão.

### Domínio da empresa
Ainda em **Settings → Networking → Custom Domain**, adicione `erp.shkt.com.br` e
crie o CNAME que ele indicar, no painel do domínio da SHKT. O HTTPS sai
automático.

---

## Caminho 2 — Render (alternativa, com blueprint pronto)

Equivalente ao Railway. O repositório traz o `render.yaml`, que cria banco e
site de uma vez.

1. Conta em **render.com**, conectada ao GitHub.
2. **New → Blueprint** → repositório **Delta-1/SHKTWEB** → branch
   `claude/shkt-system-from-chat-peojne`.
3. Ele mostra o que vai criar e pede o valor de **`ADMIN_SENHA`**.
4. **Apply**. Sai um endereço `https://shkt-erp.onrender.com`.

O `render.yaml` vem com os planos pagos mais baratos, que é o correto para uso
real — nos planos gratuitos o site "dorme" quando ninguém acessa e o banco tem
prazo de validade. Para só testar, troque as duas linhas `plan:` para `free`.

---

## Caminho 3 — Ver no seu computador antes de contratar (sem custo)

Serve para você abrir, mexer e mostrar ao cliente antes de decidir qualquer
coisa. Instale o **Docker Desktop** (docker.com) e rode:

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

Parar: `docker compose down`. Apagar tudo e recomeçar: `docker compose down -v`.

> Neste modo o endereço só funciona no seu computador — o cliente ainda não
> acessa de fora.

**Sem Docker?** Com Node 20+ e PostgreSQL instalados:

```bash
npm install
cp .env.example .env          # ajuste DATABASE_URL
npm run setup
npm start
```

---

## Caminho 4 — Servidor próprio (quando o cliente quiser os dados com ele)

Um VPS de 2 GB (Hetzner, DigitalOcean, Contabo, Locaweb) roda com folga.

```bash
git clone https://github.com/Delta-1/SHKTWEB.git
cd SHKTWEB && git checkout claude/shkt-system-from-chat-peojne
cp .env.example .env
nano .env        # DB_PASSWORD, SESSION_SECRET e SESSION_SECURE=true
docker compose up -d
```

HTTPS na frente com **Caddy** são duas linhas — ele cuida do certificado:

```
erp.shkt.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

O backup diário já sobe junto e grava em `./backups`. Copie essa pasta para fora
do servidor (Drive, S3, HD externo): backup que mora só na mesma máquina não
protege contra a perda da máquina.

---

## Antes de liberar para o cliente

Em qualquer caminho online, confirme estas três variáveis:

```
NODE_ENV=production
SESSION_SECURE=true                        # exige HTTPS no cookie de sessão
SESSION_SECRET=<texto longo e aleatório>   # nunca o valor de exemplo
```

Sem HTTPS a senha do cliente trafega aberta na rede.

---

## Resumo

| Situação | Caminho |
|---|---|
| Quero ver funcionando agora, sem gastar | **3** — Docker no seu PC |
| Quero um link para o cliente usar hoje | **1** — Railway |
| Prefiro tudo criado de uma vez por um arquivo | **2** — Render |
| O cliente exige os dados em servidor dele | **4** — VPS próprio |

Dá para começar no Railway e migrar depois: banco, sessões e dados da empresa
vêm todos de variáveis de ambiente, então mudar de hospedagem é trocar o `.env`
e restaurar o backup.
