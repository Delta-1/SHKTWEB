/**
 * Primeiros passos.
 *
 * Um ERP recém-instalado esta vazio, e tela vazia nao ensina nada. Este
 * modulo sabe o que ainda falta configurar e devolve isso como uma lista de
 * passos - usada tanto pelo assistente do primeiro acesso quanto pelo cartao
 * "primeiros passos" na tela inicial, que some sozinho quando tudo esta feito.
 *
 * Nenhum passo e obrigatorio para usar o sistema. Sao atalhos para sair do
 * zero sem precisar adivinhar por onde comecar.
 */
import { um, muitos, query, transacao } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';

const CHAVE_CONCLUIDO = 'onboarding.concluido';

/** Le um parametro, com valor padrao. */
export async function parametro(chave, padrao = '') {
  const r = await um('SELECT valor FROM parametros WHERE chave = $1', [chave]);
  return r?.valor ?? padrao;
}

/** Grava (ou cria) um parametro. */
export async function gravarParametro(cx, chave, valor, descricao = null, grupo = 'EMPRESA') {
  await cx.query(
    `INSERT INTO parametros (chave, valor, descricao, grupo)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (chave) DO UPDATE
        SET valor = EXCLUDED.valor, atualizado_em = now()`,
    [chave, valor ?? '', descricao, grupo]
  );
}

/** O assistente do primeiro acesso ja foi encerrado? */
export const assistenteConcluido = () =>
  parametro(CHAVE_CONCLUIDO, 'nao').then((v) => v === 'sim');

export async function concluirAssistente(usuario) {
  await transacao(async (cx) => {
    await gravarParametro(cx, CHAVE_CONCLUIDO, 'sim', 'Assistente de primeiro acesso', 'SISTEMA');
    await registrar(cx, {
      usuario,
      acao: ACOES.ALTERAR,
      modulo: 'admin',
      registroTipo: 'PARAMETRO',
      registroNumero: CHAVE_CONCLUIDO,
      descricao: 'Assistente de primeiro acesso concluído.',
    });
  });
}

/**
 * Situacao de cada passo, direto do banco. Nada e "marcado como feito" a mao:
 * o passo esta feito quando o dado existe de verdade.
 */
export async function passos() {
  const [empresa, contagens] = await Promise.all([
    muitos(`SELECT chave, valor FROM parametros WHERE grupo = 'EMPRESA'`),
    um(`SELECT
          (SELECT COUNT(*)::INT FROM parceiros WHERE is_cliente AND ativo)      AS clientes,
          (SELECT COUNT(*)::INT FROM parceiros WHERE is_fornecedor AND ativo)   AS fornecedores,
          (SELECT COUNT(*)::INT FROM produtos WHERE ativo)                      AS produtos,
          (SELECT COUNT(*)::INT FROM locais_estoque WHERE ativo)                AS locais,
          (SELECT COUNT(*)::INT FROM usuarios WHERE ativo)                      AS usuarios,
          (SELECT COUNT(*)::INT FROM estoque_movimentos)                        AS movimentos`),
  ]);

  const emp = Object.fromEntries(empresa.map((p) => [p.chave, (p.valor || '').trim()]));

  return [
    {
      chave: 'empresa',
      titulo: 'Dados da empresa',
      apoio: 'Aparecem no cabeçalho de todo documento impresso.',
      url: '/inicio/empresa',
      acao: 'Preencher',
      feito: Boolean(emp['empresa.nome'] && emp['empresa.cnpj'] && emp['empresa.cidade']),
    },
    {
      chave: 'armazem',
      titulo: 'Onde a mercadoria fica guardada',
      apoio: 'Cada armazém, silo ou pátio é um local de estoque.',
      url: '/cadastros/locais',
      acao: 'Cadastrar',
      feito: contagens.locais > 0,
    },
    {
      chave: 'produtos',
      titulo: 'O que a empresa movimenta',
      apoio: 'Milho, soja, farelo — o que entra e sai do armazém.',
      url: '/cadastros/produtos',
      acao: 'Cadastrar',
      feito: contagens.produtos > 0,
    },
    {
      chave: 'parceiros',
      titulo: 'Fornecedores e clientes',
      apoio: 'De quem você compra e para quem você vende.',
      url: '/cadastros/fornecedores',
      acao: 'Cadastrar',
      feito: contagens.fornecedores > 0 && contagens.clientes > 0,
    },
    {
      chave: 'equipe',
      titulo: 'Quem mais vai usar o sistema',
      apoio: 'Cada pessoa com seu acesso e seu nível de permissão.',
      url: '/admin/usuarios/novo',
      acao: 'Convidar',
      feito: contagens.usuarios > 1,
    },
    {
      chave: 'estoque',
      titulo: 'Primeira movimentação',
      apoio: 'Um recebimento, ou o saldo que já existe hoje no armazém.',
      url: '/recebimentos/novo',
      acao: 'Registrar',
      feito: contagens.movimentos > 0,
    },
  ];
}

/** Resumo curto para a tela inicial. */
export async function resumo() {
  const lista = await passos();
  const feitos = lista.filter((p) => p.feito).length;
  return {
    passos: lista,
    feitos,
    total: lista.length,
    completo: feitos === lista.length,
    proximo: lista.find((p) => !p.feito) ?? null,
    percentual: Math.round((feitos / lista.length) * 100),
  };
}

/** Grava os dados da empresa vindos do assistente. */
export async function salvarEmpresa(dados, usuario) {
  return transacao(async (cx) => {
    const campos = [
      ['empresa.nome', dados.nome, 'Razão social'],
      ['empresa.cnpj', dados.cnpj, 'CNPJ'],
      ['empresa.endereco', dados.endereco, 'Endereço'],
      ['empresa.cidade', dados.cidade, 'Cidade/UF'],
      ['empresa.telefone', dados.telefone, 'Telefone'],
      ['empresa.email', dados.email, 'E-mail'],
    ];
    for (const [chave, valor, descricao] of campos) {
      await gravarParametro(cx, chave, valor ?? '', descricao);
    }

    await registrar(cx, {
      usuario,
      acao: ACOES.ALTERAR,
      modulo: 'admin',
      registroTipo: 'PARAMETRO',
      registroNumero: 'empresa',
      descricao: `Dados da empresa atualizados: ${dados.nome}.`,
      depois: Object.fromEntries(campos.map(([c, v]) => [c, v])),
    });

    return { ok: true };
  });
}

/** Dados atuais da empresa, para preencher o formulário. */
export async function empresaAtual() {
  const linhas = await muitos(`SELECT chave, valor FROM parametros WHERE grupo = 'EMPRESA'`);
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, l.valor || '']));
  return {
    nome: mapa['empresa.nome'] || '',
    cnpj: mapa['empresa.cnpj'] || '',
    endereco: mapa['empresa.endereco'] || '',
    cidade: mapa['empresa.cidade'] || '',
    telefone: mapa['empresa.telefone'] || '',
    email: mapa['empresa.email'] || '',
  };
}

export default {
  passos,
  resumo,
  assistenteConcluido,
  concluirAssistente,
  salvarEmpresa,
  empresaAtual,
  parametro,
};
