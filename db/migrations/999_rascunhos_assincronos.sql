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
