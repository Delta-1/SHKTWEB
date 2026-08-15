/**
 * Erros de negocio.
 *
 * ErroNegocio representa uma violacao de regra que o usuario pode entender e
 * corrigir ("Saldo fumigado insuficiente"). Ele vira mensagem amigavel na tela,
 * com status HTTP 422 - nunca um stack trace.
 */
export class ErroNegocio extends Error {
  constructor(mensagem, { status = 422, campo = null, detalhes = null } = {}) {
    super(mensagem);
    this.name = 'ErroNegocio';
    this.status = status;
    this.campo = campo;
    this.detalhes = detalhes;
    this.negocio = true;
  }
}

export class ErroPermissao extends ErroNegocio {
  constructor(mensagem = 'Você não tem permissão para executar esta ação.') {
    super(mensagem, { status: 403 });
    this.name = 'ErroPermissao';
  }
}

export class ErroNaoEncontrado extends ErroNegocio {
  constructor(mensagem = 'Registro não encontrado.') {
    super(mensagem, { status: 404 });
    this.name = 'ErroNaoEncontrado';
  }
}

export class ErroValidacao extends ErroNegocio {
  constructor(mensagem, campo = null) {
    super(mensagem, { status: 422, campo });
    this.name = 'ErroValidacao';
  }
}

/**
 * Traduz erros do PostgreSQL em mensagens de negocio.
 * As funcoes PL/pgSQL do ERP (fn_estoque_movimentar, fn_fumigacao_consumir)
 * ja lancam mensagens prontas para o usuario final.
 */
export function traduzirErroBanco(erro) {
  if (!erro || !erro.code) return erro;

  // Mensagens vindas das nossas funcoes de negocio (RAISE ... check_violation)
  if (erro.code === '23514' && erro.message && !erro.constraint) {
    return new ErroNegocio(erro.message);
  }

  switch (erro.code) {
    case '23505': { // unique_violation
      const mapa = {
        uq_cp_origem:
          'Já existe um Contas a Pagar gerado para este documento. O lançamento não pode ser duplicado.',
        uq_cr_origem:
          'Já existe um Contas a Receber gerado para este documento. O lançamento não pode ser duplicado.',
        uq_fumigacoes_comunicado:
          'Este número de Comunicado de Fumigação já foi utilizado em outra fumigação.',
        uq_certif_numero_externo:
          'Já existe um certificado com este número para esta empresa fumigadora.',
        uq_parceiros_documento: 'Já existe um cadastro com este CPF/CNPJ/RUC.',
        uq_reservas_documento: 'Este documento já possui uma reserva de estoque ativa.',
        uq_lotes_codigo_produto: 'Já existe um lote com este código para o produto informado.',
      };
      const msg = mapa[erro.constraint];
      if (msg) return new ErroNegocio(msg);
      if (erro.constraint?.includes('numero'))
        return new ErroNegocio('Já existe um documento com este número.');
      return new ErroNegocio('Já existe um registro com estes dados (duplicidade não permitida).');
    }

    case '23503': // foreign_key_violation
      return new ErroNegocio(
        'Este registro está vinculado a outros documentos e não pode ser excluído. ' +
          'Utilize o cancelamento para preservar o histórico.'
      );

    case '23514': { // check_violation com constraint nomeada
      const mapa = {
        ck_fumigacao_comunicado:
          'O número do Comunicado de Fumigação é obrigatório para validar a fumigação.',
        ck_fumigacao_saldo:
          'A quantidade certificada não pode ultrapassar a quantidade fumigada.',
        ck_transf_contas: 'A conta de origem e a de destino devem ser diferentes.',
      };
      return new ErroNegocio(mapa[erro.constraint] || 'Os dados informados violam uma regra do sistema.');
    }

    case '23502': // not_null_violation
      return new ErroNegocio(`O campo "${erro.column}" é obrigatório.`);

    case '22P02': // invalid_text_representation
      return new ErroNegocio('Valor inválido informado em um dos campos.');

    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new ErroNegocio(
        'Outra operação alterou estes dados ao mesmo tempo. Tente novamente.'
      );

    default:
      return erro;
  }
}

export default { ErroNegocio, ErroPermissao, ErroNaoEncontrado, ErroValidacao, traduzirErroBanco };
