-- Fila durável: nenhum trabalho altera estoque ou financeiro.
CREATE TABLE tarefas_documentos (
 id UUID PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
 tipo VARCHAR(30) NOT NULL,
 registro_id BIGINT NOT NULL,
 titulo TEXT NOT NULL,
 chave CHAR(64) NOT NULL,
 dados JSONB NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
   CHECK (status IN ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU')),
 tentativas SMALLINT NOT NULL DEFAULT 0,
 disponivel_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 iniciado_em TIMESTAMPTZ,
 concluido_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 token UUID,
 erro TEXT,
 arquivo BYTEA,
 nome_arquivo TEXT,
 UNIQUE(usuario_id, chave),
 CHECK (arquivo IS NULL OR octet_length(arquivo) <= 10485760),
 CHECK (status <> 'CONCLUIDO' OR arquivo IS NOT NULL)
);
CREATE INDEX tarefas_documentos_fila_idx ON tarefas_documentos(disponivel_em,criado_em)
 WHERE status IN ('PENDENTE','PROCESSANDO');
CREATE INDEX tarefas_documentos_usuario_idx ON tarefas_documentos(usuario_id,criado_em DESC);
ALTER TABLE tarefas_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tarefas_documentos FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON tarefas_documentos FROM anon, authenticated;
 END IF;
END $$;
-- Comprovantes passam a sobreviver a reinicializações sem disco local.
ALTER TABLE anexos ADD COLUMN conteudo BYTEA;
ALTER TABLE anexos ADD CONSTRAINT anexo_conteudo_limite CHECK
 (conteudo IS NULL OR octet_length(conteudo) <= 20971520);
