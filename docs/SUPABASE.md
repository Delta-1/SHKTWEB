# Supabase no ERP SHKT

O projeto Supabase hospeda o PostgreSQL. O navegador **não acessa as tabelas
diretamente**: toda regra de negócio continua no servidor Express, com
transações, permissões e auditoria centralizadas.

## Configuração da aplicação

1. No Supabase, abra **Project Settings → Database → Connection string**.
2. Para uma aplicação hospedada, prefira a conexão do **Session pooler**.
3. Configure no provedor da aplicação:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres.<project-ref>:SENHA@HOST-DO-POOLER:5432/postgres
SESSION_SECRET=UM_SEGREDO_ALEATORIO_LONGO
SESSION_SECURE=true
```

Hosts do Supabase ativam SSL automaticamente. A senha do banco e o
`SESSION_SECRET` nunca devem ser incluídos no Git.

## Primeira carga

Em um banco vazio, execute:

```bash
npm run migrate
npm run seed
```

O seed é idempotente e cria os perfis, usuário administrador inicial, moedas,
unidades, categorias, operações e cadastros mínimos. A senha inicial vem de
`ADMIN_SENHA` e precisa ser trocada no primeiro acesso.

## Segurança

A migration `013_seguranca_supabase.sql`:

- habilita RLS em todas as tabelas públicas;
- torna as views `security_invoker`;
- fixa o `search_path` das funções;
- remove acesso direto dos papéis `anon` e `authenticated`.

O usuário indicado em `DATABASE_URL` é o único caminho de escrita usado pelo
ERP. Nunca coloque essa URL em JavaScript do navegador.

## Backups e operação

- mantenha os backups automáticos do projeto Supabase ativos;
- antes de publicar uma migration, faça backup e teste em homologação;
- acompanhe os Security e Performance Advisors após cada mudança estrutural;
- anexos continuam no diretório configurado por `UPLOAD_DIR`; para múltiplas
  instâncias, migre-os para armazenamento persistente antes de escalar.

## Servidor com credencial dedicada

A atualização de 26/10/2026 acrescenta `shkt_backend`, sem privilégios de
administração e sem bypass de RLS. As políticas desse papel são exclusivas
do servidor Express; os papéis da Data API continuam sem acesso.
`SHKT_SUPABASE_URL` permite apontar a aplicação para essa credencial mantendo
a configuração de origem para recuperação. Consulte
[fluxo assíncrono](ATUALIZACAO_2026-10-26.md) antes de novas migrações.
