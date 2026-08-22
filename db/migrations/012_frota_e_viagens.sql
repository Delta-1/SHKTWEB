-- =====================================================================
-- ERP SHKT - Migration 012
-- SHKT TRANSPORTES: viagens, abastecimentos, despesas e manutencao
--
-- Uma viagem e a pasta que liga cliente, veiculo, motorista, receita de
-- frete e custos diretos. Confirmacoes geram o financeiro uma unica vez;
-- rascunhos nunca alteram caixa nem resultado.
-- =====================================================================

ALTER TABLE contas_receber DROP CONSTRAINT IF EXISTS contas_receber_origem_check;
ALTER TABLE contas_receber ADD CONSTRAINT contas_receber_origem_check
  CHECK (origem IN ('MANUAL','VENDA','FRETE','OUTROS'));

CREATE TABLE viagens (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    operacao_id           BIGINT NOT NULL REFERENCES operacoes(id),
    carregamento_id       BIGINT REFERENCES carregamentos(id),
    cliente_id            BIGINT REFERENCES parceiros(id),
    veiculo_id            BIGINT NOT NULL REFERENCES veiculos(id),
    motorista_id          BIGINT NOT NULL REFERENCES motoristas(id),
    origem                TEXT NOT NULL,
    destino               TEXT NOT NULL,
    data_saida_prevista   DATE NOT NULL,
    data_saida            TIMESTAMPTZ,
    data_retorno          TIMESTAMPTZ,
    km_inicial            NUMERIC(12,1) CHECK (km_inicial IS NULL OR km_inicial >= 0),
    km_final              NUMERIC(12,1) CHECK (km_final IS NULL OR km_final >= 0),
    valor_frete           NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_frete >= 0),
    moeda_id              BIGINT NOT NULL REFERENCES moedas(id),
    centro_custo_id       BIGINT REFERENCES centros_custo(id),
    condicao_pagamento    TEXT,
    vencimento_frete      DATE,
    conta_receber_id      BIGINT UNIQUE REFERENCES contas_receber(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                              'RASCUNHO','PROGRAMADA','EM_ANDAMENTO',
                              'AGUARDANDO_ACERTO','CONCLUIDA','CANCELADA')),
    programada_em         TIMESTAMPTZ,
    programada_por        BIGINT REFERENCES usuarios(id),
    concluida_em          TIMESTAMPTZ,
    concluida_por         BIGINT REFERENCES usuarios(id),
    cancelada_em          TIMESTAMPTZ,
    cancelada_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id),
    CONSTRAINT ck_viagem_quilometragem CHECK (
      km_final IS NULL OR km_inicial IS NULL OR km_final >= km_inicial
    ),
    CONSTRAINT ck_viagem_cancelamento CHECK (
      status <> 'CANCELADA' OR
      (cancelada_em IS NOT NULL AND btrim(COALESCE(motivo_cancelamento, '')) <> '')
    )
);
CREATE INDEX idx_viagens_status_data ON viagens (status, data_saida_prevista DESC);
CREATE INDEX idx_viagens_operacao ON viagens (operacao_id, data_saida_prevista DESC);
CREATE INDEX idx_viagens_veiculo ON viagens (veiculo_id, data_saida_prevista DESC);
CREATE INDEX idx_viagens_motorista ON viagens (motorista_id, data_saida_prevista DESC);

CREATE TABLE abastecimentos (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    viagem_id             BIGINT REFERENCES viagens(id),
    operacao_id           BIGINT NOT NULL REFERENCES operacoes(id),
    data                  DATE NOT NULL DEFAULT CURRENT_DATE,
    veiculo_id            BIGINT NOT NULL REFERENCES veiculos(id),
    motorista_id          BIGINT REFERENCES motoristas(id),
    combustivel_id        BIGINT NOT NULL REFERENCES tipos_combustivel(id),
    fornecedor_id         BIGINT REFERENCES parceiros(id),
    quantidade_litros     NUMERIC(18,3) NOT NULL CHECK (quantidade_litros > 0),
    preco_litro           NUMERIC(18,4) NOT NULL CHECK (preco_litro > 0),
    valor_total           NUMERIC(18,4) GENERATED ALWAYS AS
                          (round(quantidade_litros * preco_litro, 4)) STORED,
    quilometragem         NUMERIC(12,1) CHECK (quilometragem IS NULL OR quilometragem >= 0),
    centro_custo_id       BIGINT REFERENCES centros_custo(id),
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO'
                          CHECK (status IN ('RASCUNHO','CONFIRMADO','CANCELADO')),
    confirmado_em         TIMESTAMPTZ,
    confirmado_por        BIGINT REFERENCES usuarios(id),
    cancelado_em          TIMESTAMPTZ,
    cancelado_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id),
    CONSTRAINT ck_abastecimento_confirmacao CHECK (
      status <> 'CONFIRMADO' OR (confirmado_em IS NOT NULL AND confirmado_por IS NOT NULL)
    )
);
CREATE INDEX idx_abastecimentos_viagem ON abastecimentos (viagem_id, data DESC);
CREATE INDEX idx_abastecimentos_veiculo ON abastecimentos (veiculo_id, data DESC);

CREATE TABLE viagem_despesas (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    viagem_id             BIGINT NOT NULL REFERENCES viagens(id),
    data                  DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo                  TEXT NOT NULL CHECK (tipo IN (
                              'ADIANTAMENTO','ALIMENTACAO','PEDAGIO','HOSPEDAGEM',
                              'MANUTENCAO_EMERGENCIAL','DOCUMENTACAO','OUTRO')),
    descricao             TEXT NOT NULL,
    parceiro_id           BIGINT REFERENCES parceiros(id),
    categoria_id          BIGINT REFERENCES categorias_financeiras(id),
    centro_custo_id       BIGINT REFERENCES centros_custo(id),
    valor                 NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    moeda_id              BIGINT NOT NULL REFERENCES moedas(id),
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO'
                          CHECK (status IN ('RASCUNHO','CONFIRMADA','CANCELADA')),
    confirmada_em         TIMESTAMPTZ,
    confirmada_por        BIGINT REFERENCES usuarios(id),
    cancelada_em          TIMESTAMPTZ,
    cancelada_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_viagem_despesas_viagem ON viagem_despesas (viagem_id, data DESC);

CREATE TABLE ordens_manutencao (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    operacao_id           BIGINT NOT NULL REFERENCES operacoes(id),
    viagem_id             BIGINT REFERENCES viagens(id),
    veiculo_id            BIGINT NOT NULL REFERENCES veiculos(id),
    oficina_id            BIGINT REFERENCES parceiros(id),
    data                  DATE NOT NULL DEFAULT CURRENT_DATE,
    quilometragem         NUMERIC(12,1) CHECK (quilometragem IS NULL OR quilometragem >= 0),
    tipo                  TEXT NOT NULL CHECK (tipo IN
                            ('PREVENTIVA','CORRETIVA','EMERGENCIAL','REVISAO','OUTRA')),
    descricao             TEXT NOT NULL,
    valor_pecas           NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_pecas >= 0),
    valor_servicos        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_servicos >= 0),
    valor_mao_obra        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_mao_obra >= 0),
    valor_total           NUMERIC(18,4) GENERATED ALWAYS AS
                          (round(valor_pecas + valor_servicos + valor_mao_obra, 4)) STORED,
    previsao_conclusao    DATE,
    conclusao             DATE,
    categoria_id          BIGINT REFERENCES categorias_financeiras(id),
    centro_custo_id       BIGINT REFERENCES centros_custo(id),
    moeda_id              BIGINT NOT NULL REFERENCES moedas(id),
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                              'RASCUNHO','APROVADA','EM_EXECUCAO','CONCLUIDA','CANCELADA')),
    aprovada_em           TIMESTAMPTZ,
    aprovada_por          BIGINT REFERENCES usuarios(id),
    cancelada_em          TIMESTAMPTZ,
    cancelada_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id),
    CONSTRAINT ck_manutencao_valor CHECK (valor_total > 0)
);
CREATE INDEX idx_manutencao_veiculo ON ordens_manutencao (veiculo_id, data DESC);
CREATE INDEX idx_manutencao_status ON ordens_manutencao (status, data DESC);

CREATE TRIGGER trg_viagens_atualizado BEFORE UPDATE ON viagens
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_abastecimentos_atualizado BEFORE UPDATE ON abastecimentos
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_viagem_despesas_atualizado BEFORE UPDATE ON viagem_despesas
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_manutencao_atualizado BEFORE UPDATE ON ordens_manutencao
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE VIEW vw_viagens_resultado AS
SELECT v.id,
       v.numero,
       v.operacao_id,
       v.cliente_id,
       v.veiculo_id,
       v.motorista_id,
       v.origem,
       v.destino,
       v.data_saida_prevista,
       v.status,
       v.valor_frete AS receita_prevista,
       COALESCE(cr.valor_recebido, 0)::NUMERIC(18,4) AS receita_recebida,
       COALESCE(a.total, 0)::NUMERIC(18,4) AS combustivel,
       COALESCE(d.total, 0)::NUMERIC(18,4) AS outras_despesas,
       COALESCE(m.total, 0)::NUMERIC(18,4) AS manutencao,
       (COALESCE(a.total, 0) + COALESCE(d.total, 0) + COALESCE(m.total, 0))::NUMERIC(18,4)
         AS custo_direto,
       (v.valor_frete - COALESCE(a.total, 0) - COALESCE(d.total, 0) - COALESCE(m.total, 0))::NUMERIC(18,4)
         AS margem_prevista,
       CASE WHEN v.km_final IS NOT NULL AND v.km_inicial IS NOT NULL
            THEN v.km_final - v.km_inicial END AS distancia_km,
       COALESCE(a.litros, 0)::NUMERIC(18,3) AS litros,
       CASE WHEN COALESCE(a.litros, 0) > 0 AND v.km_final IS NOT NULL AND v.km_inicial IS NOT NULL
            THEN round((v.km_final - v.km_inicial) / a.litros, 2) END AS km_litro
  FROM viagens v
  LEFT JOIN contas_receber cr ON cr.id = v.conta_receber_id
  LEFT JOIN LATERAL (
    SELECT SUM(valor_total) AS total, SUM(quantidade_litros) AS litros
      FROM abastecimentos x WHERE x.viagem_id = v.id AND x.status = 'CONFIRMADO'
  ) a ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(valor) AS total FROM viagem_despesas x
     WHERE x.viagem_id = v.id AND x.status = 'CONFIRMADA'
  ) d ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(valor_total) AS total FROM ordens_manutencao x
     WHERE x.viagem_id = v.id AND x.status IN ('APROVADA','EM_EXECUCAO','CONCLUIDA')
  ) m ON TRUE;

-- Perfis que ja existiam antes deste modulo recebem apenas os acessos
-- adequados. O perfil operacional da transportadora fica pronto para uso.
INSERT INTO perfis (codigo, nome, descricao, sistema)
VALUES ('TRANSPORTES', 'Transportadora / Motorista',
        'Viagens, abastecimentos, despesas e consulta da frota.', FALSE)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permissao)
SELECT p.id, x.permissao
  FROM perfis p
  CROSS JOIN LATERAL unnest(CASE p.codigo
    WHEN 'ADMIN' THEN ARRAY['frota.visualizar','frota.criar','frota.editar','frota.aprovar','frota.cancelar','frota.exportar']
    WHEN 'DIRETORIA' THEN ARRAY['frota.visualizar','frota.criar','frota.editar','frota.aprovar','frota.cancelar','frota.exportar']
    WHEN 'FINANCEIRO' THEN ARRAY['frota.visualizar']
    WHEN 'ESTOQUE' THEN ARRAY['frota.visualizar','frota.criar','frota.editar']
    WHEN 'TRANSPORTES' THEN ARRAY['dashboard.visualizar','cadastros.visualizar','frota.visualizar','frota.criar','frota.editar','relatorios.visualizar']
    ELSE ARRAY[]::TEXT[]
  END) AS x(permissao)
 WHERE p.codigo IN ('ADMIN','DIRETORIA','FINANCEIRO','ESTOQUE','TRANSPORTES')
ON CONFLICT DO NOTHING;
