import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as financeiro from '../services/financeiro.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { um, muitos } from '../db/index.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

/** 'pagar' -> 'CP' | 'receber' -> 'CR' */
const tipoDe = (segmento) => (segmento === 'pagar' ? 'CP' : 'CR');

function lerTitulo(corpo, tipo) {
  const base = {
    descricao: validar.texto(corpo.descricao, 'Descrição', { obrigatorio: true, max: 200 }),
    parceiroId: validar.id(corpo.parceiro_id, tipo === 'CP' ? 'Fornecedor' : 'Cliente'),
    categoriaId: validar.id(corpo.categoria_id, 'Categoria'),
    centroCustoId: validar.id(corpo.centro_custo_id, 'Centro de custo'),
    emissao: validar.data(corpo.emissao, 'Emissão'),
    vencimento: validar.data(corpo.vencimento, 'Vencimento', { obrigatorio: true }),
    competencia: validar.data(corpo.competencia, 'Competência'),
    valor: validar.dinheiro(corpo.valor, 'Valor', { obrigatorio: true, positivo: true }),
    moedaId: validar.id(corpo.moeda_id, 'Moeda', { obrigatorio: true }),
    documentoFiscal: validar.texto(corpo.documento_fiscal, 'Documento fiscal'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
  };

  if (tipo === 'CP') {
    base.origem = validar.escolha(
      corpo.origem,
      'Origem',
      ['MANUAL', 'COMPRA', 'FUMIGACAO', 'RH', 'MANUTENCAO', 'ABASTECIMENTO', 'VIAGEM', 'IMPOSTO',
       'ADMINISTRATIVO', 'FRETE'],
      { padrao: 'MANUAL' }
    );
    base.beneficiario = validar.texto(corpo.beneficiario, 'Beneficiário');
  } else {
    base.origem = validar.escolha(corpo.origem, 'Origem', ['MANUAL', 'VENDA', 'OUTROS'], {
      padrao: 'MANUAL',
    });
    base.pagador = validar.texto(corpo.pagador, 'Pagador');
  }

  return base;
}

// ---------------------------------------------------------------------------
// Listagens de titulos
// ---------------------------------------------------------------------------
for (const segmento of ['pagar', 'receber']) {
  const tipo = tipoDe(segmento);
  const nome = tipo === 'CP' ? 'Contas a pagar' : 'Contas a receber';

  router.get(`/${segmento}`, exigir('financeiro.visualizar'), async (req, res, next) => {
    try {
      const filtros = {
        status: req.query.status || null,
        parceiroId: req.query.parceiro || null,
        de: req.query.de || null,
        ate: req.query.ate || null,
        busca: req.query.busca || null,
        vencidos: req.query.vencidos === '1',
      };

      const [lista, ref] = await Promise.all([
        financeiro.listarTitulos(tipo, filtros),
        carregar([tipo === 'CP' ? 'fornecedores' : 'clientes', 'categorias']),
      ]);

      res.render('financeiro/lista', {
        titulo: nome,
        tipo,
        segmento,
        lista,
        ref,
        filtros,
        totais: {
          total: lista.reduce((s, t) => s + Number(t.valor), 0),
          saldo: lista.reduce((s, t) => s + Number(t.saldo), 0),
          vencido: lista.filter((t) => t.vencido).reduce((s, t) => s + Number(t.saldo), 0),
          qtdVencidos: lista.filter((t) => t.vencido).length,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.get(`/${segmento}/novo`, exigir('financeiro.criar'), async (req, res, next) => {
    try {
      const ref = await carregar([
        tipo === 'CP' ? 'fornecedores' : 'clientes',
        'categorias', 'centrosCusto', 'moedas',
      ]);
      res.render('financeiro/form', {
        titulo: `Novo título — ${nome.toLowerCase()}`,
        tipo,
        segmento,
        ref,
        titulo_registro: { emissao: hojeISO() },
      });
    } catch (e) {
      next(e);
    }
  });

  router.post(`/${segmento}/novo`, exigir('financeiro.criar'), async (req, res, next) => {
    try {
      const t = await financeiro.criarTituloManual(tipo, lerTitulo(req.body, tipo), req.usuario, ctx(req));
      res.avisar(`Título ${t.numero} criado.`);
      req.session.save(() => res.redirect(`/financeiro/${segmento}/${t.id}`));
    } catch (e) {
      next(e);
    }
  });

  router.get(`/${segmento}/:id`, exigir('financeiro.visualizar'), async (req, res, next) => {
    try {
      const t = await financeiro.buscarTitulo(tipo, req.params.id);
      if (!t) throw new ErroNaoEncontrado('Título não encontrado.');

      const ref = await carregar(['contasBancarias', 'formasPagamento']);

      // Documento que originou o titulo, para navegar ate a origem
      let origem = null;
      if (t.origem_tipo === 'CERTIFICADO_FUMIGACAO') {
        origem = await um(
          `SELECT c.id, c.numero, c.numero_certificado, c.quantidade_kg,
                  f.numero AS fumigacao_numero, f.numero_comunicado, f.id AS fumigacao_id
             FROM certificados_fumigacao c JOIN fumigacoes f ON f.id = c.fumigacao_id
            WHERE c.id = $1`,
          [t.origem_id]
        );
      }

      res.render('financeiro/detalhe', {
        titulo: `${tipo === 'CP' ? 'Contas a pagar' : 'Contas a receber'} ${t.numero}`,
        tipo,
        segmento,
        registro: t,
        ref,
        origem,
        hoje: hojeISO(),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post(`/${segmento}/:id/baixar`, exigir('financeiro.liquidar'), async (req, res, next) => {
    try {
      const dados = {
        valor: validar.dinheiro(req.body.valor, 'Valor', { obrigatorio: true, positivo: true }),
        data: validar.data(req.body.data, 'Data', { obrigatorio: true }),
        contaBancariaId: validar.id(req.body.conta_bancaria_id, 'Conta', { obrigatorio: true }),
        formaPagamentoId: validar.id(req.body.forma_pagamento_id, 'Forma de pagamento'),
        juros: validar.dinheiro(req.body.juros, 'Juros'),
        desconto: validar.dinheiro(req.body.desconto, 'Desconto'),
        observacoes: validar.texto(req.body.observacoes, 'Observações'),
      };

      await financeiro.baixar(tipo, req.params.id, dados, req.usuario, ctx(req));
      res.avisar(tipo === 'CP' ? 'Pagamento registrado.' : 'Recebimento registrado.');
      req.session.save(() => res.redirect(`/financeiro/${segmento}/${req.params.id}`));
    } catch (e) {
      next(e);
    }
  });

  router.post(`/${segmento}/:id/cancelar`, exigir('financeiro.cancelar'), async (req, res, next) => {
    try {
      const motivo = validar.texto(req.body.motivo, 'Motivo', { obrigatorio: true, min: 5 });
      await financeiro.cancelarTitulo(tipo, req.params.id, motivo, req.usuario, ctx(req));
      res.avisar('Título cancelado.');
      req.session.save(() => res.redirect(`/financeiro/${segmento}/${req.params.id}`));
    } catch (e) {
      next(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Estorno de baixa
// ---------------------------------------------------------------------------
router.post('/baixas/:id/estornar', exigir('financeiro.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do estorno', { obrigatorio: true, min: 5 });
    await financeiro.estornarBaixa(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Baixa estornada. O saldo do título foi restabelecido.');
    req.session.save(() => res.redirect(req.get('referer') || '/financeiro/pagar'));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Caixa e bancos
// ---------------------------------------------------------------------------
router.get('/contas', exigir('financeiro.visualizar'), async (req, res, next) => {
  try {
    const [saldos, ref] = await Promise.all([financeiro.saldosContas(), carregar(['contasBancarias'])]);
    res.render('financeiro/contas', { titulo: 'Caixa e bancos', saldos, ref, hoje: hojeISO() });
  } catch (e) {
    next(e);
  }
});

router.get('/contas/:id', exigir('financeiro.visualizar'), async (req, res, next) => {
  try {
    const conta = await um('SELECT * FROM vw_contas_saldos WHERE id = $1', [req.params.id]);
    if (!conta) throw new ErroNaoEncontrado('Conta não encontrada.');

    const filtros = { de: req.query.de || null, ate: req.query.ate || null };
    const extrato = await financeiro.extratoConta(req.params.id, filtros);

    res.render('financeiro/extrato', {
      titulo: `Extrato — ${conta.nome}`,
      conta,
      extrato,
      filtros,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/transferencias', exigir('financeiro.liquidar'), async (req, res, next) => {
  try {
    const dados = {
      contaOrigemId: validar.id(req.body.conta_origem_id, 'Conta de origem', { obrigatorio: true }),
      contaDestinoId: validar.id(req.body.conta_destino_id, 'Conta de destino', { obrigatorio: true }),
      valor: validar.dinheiro(req.body.valor, 'Valor', { obrigatorio: true, positivo: true }),
      data: validar.data(req.body.data, 'Data'),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    };

    const t = await financeiro.transferirEntreContas(dados, req.usuario, ctx(req));
    res.avisar(`Transferência ${t.numero} registrada.`);
    req.session.save(() => res.redirect('/financeiro/contas'));
  } catch (e) {
    next(e);
  }
});

export default router;
