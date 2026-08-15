-- =====================================================================
-- ERP SHKT - Migration 001
-- Nucleo do sistema: seguranca, auditoria, numeracao documental e anexos
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis de acesso (RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE perfis (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo        TEXT NOT NULL UNIQUE,
    nome          TEXT NOT NULL,
    descricao     TEXT,
    sistema       BOOLEAN NOT NULL DEFAULT FALSE, -- perfis de sistema nao podem ser excluidos
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissoes no formato "modulo.acao" (ex.: 'fumigacao.aprovar')
CREATE TABLE perfil_permissoes (
    perfil_id  BIGINT NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
    permissao  TEXT NOT NULL,
    PRIMARY KEY (perfil_id, permissao)
);

-- ---------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    senha_hash     TEXT NOT NULL,
    perfil_id      BIGINT NOT NULL REFERENCES perfis(id),
    telefone       TEXT,
    ativo          BOOLEAN NOT NULL DEFAULT TRUE,
    trocar_senha   BOOLEAN NOT NULL DEFAULT FALSE,
    ultimo_acesso  TIMESTAMPTZ,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por     BIGINT REFERENCES usuarios(id),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_usuarios_email ON usuarios (lower(email));
CREATE INDEX idx_usuarios_perfil ON usuarios (perfil_id);

-- ---------------------------------------------------------------------
-- Sessoes (connect-pg-simple)
-- ---------------------------------------------------------------------
CREATE TABLE sessoes (
    sid    TEXT NOT NULL COLLATE "default" PRIMARY KEY,
    sess   JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessoes_expire ON sessoes (expire);

-- ---------------------------------------------------------------------
-- Auditoria - registro imutavel de acoes criticas
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data_hora       TIMESTAMPTZ NOT NULL DEFAULT now(),
    usuario_id      BIGINT REFERENCES usuarios(id),
    usuario_nome    TEXT,
    acao            TEXT NOT NULL,   -- CRIAR, ALTERAR, APROVAR, VALIDAR, CANCELAR, ESTORNAR, PAGAR, RECEBER, FECHAR, LOGIN...
    modulo          TEXT NOT NULL,
    registro_tipo   TEXT,
    registro_id     BIGINT,
    registro_numero TEXT,
    descricao       TEXT,
    valor_anterior  JSONB,
    valor_posterior JSONB,
    ip              TEXT,
    sessao          TEXT
);
CREATE INDEX idx_auditoria_data ON auditoria (data_hora DESC);
CREATE INDEX idx_auditoria_registro ON auditoria (registro_tipo, registro_id);
CREATE INDEX idx_auditoria_usuario ON auditoria (usuario_id);
CREATE INDEX idx_auditoria_modulo ON auditoria (modulo);

-- Auditoria nao pode ser alterada nem excluida
CREATE OR REPLACE FUNCTION fn_auditoria_imutavel() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Registros de auditoria nao podem ser alterados ou excluidos.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_imutavel
    BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_imutavel();

-- ---------------------------------------------------------------------
-- Numeracao documental sequencial anual: 0001-2026, 0002-2026...
-- ---------------------------------------------------------------------
CREATE TABLE documento_sequencias (
    tipo           TEXT NOT NULL,
    ano            INTEGER NOT NULL,
    ultimo_numero  INTEGER NOT NULL DEFAULT 0,
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tipo, ano)
);

-- Gera o proximo numero de forma transacional e livre de concorrencia.
-- O INSERT ... ON CONFLICT DO UPDATE bloqueia a linha ate o fim da transacao,
-- garantindo que dois usuarios simultaneos nunca recebam o mesmo numero.
CREATE OR REPLACE FUNCTION fn_proximo_numero(p_tipo TEXT, p_ano INTEGER)
RETURNS TEXT AS $$
DECLARE
    v_numero INTEGER;
BEGIN
    INSERT INTO documento_sequencias (tipo, ano, ultimo_numero)
         VALUES (p_tipo, p_ano, 1)
    ON CONFLICT (tipo, ano) DO UPDATE
            SET ultimo_numero = documento_sequencias.ultimo_numero + 1,
                atualizado_em = now()
      RETURNING ultimo_numero INTO v_numero;

    RETURN lpad(v_numero::TEXT, 4, '0') || '-' || p_ano::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Anexos genericos (documentos digitalizados, comprovantes, certificados)
-- ---------------------------------------------------------------------
CREATE TABLE anexos (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entidade_tipo TEXT NOT NULL,
    entidade_id   BIGINT NOT NULL,
    nome_original TEXT NOT NULL,
    caminho       TEXT NOT NULL,
    mime          TEXT,
    tamanho       BIGINT,
    descricao     TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por    BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_anexos_entidade ON anexos (entidade_tipo, entidade_id);

-- ---------------------------------------------------------------------
-- Parametros gerais do sistema (dados da empresa, regras configuraveis)
-- ---------------------------------------------------------------------
CREATE TABLE parametros (
    chave         TEXT PRIMARY KEY,
    valor         TEXT,
    descricao     TEXT,
    grupo         TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Gatilho generico de atualizado_em
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_atualizado_em() RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_perfis_atualizado BEFORE UPDATE ON perfis
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_usuarios_atualizado BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
