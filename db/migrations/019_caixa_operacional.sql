-- =====================================================================
-- ERP SHKT - Migration 019
-- Caixa operacional: abertura automatica/manual, conferencia e fechamento.
-- A baixa financeira continua sendo a fonte do dinheiro; o movimento recebe
-- o caixa aberto na mesma transacao, sem digitacao ou contabilizacao dupla.
-- =====================================================================

ALTER TABLE formas_pagamento
  ADD COLUMN grupo_caixa TEXT NOT NULL DEFAULT 'OUTRO'
    CHECK (grupo_caixa IN (
      'DINHEIRO','CARTAO_CREDITO','CARTAO_DEBITO','PIX_QR',
      'CHEQUE','TRANSFERENCIA','BOLETO','OUTRO'
    )),
  ADD COLUMN ordem_caixa INTEGER NOT NULL DEFAULT 90;

UPDATE formas_pagamento SET grupo_caixa='DINHEIRO', ordem_caixa=10 WHERE codigo='DINHEIRO';
UPDATE formas_pagamento SET grupo_caixa='PIX_QR', ordem_caixa=40 WHERE codigo='PIX';
UPDATE formas_pagamento SET grupo_caixa='TRANSFERENCIA', ordem_caixa=50 WHERE codigo='TED';
UPDATE formas_pagamento SET grupo_caixa='BOLETO', ordem_caixa=60 WHERE codigo='BOLETO';
UPDATE formas_pagamento SET grupo_caixa='CARTAO_CREDITO', ordem_caixa=20 WHERE codigo='CARTAO';
UPDATE formas_pagamento SET grupo_caixa='CHEQUE', ordem_caixa=70 WHERE codigo='CHEQUE';

INSERT INTO formas_pagamento (codigo,nome,grupo_caixa,ordem_caixa) VALUES
  ('CARTAO_CREDITO','Cartao de credito','CARTAO_CREDITO',20),
  ('CARTAO_DEBITO','Cartao de debito','CARTAO_DEBITO',30),
  ('QR_CODE','QR Code','PIX_QR',41)
ON CONFLICT (codigo) DO UPDATE SET
  grupo_caixa=EXCLUDED.grupo_caixa,
  ordem_caixa=EXCLUDED.ordem_caixa;

CREATE TABLE caixas (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero                TEXT NOT NULL UNIQUE,
  conta_bancaria_id     BIGINT NOT NULL REFERENCES contas_bancarias(id),
  operacao_id           BIGINT REFERENCES operacoes(id),
  status                TEXT NOT NULL DEFAULT 'ABERTO'
                        CHECK (status IN ('ABERTO','FECHADO')),
  saldo_inicial         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (saldo_inicial >= 0),
  abertura_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  abertura_por          BIGINT NOT NULL REFERENCES usuarios(id),
  abertura_automatica   BOOLEAN NOT NULL DEFAULT FALSE,
  observacoes_abertura  TEXT,
  fechamento_em         TIMESTAMPTZ,
  fechamento_por        BIGINT REFERENCES usuarios(id),
  total_sistema         NUMERIC(18,4),
  total_informado       NUMERIC(18,4),
  diferenca             NUMERIC(18,4),
  observacoes_fechamento TEXT,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_caixa_fechamento CHECK (
    (status='ABERTO' AND fechamento_em IS NULL AND fechamento_por IS NULL) OR
    (status='FECHADO' AND fechamento_em IS NOT NULL AND fechamento_por IS NOT NULL
      AND total_sistema IS NOT NULL AND total_informado IS NOT NULL AND diferenca IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_caixa_aberto_conta
  ON caixas(conta_bancaria_id) WHERE status='ABERTO';
CREATE INDEX idx_caixas_historico ON caixas(abertura_em DESC, id DESC);
CREATE INDEX idx_caixas_operacao ON caixas(operacao_id, abertura_em DESC);
CREATE INDEX idx_caixas_abertura_por ON caixas(abertura_por);
CREATE INDEX idx_caixas_fechamento_por ON caixas(fechamento_por) WHERE fechamento_por IS NOT NULL;

ALTER TABLE caixa_movimentos
  ADD COLUMN caixa_id BIGINT REFERENCES caixas(id),
  ADD COLUMN forma_pagamento_id BIGINT REFERENCES formas_pagamento(id),
  ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id),
  ADD COLUMN estorno_de_id BIGINT REFERENCES caixa_movimentos(id);

CREATE INDEX idx_caixamov_caixa_criado
  ON caixa_movimentos(caixa_id, criado_em DESC, id DESC) WHERE caixa_id IS NOT NULL;
CREATE INDEX idx_caixamov_forma ON caixa_movimentos(forma_pagamento_id)
  WHERE forma_pagamento_id IS NOT NULL;
CREATE INDEX idx_caixamov_operacao ON caixa_movimentos(operacao_id)
  WHERE operacao_id IS NOT NULL;
CREATE INDEX idx_caixamov_estorno_de ON caixa_movimentos(estorno_de_id)
  WHERE estorno_de_id IS NOT NULL;

CREATE TABLE caixa_conferencias (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caixa_id              BIGINT NOT NULL REFERENCES caixas(id),
  forma_pagamento_id    BIGINT NOT NULL REFERENCES formas_pagamento(id),
  valor_sistema         NUMERIC(18,4) NOT NULL,
  valor_informado       NUMERIC(18,4) NOT NULL CHECK (valor_informado >= 0),
  diferenca             NUMERIC(18,4) GENERATED ALWAYS AS
                        (round(valor_informado-valor_sistema,4)) STORED,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por            BIGINT NOT NULL REFERENCES usuarios(id),
  UNIQUE(caixa_id,forma_pagamento_id)
);
CREATE INDEX idx_caixaconf_forma ON caixa_conferencias(forma_pagamento_id);
CREATE INDEX idx_caixaconf_criado_por ON caixa_conferencias(criado_por);

CREATE TRIGGER trg_caixas_atualizado BEFORE UPDATE ON caixas
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

ALTER TABLE caixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_conferencias ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON caixas,caixa_conferencias FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON caixas,caixa_conferencias FROM authenticated;
  END IF;
END $$;

INSERT INTO perfil_permissoes(perfil_id,permissao)
SELECT p.id,x.permissao
  FROM perfis p
  CROSS JOIN LATERAL unnest(CASE p.codigo
    WHEN 'ADMIN' THEN ARRAY['caixa.visualizar','caixa.criar','caixa.liquidar','caixa.cancelar','caixa.exportar']
    WHEN 'DIRETORIA' THEN ARRAY['caixa.visualizar','caixa.criar','caixa.liquidar','caixa.cancelar','caixa.exportar']
    WHEN 'FINANCEIRO' THEN ARRAY['caixa.visualizar','caixa.criar','caixa.liquidar','caixa.cancelar','caixa.exportar']
    WHEN 'VENDAS' THEN ARRAY['caixa.visualizar','caixa.criar','caixa.liquidar']
    ELSE ARRAY[]::TEXT[]
  END) x(permissao)
 WHERE p.codigo IN ('ADMIN','DIRETORIA','FINANCEIRO','VENDAS')
ON CONFLICT DO NOTHING;
