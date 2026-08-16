-- =====================================================================
-- ERP SHKT - Migration 010
-- OPERAÇÕES: separar o que é do grão e o que é da transportadora
--
-- O grupo SHKT tem duas operações que compartilham cadastros (os mesmos
-- clientes, os mesmos veículos, o mesmo caixa), mas que precisam ser lidas
-- separadas:
--
--   SHKT            - compra, armazena, fumiga e exporta grão
--   SHKT TRANSPORTES - presta frete, próprio e para terceiros
--
-- Sem esta separação a pergunta que o dono faz todo dia ("quanto entrou e
-- quanto saiu de cada uma?") não tem resposta: os números vêm somados e
-- escondem qual das duas está pagando a conta da outra.
--
-- A coluna é opcional em tudo. Documento sem operação informada continua
-- válido e aparece no panorama do grupo — só não entra no recorte de uma
-- das duas.
-- =====================================================================

CREATE TABLE operacoes (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo   TEXT NOT NULL UNIQUE,
    nome     TEXT NOT NULL,
    tipo     TEXT NOT NULL DEFAULT 'GRAOS' CHECK (tipo IN ('GRAOS', 'TRANSPORTE', 'OUTRA')),
    cor      TEXT,                    -- usada no panorama, para distinguir de relance
    ativo    BOOLEAN NOT NULL DEFAULT true,
    ordem    INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_operacoes_ativo ON operacoes (ativo, ordem);

INSERT INTO operacoes (codigo, nome, tipo, cor, ordem) VALUES
    ('SHKT',        'SHKT',              'GRAOS',      '#039855', 10),
    ('SHKT-TRANSP', 'SHKT Transportes',  'TRANSPORTE', '#1570ef', 20);

-- ---------------------------------------------------------------------
-- A operação passa a marcar tudo que representa entrada ou saída
-- ---------------------------------------------------------------------
ALTER TABLE pedidos_compra ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);
ALTER TABLE pedidos_venda  ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);
ALTER TABLE recebimentos   ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);
ALTER TABLE carregamentos  ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);
ALTER TABLE contas_pagar   ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);
ALTER TABLE contas_receber ADD COLUMN operacao_id BIGINT REFERENCES operacoes(id);

CREATE INDEX idx_pc_operacao     ON pedidos_compra (operacao_id);
CREATE INDEX idx_pv_operacao     ON pedidos_venda (operacao_id);
CREATE INDEX idx_rec_operacao    ON recebimentos (operacao_id);
CREATE INDEX idx_carreg_operacao ON carregamentos (operacao_id);
CREATE INDEX idx_cp_operacao     ON contas_pagar (operacao_id);
CREATE INDEX idx_cr_operacao     ON contas_receber (operacao_id);

-- O que já existe é da operação de grão: foi como o sistema nasceu.
UPDATE pedidos_compra SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');
UPDATE pedidos_venda  SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');
UPDATE recebimentos   SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');
UPDATE carregamentos  SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');
UPDATE contas_pagar   SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');
UPDATE contas_receber SET operacao_id = (SELECT id FROM operacoes WHERE codigo = 'SHKT');

-- =====================================================================
-- PANORAMA - o que entra e o que sai, por operação
--
-- Duas perguntas, dois tipos de resposta:
--   MERCADORIA  quantos quilos entraram no armazém e quantos saíram
--   DINHEIRO    quanto foi recebido e quanto foi pago, de fato
--
-- "De fato" é a palavra importante: o panorama olha BAIXA, não título em
-- aberto. Título previsto é compromisso; entrada e saída de dinheiro é o
-- que passou pelo caixa. Misturar os dois é como o caixa some sem que
-- ninguém entenda por quê.
-- =====================================================================
CREATE OR REPLACE VIEW vw_panorama_mercadoria AS
    -- Entradas: recebimento confirmado
    SELECT r.operacao_id,
           r.data                                   AS data,
           'ENTRADA'::TEXT                          AS sentido,
           'RECEBIMENTO'::TEXT                      AS origem,
           r.id                                     AS documento_id,
           r.numero                                 AS documento_numero,
           COALESCE(SUM(i.quantidade_kg), 0)::NUMERIC(18,3) AS quantidade_kg
      FROM recebimentos r
      JOIN recebimento_itens i ON i.recebimento_id = r.id
     WHERE r.status = 'CONFIRMADO'
     GROUP BY r.operacao_id, r.data, r.id, r.numero

    UNION ALL

    -- Saídas: carregamento expedido
    SELECT c.operacao_id,
           c.data,
           'SAIDA'::TEXT,
           'CARREGAMENTO'::TEXT,
           c.id,
           c.numero,
           c.quantidade_kg::NUMERIC(18,3)
      FROM carregamentos c
     WHERE c.status = 'EXPEDIDO';

CREATE OR REPLACE VIEW vw_panorama_dinheiro AS
    -- Entradas: baixas de contas a receber
    SELECT cr.operacao_id,
           b.data                       AS data,
           'ENTRADA'::TEXT              AS sentido,
           'RECEBIMENTO_TITULO'::TEXT   AS origem,
           cr.id                        AS documento_id,
           cr.numero                    AS documento_numero,
           b.valor::NUMERIC(18,4)       AS valor
      FROM financeiro_baixas b
      JOIN contas_receber cr ON cr.id = b.conta_receber_id
     WHERE b.titulo_tipo = 'CR' AND b.estornada_em IS NULL

    UNION ALL

    -- Saídas: baixas de contas a pagar
    SELECT cp.operacao_id,
           b.data,
           'SAIDA'::TEXT,
           'PAGAMENTO_TITULO'::TEXT,
           cp.id,
           cp.numero,
           b.valor::NUMERIC(18,4)
      FROM financeiro_baixas b
      JOIN contas_pagar cp ON cp.id = b.conta_pagar_id
     WHERE b.titulo_tipo = 'CP' AND b.estornada_em IS NULL;

-- Compromissos ainda em aberto, por operação: o que já está prometido mas
-- ainda não passou pelo caixa. Fica separado de propósito.
CREATE OR REPLACE VIEW vw_panorama_aberto AS
    SELECT operacao_id,
           'A_PAGAR'::TEXT AS sentido,
           COALESCE(SUM(valor - valor_pago), 0)::NUMERIC(18,4) AS valor,
           COALESCE(SUM(valor - valor_pago) FILTER (WHERE vencimento < CURRENT_DATE), 0)::NUMERIC(18,4) AS vencido,
           COUNT(*)::INT AS titulos
      FROM contas_pagar
     WHERE status IN ('ABERTO', 'PARCIAL')
     GROUP BY operacao_id

    UNION ALL

    SELECT operacao_id,
           'A_RECEBER'::TEXT,
           COALESCE(SUM(valor - valor_recebido), 0)::NUMERIC(18,4),
           COALESCE(SUM(valor - valor_recebido) FILTER (WHERE vencimento < CURRENT_DATE), 0)::NUMERIC(18,4),
           COUNT(*)::INT
      FROM contas_receber
     WHERE status IN ('ABERTO', 'PARCIAL')
     GROUP BY operacao_id;
