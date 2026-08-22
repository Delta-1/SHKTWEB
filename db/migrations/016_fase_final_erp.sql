-- =====================================================================
-- ERP SHKT - Migration 016
-- Fechamento do Prompt Mestre: cambio, RH/folha, obrigacoes, acerto de
-- viagem, anexos rastreaveis e importacoes com pre-validacao.
-- =====================================================================

-- Valores gerenciais sempre em BRL, sem misturar moedas na DRE.
CREATE TABLE cotacoes_moeda (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moeda_id        BIGINT NOT NULL REFERENCES moedas(id),
    data            DATE NOT NULL,
    taxa_para_brl   NUMERIC(18,8) NOT NULL CHECK (taxa_para_brl > 0),
    fonte           TEXT,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por      BIGINT REFERENCES usuarios(id),
    UNIQUE (moeda_id, data)
);

ALTER TABLE contas_pagar
  ADD COLUMN taxa_cambio NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (taxa_cambio > 0),
  ADD COLUMN valor_base_brl NUMERIC(18,4) GENERATED ALWAYS AS
    (round(valor * taxa_cambio, 4)) STORED;
ALTER TABLE contas_receber
  ADD COLUMN taxa_cambio NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (taxa_cambio > 0),
  ADD COLUMN valor_base_brl NUMERIC(18,4) GENERATED ALWAYS AS
    (round(valor * taxa_cambio, 4)) STORED;

DROP VIEW vw_titulos;
CREATE VIEW vw_titulos AS
SELECT 'CP'::TEXT AS tipo,
       cp.id, cp.numero, cp.descricao, cp.origem, cp.origem_tipo, cp.origem_id, cp.origem_numero,
       cp.parceiro_id, cp.emissao, cp.vencimento, cp.valor, cp.moeda_id, cp.taxa_cambio,
       cp.valor_base_brl,
       cp.valor_pago AS valor_liquidado,
       cp.valor - cp.valor_pago AS saldo,
       round(cp.valor_pago * cp.taxa_cambio, 4) AS valor_liquidado_brl,
       round((cp.valor - cp.valor_pago) * cp.taxa_cambio, 4) AS saldo_brl,
       cp.status, cp.categoria_id, cp.centro_custo_id, cp.operacao_id
  FROM contas_pagar cp WHERE cp.status <> 'CANCELADO'
UNION ALL
SELECT 'CR'::TEXT AS tipo,
       cr.id, cr.numero, cr.descricao, cr.origem, cr.origem_tipo, cr.origem_id, cr.origem_numero,
       cr.parceiro_id, cr.emissao, cr.vencimento, cr.valor, cr.moeda_id, cr.taxa_cambio,
       cr.valor_base_brl,
       cr.valor_recebido AS valor_liquidado,
       cr.valor - cr.valor_recebido AS saldo,
       round(cr.valor_recebido * cr.taxa_cambio, 4) AS valor_liquidado_brl,
       round((cr.valor - cr.valor_recebido) * cr.taxa_cambio, 4) AS saldo_brl,
       cr.status, cr.categoria_id, cr.centro_custo_id, cr.operacao_id
  FROM contas_receber cr WHERE cr.status <> 'CANCELADO';

-- RH e folha por competencia. O fechamento cria um titulo por funcionario.
CREATE TABLE folhas_competencia (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    competencia           DATE NOT NULL,
    vencimento            DATE NOT NULL,
    operacao_id           BIGINT NOT NULL REFERENCES operacoes(id),
    moeda_id              BIGINT NOT NULL REFERENCES moedas(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO'
                          CHECK (status IN ('RASCUNHO','FECHADA','CANCELADA')),
    fechada_em            TIMESTAMPTZ,
    fechada_por           BIGINT REFERENCES usuarios(id),
    cancelada_em          TIMESTAMPTZ,
    cancelada_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id),
    UNIQUE (competencia, operacao_id)
);

CREATE TABLE folha_funcionarios (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folha_id              BIGINT NOT NULL REFERENCES folhas_competencia(id),
    funcionario_id        BIGINT NOT NULL REFERENCES funcionarios(id),
    salario_base          NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (salario_base >= 0),
    horas_extras          NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (horas_extras >= 0),
    adicionais            NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (adicionais >= 0),
    comissoes             NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (comissoes >= 0),
    outros_proventos      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (outros_proventos >= 0),
    adiantamentos         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (adiantamentos >= 0),
    inss                  NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (inss >= 0),
    outros_descontos      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (outros_descontos >= 0),
    total_proventos       NUMERIC(18,4) GENERATED ALWAYS AS
                          (salario_base + horas_extras + adicionais + comissoes + outros_proventos) STORED,
    total_descontos       NUMERIC(18,4) GENERATED ALWAYS AS
                          (adiantamentos + inss + outros_descontos) STORED,
    valor_liquido         NUMERIC(18,4) GENERATED ALWAYS AS
                          (salario_base + horas_extras + adicionais + comissoes + outros_proventos
                           - adiantamentos - inss - outros_descontos) STORED,
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    observacoes           TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    UNIQUE (folha_id, funcionario_id),
    CONSTRAINT ck_folha_liquido CHECK (
      salario_base + horas_extras + adicionais + comissoes + outros_proventos
      - adiantamentos - inss - outros_descontos >= 0)
);

CREATE TABLE provisoes_rh (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    competencia           DATE NOT NULL,
    funcionario_id        BIGINT NOT NULL REFERENCES funcionarios(id),
    tipo                  TEXT NOT NULL CHECK (tipo IN ('DECIMO_TERCEIRO','FERIAS','ENCARGOS','RESCISAO','OUTRO')),
    valor                 NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    observacoes           TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    UNIQUE (competencia, funcionario_id, tipo)
);

-- Obrigacoes fiscais, operacionais, de exportacao e trabalhistas.
CREATE TABLE tipos_obrigacao (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo          TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    natureza        TEXT NOT NULL CHECK (natureza IN ('FISCAL','OPERACIONAL','EXPORTACAO','TRABALHISTA','OUTRA')),
    periodicidade   TEXT NOT NULL DEFAULT 'EVENTUAL'
                    CHECK (periodicidade IN ('MENSAL','TRIMESTRAL','ANUAL','EVENTUAL')),
    categoria_id    BIGINT REFERENCES categorias_financeiras(id),
    ativo           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE obrigacoes (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    tipo_id               BIGINT NOT NULL REFERENCES tipos_obrigacao(id),
    operacao_id           BIGINT NOT NULL REFERENCES operacoes(id),
    competencia           DATE NOT NULL,
    vencimento            DATE NOT NULL,
    descricao             TEXT NOT NULL,
    documento             TEXT,
    parcela               INTEGER NOT NULL DEFAULT 1 CHECK (parcela > 0),
    total_parcelas        INTEGER NOT NULL DEFAULT 1 CHECK (total_parcelas >= parcela),
    valor                 NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    moeda_id              BIGINT NOT NULL REFERENCES moedas(id),
    taxa_cambio           NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (taxa_cambio > 0),
    centro_custo_id       BIGINT REFERENCES centros_custo(id),
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'RASCUNHO'
                          CHECK (status IN ('RASCUNHO','APROVADA','CANCELADA')),
    aprovada_em           TIMESTAMPTZ,
    aprovada_por          BIGINT REFERENCES usuarios(id),
    cancelada_em          TIMESTAMPTZ,
    cancelada_por         BIGINT REFERENCES usuarios(id),
    motivo_cancelamento   TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id),
    atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por        BIGINT REFERENCES usuarios(id)
);

-- Prestacao de contas: adiantamento e custo ficam separados no resultado.
CREATE TABLE viagem_acertos (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero                TEXT NOT NULL UNIQUE,
    viagem_id             BIGINT NOT NULL UNIQUE REFERENCES viagens(id),
    total_adiantado       NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (total_adiantado >= 0),
    total_despesas        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (total_despesas >= 0),
    saldo_devolver        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (saldo_devolver >= 0),
    saldo_reembolsar      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (saldo_reembolsar >= 0),
    conta_pagar_id        BIGINT UNIQUE REFERENCES contas_pagar(id),
    conta_receber_id      BIGINT UNIQUE REFERENCES contas_receber(id),
    observacoes           TEXT,
    status                TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','FECHADO','CANCELADO')),
    fechado_em            TIMESTAMPTZ,
    fechado_por           BIGINT REFERENCES usuarios(id),
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por            BIGINT REFERENCES usuarios(id)
);

-- Importacao em duas etapas: arquivo/linhas persistidos, depois confirmacao.
CREATE TABLE importacoes (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero            TEXT NOT NULL UNIQUE,
    entidade          TEXT NOT NULL CHECK (entidade IN ('PRODUTOS','CLIENTES','FORNECEDORES')),
    arquivo_nome      TEXT NOT NULL,
    arquivo_hash      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'PREVIA' CHECK (status IN ('PREVIA','IMPORTADA','CANCELADA')),
    total_linhas      INTEGER NOT NULL DEFAULT 0,
    linhas_validas    INTEGER NOT NULL DEFAULT 0,
    linhas_erros      INTEGER NOT NULL DEFAULT 0,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por        BIGINT REFERENCES usuarios(id),
    confirmado_em     TIMESTAMPTZ,
    confirmado_por    BIGINT REFERENCES usuarios(id),
    UNIQUE (entidade, arquivo_hash)
);
CREATE TABLE importacao_linhas (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    importacao_id     BIGINT NOT NULL REFERENCES importacoes(id),
    linha             INTEGER NOT NULL,
    dados             JSONB NOT NULL,
    valido            BOOLEAN NOT NULL,
    erros             JSONB NOT NULL DEFAULT '[]'::JSONB,
    importado_id      BIGINT,
    UNIQUE (importacao_id, linha)
);

-- Exclusao logica de anexos: o arquivo e historico continuam auditaveis.
ALTER TABLE anexos
  ADD COLUMN excluido_em TIMESTAMPTZ,
  ADD COLUMN excluido_por BIGINT REFERENCES usuarios(id),
  ADD COLUMN motivo_exclusao TEXT;

-- Novas origens financeiras geradas pelos modulos finais.
ALTER TABLE contas_pagar DROP CONSTRAINT contas_pagar_origem_check;
ALTER TABLE contas_pagar ADD CONSTRAINT contas_pagar_origem_check CHECK (origem IN (
  'MANUAL','COMPRA','FUMIGACAO','RH','MANUTENCAO','ABASTECIMENTO','VIAGEM',
  'IMPOSTO','ADMINISTRATIVO','FRETE','ACERTO_VIAGEM'));
ALTER TABLE contas_receber DROP CONSTRAINT contas_receber_origem_check;
ALTER TABLE contas_receber ADD CONSTRAINT contas_receber_origem_check CHECK (origem IN (
  'MANUAL','VENDA','FRETE','ACERTO_VIAGEM','OUTROS'));

-- Adiantamento e antecipacao de caixa, nao despesa da DRE/margem.
CREATE OR REPLACE VIEW vw_viagens_resultado AS
SELECT v.id, v.numero, v.operacao_id, v.cliente_id, v.veiculo_id, v.motorista_id,
       v.origem, v.destino, v.data_saida_prevista, v.status,
       v.valor_frete AS receita_prevista,
       COALESCE(cr.valor_recebido, 0)::NUMERIC(18,4) AS receita_recebida,
       COALESCE(a.total, 0)::NUMERIC(18,4) AS combustivel,
       COALESCE(d.total, 0)::NUMERIC(18,4) AS outras_despesas,
       COALESCE(m.total, 0)::NUMERIC(18,4) AS manutencao,
       (COALESCE(a.total, 0) + COALESCE(d.total, 0) + COALESCE(m.total, 0))::NUMERIC(18,4) AS custo_direto,
       (v.valor_frete - COALESCE(a.total, 0) - COALESCE(d.total, 0) - COALESCE(m.total, 0))::NUMERIC(18,4) AS margem_prevista,
       CASE WHEN v.km_final IS NOT NULL AND v.km_inicial IS NOT NULL THEN v.km_final-v.km_inicial END AS distancia_km,
       COALESCE(a.litros, 0)::NUMERIC(18,3) AS litros,
       CASE WHEN COALESCE(a.litros,0)>0 AND v.km_final IS NOT NULL AND v.km_inicial IS NOT NULL
            THEN round((v.km_final-v.km_inicial)/a.litros,2) END AS km_litro
  FROM viagens v
  LEFT JOIN contas_receber cr ON cr.id=v.conta_receber_id
  LEFT JOIN LATERAL (SELECT SUM(valor_total) total, SUM(quantidade_litros) litros
                       FROM abastecimentos x WHERE x.viagem_id=v.id AND x.status='CONFIRMADO') a ON TRUE
  LEFT JOIN LATERAL (SELECT SUM(valor) total FROM viagem_despesas x
                      WHERE x.viagem_id=v.id AND x.status='CONFIRMADA' AND x.tipo<>'ADIANTAMENTO') d ON TRUE
  LEFT JOIN LATERAL (SELECT SUM(valor_total) total FROM ordens_manutencao x
                      WHERE x.viagem_id=v.id AND x.status IN ('APROVADA','EM_EXECUCAO','CONCLUIDA')) m ON TRUE;

CREATE INDEX idx_folhas_competencia ON folhas_competencia (competencia DESC, status);
CREATE INDEX idx_folha_funcionario ON folha_funcionarios (funcionario_id, folha_id);
CREATE INDEX idx_obrigacoes_vencimento ON obrigacoes (vencimento, status);
CREATE INDEX idx_importacao_linhas ON importacao_linhas (importacao_id, valido);
CREATE INDEX idx_cotacoes_data ON cotacoes_moeda (data DESC, moeda_id);

CREATE TRIGGER trg_folhas_atualizado BEFORE UPDATE ON folhas_competencia
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_obrigacoes_atualizado BEFORE UPDATE ON obrigacoes
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

INSERT INTO categorias_financeiras (codigo,nome,tipo,grupo_dre,ordem_dre) VALUES
 ('SALARIOS','Salarios e folha','DESPESA','SALARIOS',60),
 ('IMPOSTOS','Impostos e obrigacoes','DESPESA','IMPOSTOS',100),
 ('ACERTO_VIAGEM','Acerto e reembolso de viagem','DESPESA','VEICULOS',90),
 ('RECUPERACAO_DESPESA','Recuperacao de despesas','RECEITA','OUTRAS',120)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO tipos_obrigacao (codigo,nome,natureza,periodicidade,categoria_id)
SELECT x.codigo,x.nome,x.natureza,x.periodicidade,c.id
  FROM (VALUES
    ('IMPOSTO','Imposto / taxa','FISCAL','EVENTUAL'),
    ('LICENCA','Licenca operacional','OPERACIONAL','ANUAL'),
    ('EXPORTACAO','Documento de exportacao','EXPORTACAO','EVENTUAL'),
    ('ENCARGO_RH','Encargo trabalhista','TRABALHISTA','MENSAL'))
    x(codigo,nome,natureza,periodicidade)
  JOIN categorias_financeiras c ON c.codigo='IMPOSTOS'
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO perfis (codigo,nome,descricao,sistema) VALUES
 ('COMPRAS','Compras','Pedidos, recebimentos e fornecedores.',FALSE),
 ('VENDAS','Vendas','Clientes, pedidos, carregamentos e recebimentos.',FALSE),
 ('RH','Recursos Humanos','Funcionarios, folha, provisoes e relatorios de RH.',FALSE)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO perfil_permissoes (perfil_id, permissao)
SELECT p.id, x.permissao FROM perfis p CROSS JOIN LATERAL unnest(CASE p.codigo
 WHEN 'ADMIN' THEN ARRAY['rh.visualizar','rh.criar','rh.editar','rh.aprovar','rh.cancelar','rh.exportar','impostos.visualizar','impostos.criar','impostos.editar','impostos.aprovar','impostos.cancelar','impostos.exportar','importacoes.visualizar','importacoes.criar','importacoes.aprovar']
 WHEN 'DIRETORIA' THEN ARRAY['rh.visualizar','rh.criar','rh.editar','rh.aprovar','rh.cancelar','rh.exportar','impostos.visualizar','impostos.criar','impostos.editar','impostos.aprovar','impostos.cancelar','impostos.exportar','importacoes.visualizar','importacoes.criar','importacoes.aprovar']
 WHEN 'FINANCEIRO' THEN ARRAY['rh.visualizar','impostos.visualizar','impostos.criar','impostos.editar','impostos.aprovar','impostos.exportar']
 WHEN 'COMPRAS' THEN ARRAY['dashboard.visualizar','cadastros.visualizar','cadastros.criar','cadastros.editar','compras.visualizar','compras.criar','compras.editar','compras.aprovar','compras.cancelar','compras.exportar','estoque.visualizar','financeiro.visualizar','relatorios.visualizar','importacoes.visualizar','importacoes.criar','importacoes.aprovar']
 WHEN 'VENDAS' THEN ARRAY['dashboard.visualizar','cadastros.visualizar','cadastros.criar','cadastros.editar','vendas.visualizar','vendas.criar','vendas.editar','vendas.aprovar','vendas.cancelar','vendas.exportar','carregamento.visualizar','carregamento.criar','carregamento.editar','financeiro.visualizar','relatorios.visualizar','importacoes.visualizar','importacoes.criar','importacoes.aprovar']
 WHEN 'RH' THEN ARRAY['dashboard.visualizar','cadastros.visualizar','cadastros.criar','cadastros.editar','rh.visualizar','rh.criar','rh.editar','rh.aprovar','rh.cancelar','rh.exportar','financeiro.visualizar','relatorios.visualizar']
 ELSE ARRAY[]::TEXT[] END) x(permissao)
WHERE p.codigo IN ('ADMIN','DIRETORIA','FINANCEIRO','COMPRAS','VENDAS','RH')
ON CONFLICT DO NOTHING;
