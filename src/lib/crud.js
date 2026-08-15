/**
 * Motor de cadastros.
 *
 * Os cadastros mestres do ERP tem o mesmo comportamento: listar com busca,
 * criar, editar, ativar/inativar - e nunca excluir fisicamente (secao 3).
 * Em vez de repetir 15 telas quase iguais, cada cadastro e declarado como
 * metadados e este modulo gera as rotas, a listagem, o formulario, a
 * validacao e a auditoria.
 *
 * Regras operacionais especificas (fumigacao, certificados, estoque) NAO
 * usam este motor: elas tem servico proprio, porque ali cada regra importa.
 */
import { Router } from 'express';
import { muitos, um, transacao } from '../db/index.js';
import { exigir } from './auth.js';
import { registrar, ACOES, diferenca } from './auditoria.js';
import { ErroNaoEncontrado } from './erros.js';
import * as validar from './validar.js';

/**
 * @typedef {object} Campo
 * @property {string} nome            coluna no banco
 * @property {string} rotulo          texto exibido
 * @property {string} [tipo]          texto|textarea|email|documento|placa|numero|decimal|dinheiro|data|select|checkbox
 * @property {number} [col]           largura em colunas de 12 (padrao 6)
 * @property {boolean} [obrigatorio]
 * @property {boolean} [listar]       aparece na tabela de listagem
 * @property {boolean} [buscar]       entra na busca textual
 * @property {string} [ajuda]
 * @property {Array}  [opcoes]        para select estatico: [{valor, texto}]
 * @property {string} [origem]        para select de tabela: 'parceiros:razao_social:is_cliente'
 * @property {*}      [padrao]
 * @property {number} [escala]
 * @property {string} [grupo]         agrupa campos em <fieldset>
 */

/**
 * Cria um router CRUD completo a partir da definicao.
 *
 * @param {object} d
 * @param {string} d.tabela
 * @param {string} d.rota          caminho relativo (ex.: 'clientes')
 * @param {string} d.titulo        plural (ex.: 'Clientes')
 * @param {string} d.singular
 * @param {string} d.permissao     prefixo (ex.: 'cadastros')
 * @param {Campo[]} d.campos
 * @param {string} [d.ordem]
 * @param {string} [d.filtroFixo]  SQL extra aplicado sempre (ex.: 'is_cliente')
 * @param {object} [d.valoresFixos] valores gravados sempre (ex.: { is_cliente: true })
 * @param {string} [d.descricao]   texto de apoio no topo da tela
 */
export function criarCrud(d) {
  const router = Router();
  const base = `/${d.rota}`;
  const perm = (acao) => `${d.permissao}.${acao}`;
  const temAtivo = d.campos.some((c) => c.nome === 'ativo') || d.colunaAtivo !== false;

  // ---------------------------------------------------------------- listagem
  router.get(base, exigir(perm('visualizar')), async (req, res, next) => {
    try {
      const cond = [];
      const params = [];
      if (d.filtroFixo) cond.push(d.filtroFixo);

      const busca = (req.query.busca || '').trim();
      if (busca) {
        const campos = d.campos.filter((c) => c.buscar).map((c) => c.nome);
        campos.push('codigo');
        params.push(`%${busca}%`);
        cond.push(
          '(' +
            [...new Set(campos)]
              .filter((c) => colunaExiste(d, c))
              .map((c) => `${c}::TEXT ILIKE $${params.length}`)
              .join(' OR ') +
            ')'
        );
      }

      if (temAtivo && req.query.inativos !== '1') cond.push('ativo');

      const registros = await muitos(
        `SELECT * FROM ${d.tabela}
          ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          ORDER BY ${d.ordem || 'id DESC'}
          LIMIT 500`,
        params
      );

      const opcoes = await carregarOpcoes(d.campos);

      res.render('cadastros/lista', {
        titulo: d.titulo,
        def: d,
        base: req.baseUrl + base,
        registros,
        busca,
        opcoes,
        temAtivo,
        mostrandoInativos: req.query.inativos === '1',
      });
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------- novo/editar
  router.get(`${base}/novo`, exigir(perm('criar')), async (req, res, next) => {
    try {
      res.render('cadastros/form', {
        titulo: `Novo ${d.singular.toLowerCase()}`,
        def: d,
        base: req.baseUrl + base,
        registro: valoresPadrao(d.campos),
        opcoes: await carregarOpcoes(d.campos),
        novo: true,
      });
    } catch (e) {
      next(e);
    }
  });

  router.get(`${base}/:id`, exigir(perm('visualizar')), async (req, res, next) => {
    try {
      const registro = await um(`SELECT * FROM ${d.tabela} WHERE id = $1`, [req.params.id]);
      if (!registro) throw new ErroNaoEncontrado(`${d.singular} não encontrado.`);

      res.render('cadastros/form', {
        titulo: `${d.singular}: ${rotuloRegistro(d, registro)}`,
        def: d,
        base: req.baseUrl + base,
        registro,
        opcoes: await carregarOpcoes(d.campos),
        novo: false,
      });
    } catch (e) {
      next(e);
    }
  });

  // -------------------------------------------------------------- gravacao
  router.post(`${base}/novo`, exigir(perm('criar')), async (req, res, next) => {
    try {
      const dados = extrair(d, req.body);
      Object.assign(dados, d.valoresFixos || {});

      // Codigo automatico quando o cadastro tem a coluna e o usuario nao informou
      if (colunaExiste(d, 'codigo') && !dados.codigo) {
        dados.codigo = await proximoCodigo(d);
      }

      const colunas = Object.keys(dados);
      const valores = Object.values(dados);
      if (colunaExiste(d, 'criado_por')) {
        colunas.push('criado_por');
        valores.push(req.usuario.id);
      }

      const registro = await transacao(async (cx) => {
        const { rows } = await cx.query(
          `INSERT INTO ${d.tabela} (${colunas.join(', ')})
                VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})
             RETURNING *`,
          valores
        );
        await registrar(cx, {
          usuario: req.usuario,
          acao: ACOES.CRIAR,
          modulo: d.permissao,
          registroTipo: d.tabela.toUpperCase(),
          registroId: rows[0].id,
          registroNumero: rows[0].codigo || null,
          descricao: `${d.singular} criado: ${rotuloRegistro(d, rows[0])}`,
          depois: rows[0],
          ip: req.ip,
          sessao: req.sessionID,
        });
        return rows[0];
      });

      res.avisar(`${d.singular} cadastrado com sucesso.`);
      req.session.save(() => res.redirect(`${req.baseUrl}${base}/${registro.id}`));
    } catch (e) {
      next(e);
    }
  });

  router.post(`${base}/:id`, exigir(perm('editar')), async (req, res, next) => {
    try {
      const dados = extrair(d, req.body);
      const atual = await um(`SELECT * FROM ${d.tabela} WHERE id = $1`, [req.params.id]);
      if (!atual) throw new ErroNaoEncontrado(`${d.singular} não encontrado.`);

      const colunas = Object.keys(dados);
      const valores = Object.values(dados);
      if (colunaExiste(d, 'atualizado_por')) {
        colunas.push('atualizado_por');
        valores.push(req.usuario.id);
      }
      valores.push(req.params.id);

      await transacao(async (cx) => {
        const { rows } = await cx.query(
          `UPDATE ${d.tabela}
              SET ${colunas.map((c, i) => `${c} = $${i + 1}`).join(', ')}
            WHERE id = $${valores.length}
        RETURNING *`,
          valores
        );

        const dif = diferenca(atual, rows[0]);
        if (dif) {
          await registrar(cx, {
            usuario: req.usuario,
            acao: ACOES.ALTERAR,
            modulo: d.permissao,
            registroTipo: d.tabela.toUpperCase(),
            registroId: rows[0].id,
            registroNumero: rows[0].codigo || null,
            descricao: `${d.singular} alterado: ${rotuloRegistro(d, rows[0])}`,
            antes: dif.antes,
            depois: dif.depois,
            ip: req.ip,
            sessao: req.sessionID,
          });
        }
      });

      res.avisar('Alterações salvas.');
      req.session.save(() => res.redirect(`${req.baseUrl}${base}/${req.params.id}`));
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------- ativar / inativar
  // Nao existe exclusao: registros ficam inativos, preservando o historico.
  if (temAtivo) {
    router.post(`${base}/:id/situacao`, exigir(perm('cancelar')), async (req, res, next) => {
      try {
        const atual = await um(`SELECT * FROM ${d.tabela} WHERE id = $1`, [req.params.id]);
        if (!atual) throw new ErroNaoEncontrado(`${d.singular} não encontrado.`);
        const novo = !atual.ativo;

        await transacao(async (cx) => {
          await cx.query(`UPDATE ${d.tabela} SET ativo = $1 WHERE id = $2`, [novo, req.params.id]);
          await registrar(cx, {
            usuario: req.usuario,
            acao: novo ? ACOES.ALTERAR : ACOES.CANCELAR,
            modulo: d.permissao,
            registroTipo: d.tabela.toUpperCase(),
            registroId: atual.id,
            registroNumero: atual.codigo || null,
            descricao: `${d.singular} ${novo ? 'reativado' : 'inativado'}: ${rotuloRegistro(d, atual)}`,
            antes: { ativo: atual.ativo },
            depois: { ativo: novo },
            ip: req.ip,
            sessao: req.sessionID,
          });
        });

        res.avisar(`${d.singular} ${novo ? 'reativado' : 'inativado'}.`);
        req.session.save(() => res.redirect(`${req.baseUrl}${base}`));
      } catch (e) {
        next(e);
      }
    });
  }

  return router;
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

const colunaExiste = (d, nome) =>
  nome === 'id' ||
  d.campos.some((c) => c.nome === nome) ||
  (d.colunasExtras || []).includes(nome);

function rotuloRegistro(d, registro) {
  const campo = d.campoRotulo || d.campos.find((c) => c.rotuloRegistro)?.nome || 'nome';
  return registro[campo] || registro.razao_social || registro.descricao || registro.codigo || `#${registro.id}`;
}

function valoresPadrao(campos) {
  const r = {};
  for (const c of campos) if (c.padrao !== undefined) r[c.nome] = c.padrao;
  return r;
}

/** Converte o corpo do formulario em valores validados prontos para o SQL. */
function extrair(d, corpo) {
  const dados = {};

  for (const campo of d.campos) {
    if (campo.somenteLeitura) continue;
    const bruto = corpo[campo.nome];
    const rot = campo.rotulo;
    const obrigatorio = !!campo.obrigatorio;

    switch (campo.tipo) {
      case 'checkbox':
        dados[campo.nome] = validar.booleano(bruto);
        break;
      case 'numero':
        dados[campo.nome] = validar.inteiro(bruto, rot, { obrigatorio });
        break;
      case 'decimal':
        dados[campo.nome] = validar.decimal(bruto, rot, {
          obrigatorio,
          escala: campo.escala ?? 3,
        });
        break;
      case 'dinheiro':
        dados[campo.nome] = validar.dinheiro(bruto, rot, { obrigatorio });
        break;
      case 'data':
        dados[campo.nome] = validar.data(bruto, rot, { obrigatorio });
        break;
      case 'email':
        dados[campo.nome] = validar.email(bruto, rot, { obrigatorio });
        break;
      case 'documento':
        dados[campo.nome] = validar.cpfCnpj(bruto, rot, {
          obrigatorio,
          estrangeiro: corpo.tipo_documento === 'RUC' || corpo.tipo_documento === 'OUTRO',
        });
        break;
      case 'placa':
        dados[campo.nome] = validar.placa(bruto, rot, { obrigatorio });
        break;
      case 'select':
        if (campo.origem) {
          dados[campo.nome] = validar.id(bruto, rot, { obrigatorio });
        } else {
          dados[campo.nome] = validar.escolha(
            bruto,
            rot,
            campo.opcoes.map((o) => o.valor),
            { obrigatorio, padrao: campo.padrao ?? null }
          );
        }
        break;
      default:
        dados[campo.nome] = validar.texto(bruto, rot, { obrigatorio, max: campo.max });
    }
  }

  return dados;
}

/**
 * Carrega as listas dos selects que apontam para outra tabela.
 * origem: 'tabela:colunaTexto[:filtro]'
 */
async function carregarOpcoes(campos) {
  const mapa = {};
  for (const campo of campos) {
    if (campo.tipo !== 'select' || !campo.origem) continue;
    const [tabela, colunaTexto, filtro] = campo.origem.split(':');
    const temAtivo = await tabelaTemAtivo(tabela);
    const cond = [filtro, temAtivo ? 'ativo' : null].filter(Boolean);
    mapa[campo.nome] = await muitos(
      `SELECT id AS valor, ${colunaTexto} AS texto
         FROM ${tabela}
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY ${colunaTexto}`
    );
  }
  return mapa;
}

const cacheAtivo = new Map();
async function tabelaTemAtivo(tabela) {
  if (cacheAtivo.has(tabela)) return cacheAtivo.get(tabela);
  const r = await um(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = 'ativo'`,
    [tabela]
  );
  cacheAtivo.set(tabela, !!r);
  return !!r;
}

/** Gera o proximo codigo sequencial simples (0001, 0002...) para o cadastro. */
async function proximoCodigo(d) {
  const prefixo = d.prefixoCodigo || '';
  const r = await um(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '\\D', '', 'g'), '')::BIGINT), 0) + 1 AS proximo
       FROM ${d.tabela}
      WHERE codigo ~ ('^' || $1 || '[0-9]+$')`,
    [prefixo]
  );
  return `${prefixo}${String(r.proximo).padStart(4, '0')}`;
}

export default { criarCrud };
