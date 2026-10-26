-- Login dedicado ao servidor; credencial configurada fora do repositório.
-- Não é um papel do Data API nem um usuário com privilégios administrativos.
DO $$
DECLARE t record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='shkt_backend') THEN
  CREATE ROLE shkt_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 GRANT USAGE ON SCHEMA public TO shkt_backend;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO shkt_backend;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO shkt_backend;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO shkt_backend;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename AND policyname='shkt_servidor') THEN
   EXECUTE format('CREATE POLICY shkt_servidor ON public.%I TO shkt_backend USING(true) WITH CHECK(true)',t.tablename);
  END IF;
 END LOOP;
END $$;
