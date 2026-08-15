import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as certificados from '../services/certificados.js';
import * as fumigacaoSvc from '../services/fumigacao.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO, somarDias } from '../lib/formato.js';
import config from '../config.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

function lerFormulario(corpo) {
  return {
    fumigacaoId: validar.id(corpo.fumigacao_id, 'Fumigação', { obrigatorio: true }),
    numeroCertificado: validar.texto(corpo.numero_certificado, 'Nº do certificado', { max: 60 }),
    quantidade: validar.quantidade(corpo.quantidade, 'Quantidade', { obrigatorio: true }),
    unidadeId: validar.id(corpo.unidade_id, 'Unidade', { obrigatorio: true }),
    data: validar.data(corpo.data, 'Data', { obrigatorio: true }),
    vencimento: validar.data(corpo.vencimento, 'Vencimento'),
    custoTonelada: validar.dinheiro(corpo.custo_tonelada, 'Custo por tonelada'),
    moedaId: validar.id(corpo.moeda_id, 'Moeda', { obrigatorio: true }),
    clienteId: validar.id(corpo.cliente_id, 'Cliente'),
    destino: validar.texto(corpo.destino, 'Destino'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
  };
}

// --------------------------------------------------------------- listagem
router.get('/', exigir('certificados.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };
    const lista = await certificados.listar(filtros);

    res.render('certificados/lista', {
      titulo: 'Certificados de fumigação',
      lista,
      filtros,
      totais: {
        quantidade: lista.filter((c) => c.status === 'VALIDADO').length,
        kg: lista.filter((c) => c.status === 'VALIDADO').reduce((s, c) => s + Number(c.quantidade_kg), 0),
        valor: lista.filter((c) => c.status === 'VALIDADO').reduce((s, c) => s + Number(c.valor_total), 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- novo
router.get('/novo', exigir('certificados.criar'), async (req, res, next) => {
  try {
    const [fumigacoes, ref] = await Promise.all([
      fumigacaoSvc.comSaldo(),
      carregar(['unidades', 'moedas', 'clientes']),
    ]);

    const hoje = hojeISO();
    res.render('certificados/form', {
      titulo: 'Novo certificado de fumigação',
      fumigacoes,
      ref,
      certificado: {
        data: hoje,
        vencimento: somarDias(hoje, config.regras.diasVencimentoCertificado),
        fumigacao_id: req.query.fumigacao || null,
      },
      novo: true,
      diasVencimento: config.regras.diasVencimentoCertificado,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('certificados.criar'), async (req, res, next) => {
  try {
    const c = await certificados.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Certificado ${c.numero} criado. Valide para gerar o título financeiro.`);
    req.session.save(() => res.redirect(`/certificados/${c.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('certificados.visualizar'), async (req, res, next) => {
  try {
    const c = await certificados.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Certificado não encontrado.');
    res.render('certificados/detalhe', { titulo: `Certificado ${c.numero}`, certificado: c });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('certificados.editar'), async (req, res, next) => {
  try {
    const c = await certificados.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Certificado não encontrado.');

    const [fumigacoes, ref] = await Promise.all([
      fumigacaoSvc.comSaldo(),
      carregar(['unidades', 'moedas', 'clientes']),
    ]);

    // A fumigacao do certificado precisa aparecer na lista mesmo sem saldo livre
    if (!fumigacoes.some((x) => x.id === c.fumigacao_id)) {
      const atual = await fumigacaoSvc.buscar(c.fumigacao_id);
      if (atual) fumigacoes.unshift(atual);
    }

    res.render('certificados/form', {
      titulo: `Editar certificado ${c.numero}`,
      fumigacoes,
      ref,
      certificado: c,
      novo: false,
      diasVencimento: config.regras.diasVencimentoCertificado,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('certificados.editar'), async (req, res, next) => {
  try {
    await certificados.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Certificado atualizado.');
    req.session.save(() => res.redirect(`/certificados/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- validar
router.post('/:id/validar', exigir('certificados.aprovar'), async (req, res, next) => {
  try {
    const r = await certificados.validar(req.params.id, req.usuario, ctx(req));
    const saldoT = (Number(r.saldoRestante) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 });

    res.avisar(
      `Certificado ${r.certificado.numero} validado. Saldo fumigado restante: ${saldoT} t.` +
        (r.contaPagar ? ` Contas a Pagar ${r.contaPagar.numero} gerado automaticamente.` : '')
    );
    req.session.save(() => res.redirect(`/certificados/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- cancelar
router.post('/:id/cancelar', exigir('certificados.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do cancelamento', {
      obrigatorio: true,
      min: 5,
    });
    await certificados.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Certificado cancelado. Saldo fumigado devolvido e título financeiro cancelado.');
    req.session.save(() => res.redirect(`/certificados/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- imprimir
router.get('/:id/documento', exigir('certificados.visualizar'), async (req, res, next) => {
  try {
    const c = await certificados.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Certificado não encontrado.');
    res.render('docs/certificado', { titulo: `Certificado ${c.numero}`, certificado: c });
  } catch (e) {
    next(e);
  }
});

export default router;
