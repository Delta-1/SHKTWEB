-- =====================================================================
-- ERP SHKT - Migration 002
-- Cadastros mestres: fonte unica de informacao para todos os modulos
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas de apoio
-- ---------------------------------------------------------------------
CREATE TABLE paises (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo        TEXT NOT NULL UNIQUE,        -- ISO alpha-2: BR, PE, PY
    nome          TEXT NOT NULL,
    moeda_padrao  TEXT,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE moedas (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo   TEXT NOT NULL UNIQUE,             -- BRL, USD, PEN
    nome     TEXT NOT NULL,
    simbolo  TEXT NOT NULL,
    decimais SMALLINT NOT NULL DEFAULT 2,
    ativo    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE incoterms (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo    TEXT NOT NULL UNIQUE,            -- FOB, CIF, EXW, DAP...
    descricao TEXT NOT NULL,
    ativo     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Unidades de medida com fator de conversao para a unidade base do ERP (KG).
-- Todo o estoque e armazenado em KG; a unidade escolhida pelo usuario e apenas
-- a forma de digitar/exibir. Isso elimina divergencia entre kg, tonelada e saco.
CREATE TABLE unidades_medida (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo    TEXT NOT NULL UNIQUE,            -- KG, TON, SC60, SC50
    descricao TEXT NOT NULL,
    fator_kg  NUMERIC(18,6) NOT NULL,          -- quantos KG equivale 1 unidade
    decimais  SMALLINT NOT NULL DEFAULT 3,
    ativo     BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_unidades_fator CHECK (fator_kg > 0)
);

CREATE TABLE formas_pagamento (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nome   TEXT NOT NULL,
    ativo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE condicoes_pagamento (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo      TEXT NOT NULL UNIQUE,
    nome        TEXT NOT NULL,
    dias_prazo  INTEGER NOT NULL DEFAULT 0,    -- prazo em dias a partir da emissao
    parcelas    SMALLINT NOT NULL DEFAULT 1,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Categorias financeiras ligadas ao grupo da DRE gerencial
CREATE TABLE categorias_financeiras (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo     TEXT NOT NULL UNIQUE,
    nome       TEXT NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA')),
    grupo_dre  TEXT NOT NULL,                  -- ver docs/DRE.md
    ordem_dre  INTEGER NOT NULL DEFAULT 0,
    ativo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE centros_custo (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nome   TEXT NOT NULL,
    ativo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE tipos_combustivel (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nome   TEXT NOT NULL,
    ativo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE contas_bancarias (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo         TEXT NOT NULL UNIQUE,
    nome           TEXT NOT NULL,
    tipo           TEXT NOT NULL DEFAULT 'BANCO' CHECK (tipo IN ('BANCO','CAIXA')),
    banco          TEXT,
    agencia        TEXT,
    conta          TEXT,
    moeda_id       BIGINT NOT NULL REFERENCES moedas(id),
    saldo_inicial  NUMERIC(18,4) NOT NULL DEFAULT 0,
    data_saldo     DATE NOT NULL DEFAULT CURRENT_DATE,
    observacoes    TEXT,
    ativo          BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locais_estoque (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo    TEXT NOT NULL UNIQUE,
    nome      TEXT NOT NULL,
    endereco  TEXT,
    cidade    TEXT,
    uf        TEXT,
    pais_id   BIGINT REFERENCES paises(id),
    ativo     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Parceiros: cliente, fornecedor, transportadora, fumigadora, oficina.
-- Tabela unica com papeis marcados por flag - uma mesma empresa pode ser
-- fornecedor e transportadora sem ser cadastrada duas vezes.
-- (Regra do projeto: uma informacao e digitada apenas uma vez.)
-- ---------------------------------------------------------------------
CREATE TABLE parceiros (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo              TEXT NOT NULL UNIQUE,
    tipo_pessoa         TEXT NOT NULL DEFAULT 'PJ' CHECK (tipo_pessoa IN ('PF','PJ')),
    razao_social        TEXT NOT NULL,
    nome_fantasia       TEXT,
    documento           TEXT,                  -- CPF/CNPJ/RUC/documento estrangeiro
    tipo_documento      TEXT DEFAULT 'CNPJ' CHECK (tipo_documento IN ('CPF','CNPJ','RUC','OUTRO')),
    inscricao_estadual  TEXT,
    ruc                 TEXT,
    pais_id             BIGINT REFERENCES paises(id),
    endereco            TEXT,
    cidade              TEXT,
    estado              TEXT,                  -- estado/departamento
    cep                 TEXT,
    telefone            TEXT,
    email               TEXT,
    contato             TEXT,
    moeda_id            BIGINT REFERENCES moedas(id),
    condicao_pagto_id   BIGINT REFERENCES condicoes_pagamento(id),
    -- papeis
    is_cliente          BOOLEAN NOT NULL DEFAULT FALSE,
    is_fornecedor       BOOLEAN NOT NULL DEFAULT FALSE,
    is_transportadora   BOOLEAN NOT NULL DEFAULT FALSE,
    is_fumigadora       BOOLEAN NOT NULL DEFAULT FALSE,
    is_oficina          BOOLEAN NOT NULL DEFAULT FALSE,
    -- dados especificos
    tipo_fornecimento   TEXT,                  -- mercadoria, frete, servico...
    banco_nome          TEXT,
    banco_agencia       TEXT,
    banco_conta         TEXT,
    banco_titular       TEXT,
    banco_pix           TEXT,
    custo_tonelada      NUMERIC(18,4),         -- padrao para fumigadoras
    observacoes         TEXT,
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_parceiros_razao ON parceiros (lower(razao_social));
CREATE INDEX idx_parceiros_documento ON parceiros (documento);
CREATE INDEX idx_parceiros_cliente ON parceiros (is_cliente) WHERE is_cliente;
CREATE INDEX idx_parceiros_fornecedor ON parceiros (is_fornecedor) WHERE is_fornecedor;
CREATE INDEX idx_parceiros_fumigadora ON parceiros (is_fumigadora) WHERE is_fumigadora;
CREATE UNIQUE INDEX uq_parceiros_documento ON parceiros (documento)
    WHERE documento IS NOT NULL AND documento <> '';

-- ---------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------
CREATE TABLE produtos (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo            TEXT NOT NULL UNIQUE,
    descricao         TEXT NOT NULL,
    nome_cientifico   TEXT,
    unidade_id        BIGINT NOT NULL REFERENCES unidades_medida(id),
    categoria         TEXT,
    ncm               TEXT,
    controla_lote     BOOLEAN NOT NULL DEFAULT TRUE,
    exige_fumigacao   BOOLEAN NOT NULL DEFAULT FALSE,
    estoque_minimo_kg NUMERIC(18,3) NOT NULL DEFAULT 0,
    observacoes       TEXT,
    ativo             BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por        BIGINT REFERENCES usuarios(id),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por    BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_produtos_descricao ON produtos (lower(descricao));

-- ---------------------------------------------------------------------
-- Funcionarios
-- ---------------------------------------------------------------------
CREATE TABLE funcionarios (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    matricula       TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    cpf             TEXT,
    cargo           TEXT,
    departamento    TEXT,
    admissao        DATE,
    demissao        DATE,
    salario_base    NUMERIC(18,4) NOT NULL DEFAULT 0,
    moeda_id        BIGINT REFERENCES moedas(id),
    centro_custo_id BIGINT REFERENCES centros_custo(id),
    situacao        TEXT NOT NULL DEFAULT 'ATIVO'
                    CHECK (situacao IN ('ATIVO','FERIAS','AFASTADO','DESLIGADO')),
    telefone        TEXT,
    email           TEXT,
    endereco        TEXT,
    banco_nome      TEXT,
    banco_agencia   TEXT,
    banco_conta     TEXT,
    banco_pix       TEXT,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por      BIGINT REFERENCES usuarios(id),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por  BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_funcionarios_nome ON funcionarios (lower(nome));

-- ---------------------------------------------------------------------
-- Veiculos e motoristas (referencia circular resolvida com ALTER)
-- ---------------------------------------------------------------------
CREATE TABLE veiculos (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    placa               TEXT NOT NULL UNIQUE,
    tipo                TEXT,                  -- cavalo, carreta, truck, utilitario
    marca_modelo        TEXT,
    ano                 INTEGER,
    proprietario        TEXT,
    proprietario_id     BIGINT REFERENCES parceiros(id),
    capacidade_kg       NUMERIC(18,3),
    motorista_padrao_id BIGINT,
    situacao            TEXT NOT NULL DEFAULT 'ATIVO'
                        CHECK (situacao IN ('ATIVO','MANUTENCAO','INATIVO','VENDIDO')),
    km_atual            NUMERIC(18,2) NOT NULL DEFAULT 0,
    combustivel_id      BIGINT REFERENCES tipos_combustivel(id),
    centro_custo_id     BIGINT REFERENCES centros_custo(id),
    observacoes         TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id)
);

CREATE TABLE motoristas (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome              TEXT NOT NULL,
    documento         TEXT,
    telefone          TEXT,
    vinculo           TEXT NOT NULL DEFAULT 'TERCEIRO'
                      CHECK (vinculo IN ('FUNCIONARIO','TERCEIRO','AGREGADO')),
    funcionario_id    BIGINT REFERENCES funcionarios(id),
    transportadora_id BIGINT REFERENCES parceiros(id),
    cnh               TEXT,
    cnh_categoria     TEXT,
    cnh_validade      DATE,
    veiculo_padrao_id BIGINT REFERENCES veiculos(id),
    observacoes       TEXT,
    ativo             BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por        BIGINT REFERENCES usuarios(id),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por    BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_motoristas_nome ON motoristas (lower(nome));

ALTER TABLE veiculos
    ADD CONSTRAINT fk_veiculos_motorista
    FOREIGN KEY (motorista_padrao_id) REFERENCES motoristas(id);

-- ---------------------------------------------------------------------
-- Gatilhos de atualizado_em
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_parceiros_atualizado BEFORE UPDATE ON parceiros
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_produtos_atualizado BEFORE UPDATE ON produtos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_funcionarios_atualizado BEFORE UPDATE ON funcionarios
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_veiculos_atualizado BEFORE UPDATE ON veiculos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_motoristas_atualizado BEFORE UPDATE ON motoristas
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_contas_bancarias_atualizado BEFORE UPDATE ON contas_bancarias
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
