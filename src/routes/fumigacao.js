import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as fumigacao from '../services/fumigacao.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';
import config from '../config.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

/** Le os campos do formulario de fumigacao. */
function lerFormulario(corpo) {
  return {
    numeroComunicado: validar.texto(corpo.numero_comunicado, 'Comunicado de Fumigação', { max: 60 }),
    fumigadoraId: validar.id(corpo.fumigadora_id, 'Empresa fumigadora', { obrigatorio: true }),
    produtoId: validar.id(corpo.produto_id, 'Produto', { obrigatorio: true }),
    localId: validar.id(corpo.local_id, 'Local', { obrigatorio: true }),
    loteId: validar.id(corpo.lote_id, 'Lote'),
    quantidade: validar.quantidade(corpo.quantidade, 'Quantidade', { obrigatorio: true }),
    unidadeId: validar.id(corpo.unidade_id, 'Unidade', { obrigatorio: true }),
    moedaId: validar.id(corpo.moeda_id, 'Moeda', { obrigatorio: true }),
    custoTonelada: validar.dinheiro(corpo.custo_tonelada, 'Custo por tonelada'),
    inicio: validar.dataHora(corpo.inicio, 'Início'),
    termino: validar.dataHora(corpo.termino, 'Término'),
    responsavel: validar.texto(corpo.responsavel, 'Responsável'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
  };
}

// --------------------------------------------------------------- listagem
router.get('/', exigir('fumigacao.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      produtoId: req.query.produto || null,
      fumigadoraId: req.query.fumigadora || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
      comSaldo: req.query.comSaldo === '1',
    };

    const [lista, totais, ref, pendentes] = await Promise.all([
      fumigacao.listar(filtros),
      fumigacao.saldoTotal(),
      carregar(['produtos', 'fumigadoras']),
      fumigacao.semComunicado(),
    ]);

    res.render('fumigacao/lista', {
      titulo: 'Fumigação',
      lista,
      totais,
      ref,
      filtros,
      alertaFumigacao: pendentes.length,
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- novo
router.get('/novo', exigir('fumigacao.criar'), async (req, res, next) => {
  try {
    const ref = await carregar(['produtos', 'locais', 'unidades', 'lotes', 'fumigadoras', 'moedas']);
    res.render('fumigacao/form', {
      titulo: 'Novo pedido de fumigação',
      ref,
      fumigacao: { status: 'RASCUNHO', responsavel: req.usuario.nome },
      novo: true,
      hoje: hojeISO(),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('fumigacao.criar'), async (req, res, next) => {
  try {
    const f = await fumigacao.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Pedido de fumigação ${f.numero} criado.`);
    req.session.save(() => res.redirect(`/fumigacao/${f.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('fumigacao.visualizar'), async (req, res, next) => {
  try {
    const f = await fumigacao.buscar(req.params.id);
    if (!f) throw new ErroNaoEncontrado('Fumigação não encontrada.');

    res.render('fumigacao/detalhe', {
      titulo: `Fumigação ${f.numero}`,
      fumigacao: f,
      diasVencimento: config.regras.diasVencimentoCertificado,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('fumigacao.editar'), async (req, res, next) => {
  try {
    const f = await fumigacao.buscar(req.params.id);
    if (!f) throw new ErroNaoEncontrado('Fumigação não encontrada.');

    const ref = await carregar(['produtos', 'locais', 'unidades', 'lotes', 'fumigadoras', 'moedas']);
    res.render('fumigacao/form', {
      titulo: `Editar fumigação ${f.numero}`,
      ref,
      fumigacao: f,
      novo: false,
      hoje: hojeISO(),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('fumigacao.editar'), async (req, res, next) => {
  try {
    await fumigacao.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Fumigação atualizada.');
    req.session.save(() => res.redirect(`/fumigacao/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- validar
router.post('/:id/validar', exigir('fumigacao.aprovar'), async (req, res, next) => {
  try {
    const dados = {
      numeroComunicado: validar.texto(req.body.numero_comunicado, 'Comunicado de Fumigação', {
        obrigatorio: true,
        max: 60,
      }),
      inicio: validar.dataHora(req.body.inicio, 'Início'),
      termino: validar.dataHora(req.body.termino, 'Término (exaustão)', { obrigatorio: true }),
    };

    const f = await fumigacao.validar(req.params.id, dados, req.usuario, ctx(req));
    res.avisar(
      `Fumigação ${f.numero} validada. Saldo fumigado disponível: ` +
        `${(Number(f.quantidade_kg) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} t.`
    );
    req.session.save(() => res.redirect(`/fumigacao/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------- cancelar
router.post('/:id/cancelar', exigir('fumigacao.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do cancelamento', {
      obrigatorio: true,
      min: 5,
    });
    await fumigacao.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Fumigação cancelada. O histórico foi preservado.');
    req.session.save(() => res.redirect(`/fumigacao/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- imprimir
router.get('/:id/documento', exigir('fumigacao.visualizar'), async (req, res, next) => {
  try {
    const f = await fumigacao.buscar(req.params.id);
    if (!f) throw new ErroNaoEncontrado('Fumigação não encontrada.');
    res.render('docs/fumigacao', { titulo: `Pedido de Fumigação ${f.numero}`, fumigacao: f });
  } catch (e) {
    next(e);
  }
});

export default router;
