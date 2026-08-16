import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as vendas from '../services/vendas.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

function lerItens(corpo) {
  const comoLista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  const produtos = comoLista(corpo.item_produto_id);
  const locais = comoLista(corpo.item_local_id);
  const lotes = comoLista(corpo.item_lote_id);
  const quantidades = comoLista(corpo.item_quantidade);
  const unidades = comoLista(corpo.item_unidade_id);
  const precos = comoLista(corpo.item_preco);
  const observacoes = comoLista(corpo.item_observacoes);

  const itens = [];
  for (let i = 0; i < quantidades.length; i++) {
    if (!String(quantidades[i] ?? '').trim()) continue;

    itens.push({
      produtoId: validar.id(produtos[i], `Produto do item ${i + 1}`, { obrigatorio: true }),
      localId: validar.id(locais[i], `Local do item ${i + 1}`, { obrigatorio: true }),
      loteId: validar.id(lotes[i], `Lote do item ${i + 1}`),
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
    operacaoId: validar.id(corpo.operacao_id, 'Operação'),
    clienteId: validar.id(corpo.cliente_id, 'Cliente', { obrigatorio: true }),
    incotermId: validar.id(corpo.incoterm_id, 'Incoterm'),
    paisDestinoId: validar.id(corpo.pais_destino_id, 'País de destino'),
    destino: validar.texto(corpo.destino, 'Destino', { max: 160 }),
    moeda: validar.texto(corpo.moeda, 'Moeda', { max: 3 }) || 'BRL',
    condicaoPagamento: validar.texto(corpo.condicao_pagamento, 'Condição de pagamento', { max: 120 }),
    prazoDias: validar.inteiro(corpo.prazo_dias, 'Prazo em dias', { min: 0, max: 3650 }),
    previsaoEmbarque: validar.data(corpo.previsao_embarque, 'Previsão de embarque'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
    itens: lerItens(corpo),
  };
}

const referencias = () =>
  carregar(['clientes', 'produtos', 'locais', 'lotes', 'unidades', 'incoterms', 'paises', 'moedas', 'operacoes']);

// --------------------------------------------------------------- listagem
router.get('/', exigir('vendas.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      clienteId: req.query.cliente || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };
    const [lista, ref] = await Promise.all([vendas.listar(filtros), carregar(['clientes'])]);

    res.render('vendas/lista', {
      titulo: 'Pedidos de venda',
      lista,
      filtros,
      ref,
      rotulo: vendas.rotuloStatus,
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
router.get('/novo', exigir('vendas.criar'), async (req, res, next) => {
  try {
    res.render('vendas/form', {
      titulo: 'Novo pedido de venda',
      ref: await referencias(),
      pedido: { data: hojeISO(), moeda: 'BRL', lista_itens: [] },
      novo: true,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('vendas.criar'), async (req, res, next) => {
  try {
    const p = await vendas.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Pedido de venda ${p.numero} criado. Aprove para reservar o estoque.`);
    req.session.save(() => res.redirect(`/vendas/${p.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('vendas.visualizar'), async (req, res, next) => {
  try {
    const p = await vendas.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de venda não encontrado.');
    res.render('vendas/detalhe', {
      titulo: `Pedido de venda ${p.numero}`,
      pedido: p,
      rotulo: vendas.rotuloStatus,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('vendas.editar'), async (req, res, next) => {
  try {
    const p = await vendas.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de venda não encontrado.');
    res.render('vendas/form', {
      titulo: `Editar pedido ${p.numero}`,
      ref: await referencias(),
      pedido: p,
      novo: false,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('vendas.editar'), async (req, res, next) => {
  try {
    await vendas.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Pedido de venda atualizado.');
    req.session.save(() => res.redirect(`/vendas/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------------- fluxo
router.post('/:id/enviar', exigir('vendas.editar'), async (req, res, next) => {
  try {
    await vendas.enviarParaAprovacao(req.params.id, req.usuario, ctx(req));
    res.avisar('Pedido enviado para aprovação.');
    req.session.save(() => res.redirect(`/vendas/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/aprovar', exigir('vendas.aprovar'), async (req, res, next) => {
  try {
    const r = await vendas.aprovar(req.params.id, req.usuario, ctx(req));
    res.avisar(
      `Pedido ${r.pedido.numero} aprovado. Estoque reservado.` +
        (r.contaReceber ? ` Contas a Receber ${r.contaReceber.numero} gerado.` : '')
    );
    req.session.save(() => res.redirect(`/vendas/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/cancelar', exigir('vendas.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do cancelamento', {
      obrigatorio: true,
      min: 5,
    });
    await vendas.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Pedido de venda cancelado. Reserva de estoque liberada.');
    req.session.save(() => res.redirect(`/vendas/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- imprimir
router.get('/:id/documento', exigir('vendas.visualizar'), async (req, res, next) => {
  try {
    const p = await vendas.buscar(req.params.id);
    if (!p) throw new ErroNaoEncontrado('Pedido de venda não encontrado.');
    res.render('docs/pedido-venda', { titulo: `Pedido de venda ${p.numero}`, pedido: p });
  } catch (e) {
    next(e);
  }
});

export default router;
