-- Salvaguardas de transferência ficam fora do esquema exposto pelo Data API.
CREATE SCHEMA IF NOT EXISTS shkt_transferencia;
REVOKE ALL ON SCHEMA shkt_transferencia FROM PUBLIC;
CREATE TABLE IF NOT EXISTS shkt_transferencia.salvaguardas(
 chave text PRIMARY KEY,
 dados_origem jsonb NOT NULL,
 dados_destino jsonb NOT NULL,
 concluido boolean NOT NULL DEFAULT false,
 criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shkt_transferencia.salvaguardas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='shkt_transferencia' AND tablename='salvaguardas' AND policyname='servidor_transferencia') THEN
  CREATE POLICY servidor_transferencia ON shkt_transferencia.salvaguardas TO shkt_backend USING(true) WITH CHECK(true);
 END IF;
END $$;
GRANT USAGE ON SCHEMA shkt_transferencia TO shkt_backend;
GRANT SELECT,INSERT,UPDATE ON shkt_transferencia.salvaguardas TO shkt_backend;
