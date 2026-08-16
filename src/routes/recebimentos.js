import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as recebimento from '../services/recebimento.js';
import * as compras from '../services/compras.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

function lerItens(corpo) {
  const comoLista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  const pedidoItens = comoLista(corpo.item_pedido_item_id);
  const produtos = comoLista(corpo.item_produto_id);
  const lotes = comoLista(corpo.item_lote_id);
  const quantidades = comoLista(corpo.item_quantidade);
  const unidades = comoLista(corpo.item_unidade_id);
  const divergencias = comoLista(corpo.item_divergencia);
  const observacoes = comoLista(corpo.item_observacoes);

  const itens = [];
  for (let i = 0; i < quantidades.length; i++) {
    if (!String(quantidades[i] ?? '').trim()) continue;

    itens.push({
      pedidoItemId: validar.id(pedidoItens[i], `Item do pedido (linha ${i + 1})`),
      produtoId: validar.id(produtos[i], `Produto do item ${i + 1}`, { obrigatorio: true }),
      loteId: validar.id(lotes[i], `Lote do item ${i + 1}`),
      quantidade: validar.quantidade(quantidades[i], `Quantidade do item ${i + 1}`, {
        obrigatorio: true,
      }),
      unidadeId: validar.id(unidades[i], `Unidade do item ${i + 1}`, { obrigatorio: true }),
      divergencia: validar.texto(divergencias[i], `Divergência do item ${i + 1}`, { max: 300 }),
      observacoes: validar.texto(observacoes[i], `Observação do item ${i + 1}`),
    });
  }
  return itens;
}

function lerFormulario(corpo) {
  return {
    data: validar.data(corpo.data, 'Data', { obrigatorio: true }),
    dataHoraChegada: validar.dataHora(corpo.data_hora_chegada, 'Chegada'),
    pedidoCompraId: validar.id(corpo.pedido_compra_id, 'Pedido de compra'),
    fornecedorId: validar.id(corpo.fornecedor_id, 'Fornecedor', { obrigatorio: true }),
    localId: validar.id(corpo.local_id, 'Local de estoque', { obrigatorio: true }),
    veiculoId: validar.id(corpo.veiculo_id, 'Veículo'),
    placa: validar.placa(corpo.placa, 'Placa'),
    motoristaId: validar.id(corpo.motorista_id, 'Motorista'),
    transportadoraId: validar.id(corpo.transportadora_id, 'Transportadora'),
    documentoFiscal: validar.texto(corpo.documento_fiscal, 'Documento fiscal', { max: 60 }),
    documentoSerie: validar.texto(corpo.documento_serie, 'Série', { max: 20 }),
    documentoData: validar.data(corpo.documento_data, 'Data do documento'),
    pesoBruto: validar.quantidade(corpo.peso_bruto, 'Peso bruto', { positivo: false }),
    pesoTara: validar.quantidade(corpo.peso_tara, 'Tara', { positivo: false }),
    pesoLiquido: validar.quantidade(corpo.peso_liquido, 'Peso líquido', { positivo: false }),
    conferente: validar.texto(corpo.conferente, 'Conferente', { max: 120 }),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
    itens: lerItens(corpo),
  };
}

const referencias = () =>
  carregar([
    'fornecedores',
    'produtos',
    'lotes',
    'unidades',
    'locais',
    'veiculos',
    'motoristas',
    'transportadoras',
  ]);

// --------------------------------------------------------------- listagem
router.get('/', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      fornecedorId: req.query.fornecedor || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };
    const [lista, aguardando, ref] = await Promise.all([
      recebimento.listar(filtros),
      compras.aguardandoEntrega(),
      carregar(['fornecedores']),
    ]);

    res.render('recebimentos/lista', {
      titulo: 'Recebimentos',
      lista,
      aguardando,
      filtros,
      ref,
      rotulo: recebimento.rotuloStatus,
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- novo
router.get('/novo', exigir('compras.criar'), async (req, res, next) => {
  try {
    const [ref, pedidos] = await Promise.all([referencias(), compras.aguardandoEntrega()]);

    // Quando o operador chega pelo botao "Receber" de um pedido, a tela ja
    // vem preenchida com os itens em aberto daquele pedido.
    let pedido = null;
    let itensPedido = [];
    if (req.query.pedido) {
      pedido = await compras.buscar(req.query.pedido);
      if (pedido) itensPedido = await compras.itensEmAberto(pedido.id);
    }

    res.render('recebimentos/form', {
      titulo: 'Novo recebimento',
      ref,
      pedidos,
      pedido,
      itensPedido,
      recebimento: {
        data: hojeISO(),
        pedido_compra_id: pedido?.id ?? null,
        fornecedor_id: pedido?.fornecedor_id ?? null,
        local_id: pedido?.local_entrega_id ?? null,
        lista_itens: [],
      },
      novo: true,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('compras.criar'), async (req, res, next) => {
  try {
    const r = await recebimento.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Recebimento ${r.numero} lançado. Confirme para dar entrada no estoque.`);
    req.session.save(() => res.redirect(`/recebimentos/${r.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const r = await recebimento.buscar(req.params.id);
    if (!r) throw new ErroNaoEncontrado('Recebimento não encontrado.');
    res.render('recebimentos/detalhe', {
      titulo: `Recebimento ${r.numero}`,
      recebimento: r,
      rotulo: recebimento.rotuloStatus,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('compras.editar'), async (req, res, next) => {
  try {
    const r = await recebimento.buscar(req.params.id);
    if (!r) throw new ErroNaoEncontrado('Recebimento não encontrado.');

    const [ref, pedidos] = await Promise.all([referencias(), compras.aguardandoEntrega()]);
    const itensPedido = r.pedido_compra_id ? await compras.itensEmAberto(r.pedido_compra_id) : [];

    res.render('recebimentos/form', {
      titulo: `Editar recebimento ${r.numero}`,
      ref,
      pedidos,
      pedido: null,
      itensPedido,
      recebimento: r,
      novo: false,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('compras.editar'), async (req, res, next) => {
  try {
    await recebimento.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Recebimento atualizado.');
    req.session.save(() => res.redirect(`/recebimentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------- confirmação
router.post('/:id/confirmar', exigir('compras.aprovar'), async (req, res, next) => {
  try {
    const r = await recebimento.confirmar(req.params.id, req.usuario, ctx(req));
    const t = (Number(r.totalKg) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
    res.avisar(
      `Recebimento ${r.recebimento.numero} confirmado. Entrada de ${t} t no estoque.` +
        (r.situacaoPedido ? ` Pedido de compra: ${r.situacaoPedido}.` : '')
    );
    req.session.save(() => res.redirect(`/recebimentos/${req.params.id}`));
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
    await recebimento.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Recebimento cancelado. Entrada de estoque estornada.');
    req.session.save(() => res.redirect(`/recebimentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- imprimir
router.get('/:id/documento', exigir('compras.visualizar'), async (req, res, next) => {
  try {
    const r = await recebimento.buscar(req.params.id);
    if (!r) throw new ErroNaoEncontrado('Recebimento não encontrado.');
    res.render('docs/recebimento', { titulo: `Recebimento ${r.numero}`, recebimento: r });
  } catch (e) {
    next(e);
  }
});

export default router;
