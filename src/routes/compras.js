import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as compras from '../services/compras.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

const TIPOS = ['MERCADORIA', 'FRETE', 'SERVICO'];

/**
 * Os itens chegam como arrays paralelos (item_produto_id[], item_quantidade[]...),
 * que e como um formulario HTML com varias linhas envia os dados.
 * Linhas totalmente em branco sao descartadas: e comum sobrar a ultima.
 */
function lerItens(corpo) {
  const comoLista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  const produtos = comoLista(corpo.item_produto_id);
  const descricoes = comoLista(corpo.item_descricao);
  const quantidades = comoLista(corpo.item_quantidade);
  const unidades = comoLista(corpo.item_unidade_id);
  const precos = comoLista(corpo.item_preco);
  const observacoes = comoLista(corpo.item_observacoes);

  const itens = [];
  for (let i = 0; i < quantidades.length; i++) {
    const vazia = !String(quantidades[i] ?? '').trim() && !String(descricoes[i] ?? '').trim();
    if (vazia) continue;

    itens.push({
      produtoId: validar.id(produtos[i], `Produto do item ${i + 1}`),
      descricao: validar.texto(descricoes[i], `Descrição do item ${i + 1}`, {
        obrigatorio: true,
        max: 200,
      }),
      quantidade: validar.quantidade(quantidades[i], `Quantidade do item ${i + 1}`, {
        obrigatorio: true,
      }),
      unidadeId: validar.id(unidades[i], `Unidade do item ${i + 1}`, { obrigatorio: true }),
      precoUnitario: validar.dinheiro(precos[i], `Preço do item ${i + 1}`, { min: 0 }) || '0',
      observacoes: validar.texto(observacoes[i], `Observação do item ${i + 1}`),
    });
  }
  return itens;
}

function lerFormulario(corpo) {
  return {
    data: validar.data(corpo.data, 'Data', { obrigatorio: true }),
    fornecedorId: validar.id(corpo.fornecedor_id, 'Fornecedor', { obrigatorio: true }),
    tipo: validar.escolha(corpo.tipo, 'Tipo', TIPOS, { padrao: 'MERCADORIA' }),
    incotermId: validar.id(corpo.incoterm_id, 'Incoterm'),
    moeda: validar.texto(corpo.moeda, 'Moeda', { max: 3 }) || 'BRL',
    condicaoPagamento: validar.texto(corpo.condicao_pagamento, 'Condição de pagamento', { max: 120 }),
    prazoDias: validar.inteiro(corpo.prazo_dias, 'Prazo em dias', { min: 0, max: 3650 }),
    previsaoEntrega: validar.data(corpo.previsao_entrega, 'Previsão de entrega'),
    localEntregaId: validar.id(corpo.local_entrega_id, 'Local de entrega'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
    itens: lerItens(corpo),
  };
}

const referencias = () =>
  carregar(['fornecedores', 'produtos', 'unidades', 'locais', 'incoterms', 'moedas']);

// --------------------------------------------------------------- listagem
router.get('/', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      tipo: req.query.tipo || null,
      fornecedorId: req.query.fornecedor || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };
    const [lista, ref] = await Promise.all([compras.listar(filtros), carregar(['fornecedores'])]);

    res.render('compras/lista', {
      titulo: 'Pedidos de compra',
      lista,
      filtros,
      ref,
      rotulo: compras.rotuloStatus,
      totais: {
        quantidade: lista.filter((p) => !['CANCELADO', 'RASCUNHO'].includes(p.status)).length,
        valor: lista
          .filter((p) => !['CANCELADO', 'RASCUNHO'].includes(p.status))
          .reduce((s, p) => s + Number(p.valor_total), 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- novo
router.get('/novo', exigir('compras.criar'), async (req, res, next) => {
  try {
    res.render('compras/form', {
      titulo: 'Novo pedido de compra',
      ref: await referencias(),
      pedido: { data: hojeISO(), tipo: 'MERCADORIA', moeda: 'BRL', lista_itens: [] },
      novo: true,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('compras.criar'), async (req, res, next) => {
  try {
    const p = await compras.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Pedido de compra ${p.numero} criado. Aprove para gerar a previsão financeira.`);
    req.session.save(() => res.redirect(`/compras/${p.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const p = await compras.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de compra não encontrado.');
    res.render('compras/detalhe', {
      titulo: `Pedido de compra ${p.numero}`,
      pedido: p,
      rotulo: compras.rotuloStatus,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('compras.editar'), async (req, res, next) => {
  try {
    const p = await compras.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de compra não encontrado.');
    res.render('compras/form', {
      titulo: `Editar pedido ${p.numero}`,
      ref: await referencias(),
      pedido: p,
      novo: false,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('compras.editar'), async (req, res, next) => {
  try {
    await compras.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Pedido de compra atualizado.');
    req.session.save(() => res.redirect(`/compras/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------ fluxo
router.post('/:id/enviar', exigir('compras.editar'), async (req, res, next) => {
  try {
    await compras.enviarParaAprovacao(req.params.id, req.usuario, ctx(req));
    res.avisar('Pedido enviado para aprovação.');
    req.session.save(() => res.redirect(`/compras/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/aprovar', exigir('compras.aprovar'), async (req, res, next) => {
  try {
    const r = await compras.aprovar(req.params.id, req.usuario, ctx(req));
    res.avisar(
      `Pedido ${r.pedido.numero} aprovado.` +
        (r.contaPagar
          ? ` Contas a Pagar ${r.contaPagar.numero} gerado com vencimento em ${r.contaPagar.vencimento}.`
          : '')
    );
    req.session.save(() => res.redirect(`/compras/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/cancelar', exigir('compras.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do cancelamento', {
      obrigatorio: true,
      min: 5,
    });
    await compras.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Pedido de compra cancelado.');
    req.session.save(() => res.redirect(`/compras/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- imprimir
router.get('/:id/documento', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const p = await compras.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de compra não encontrado.');
    res.render('docs/pedido-compra', { titulo: `Pedido de compra ${p.numero}`, pedido: p });
  } catch (e) {
    next(e);
  }
});

export default router;
