-- Rascunhos por usuario e formulario; nao representam documento aprovado.
CREATE TABLE IF NOT EXISTS rascunhos_formulario (
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave VARCHAR(140) NOT NULL,
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  versao BIGINT NOT NULL DEFAULT 1,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(usuario_id, chave),
  CONSTRAINT rascunho_tamanho CHECK (octet_length(dados::text) <= 120000)
);
CREATE INDEX IF NOT EXISTS rascunhos_formulario_atualizado_idx ON rascunhos_formulario(atualizado_em);
ALTER TABLE rascunhos_formulario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rascunhos_formulario FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON rascunhos_formulario FROM anon, authenticated;
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='shkt_backend') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON rascunhos_formulario TO shkt_backend;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rascunhos_formulario' AND policyname='shkt_servidor') THEN
   CREATE POLICY shkt_servidor ON rascunhos_formulario TO shkt_backend USING(true) WITH CHECK(true);
  END IF;
 END IF;
END $$;
