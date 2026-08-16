/**
 * Assistente de primeiro acesso.
 *
 * Quatro telas curtas, uma pergunta de cada vez, com o passo visível no topo.
 * Nada aqui é obrigatório: dá para pular e continuar depois pelo cartão
 * "primeiros passos" da tela inicial. O objetivo é só não deixar ninguém
 * sozinho diante de um sistema vazio.
 */
import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import * as onboarding from '../services/onboarding.js';
import * as validar from '../lib/validar.js';
import { transacao, um } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';

const router = Router();

const ETAPAS = [
  { chave: 'boas-vindas', rotulo: 'Boas-vindas' },
  { chave: 'empresa', rotulo: 'Sua empresa' },
  { chave: 'armazem', rotulo: 'Armazém e produto' },
  { chave: 'pronto', rotulo: 'Pronto' },
];

const indiceDa = (chave) => Math.max(ETAPAS.findIndex((e) => e.chave === chave), 0);

function renderizar(res, chave, extra = {}) {
  const indice = indiceDa(chave);
  res.render(`inicio/${chave}`, {
    titulo: 'Primeiros passos',
    etapas: ETAPAS,
    etapaAtual: indice,
    percentual: Math.round(((indice + 1) / ETAPAS.length) * 100),
    ...extra,
  });
}

// ----------------------------------------------------------- assistente
router.get('/', exigir('dashboard.visualizar'), (req, res) => {
  renderizar(res, 'boas-vindas');
});

router.get('/empresa', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    renderizar(res, 'empresa', {
      empresa: await onboarding.empresaAtual(),
      // Fora do assistente (vindo do cartão de primeiros passos) o rodapé muda
      avulso: req.query.avulso === '1',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/empresa', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    await onboarding.salvarEmpresa(
      {
        nome: validar.texto(req.body.nome, 'Razão social', { obrigatorio: true, max: 160 }),
        cnpj: validar.texto(req.body.cnpj, 'CNPJ', { max: 30 }),
        endereco: validar.texto(req.body.endereco, 'Endereço', { max: 200 }),
        cidade: validar.texto(req.body.cidade, 'Cidade/UF', { max: 120 }),
        telefone: validar.texto(req.body.telefone, 'Telefone', { max: 40 }),
        email: validar.email(req.body.email, 'E-mail'),
      },
      req.usuario
    );

    res.avisar('Dados da empresa salvos.');
    const destino = req.body.avulso === '1' ? '/' : '/inicio/armazem';
    req.session.save(() => res.redirect(destino));
  } catch (e) {
    next(e);
  }
});

router.get('/armazem', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    const atual = await um(`
      SELECT (SELECT nome FROM locais_estoque WHERE ativo ORDER BY id LIMIT 1)  AS local,
             (SELECT descricao FROM produtos WHERE ativo ORDER BY id LIMIT 1)   AS produto,
             (SELECT COUNT(*)::INT FROM locais_estoque WHERE ativo)             AS locais,
             (SELECT COUNT(*)::INT FROM produtos WHERE ativo)                   AS produtos
    `);
    renderizar(res, 'armazem', { atual });
  } catch (e) {
    next(e);
  }
});

router.post('/armazem', exigir('cadastros.criar'), async (req, res, next) => {
  try {
    const local = validar.texto(req.body.local, 'Nome do armazém', { max: 120 });
    const produto = validar.texto(req.body.produto, 'Produto', { max: 160 });

    await transacao(async (cx) => {
      if (local) {
        // Código curto derivado do nome: o operador não precisa inventar um
        const codigo = gerarCodigo(local, 'LOCAL');
        const { rows } = await cx.query(
          `INSERT INTO locais_estoque (codigo, nome, ativo) VALUES ($1, $2, true)
           ON CONFLICT (codigo) DO NOTHING RETURNING id`,
          [codigo, local]
        );
        if (rows[0]) {
          await registrar(cx, {
            usuario: req.usuario,
            acao: ACOES.CRIAR,
            modulo: 'cadastros',
            registroTipo: 'LOCAL_ESTOQUE',
            registroId: rows[0].id,
            registroNumero: codigo,
            descricao: `Local de estoque "${local}" criado no assistente de primeiro acesso.`,
          });
        }
      }

      if (produto) {
        const codigo = gerarCodigo(produto, 'PROD');
        const ton = await cx.query(`SELECT id FROM unidades_medida WHERE codigo = 'TON' LIMIT 1`);
        const { rows } = await cx.query(
          `INSERT INTO produtos (codigo, descricao, unidade_id, exige_fumigacao, ativo)
                VALUES ($1, $2, $3, true, true)
           ON CONFLICT (codigo) DO NOTHING RETURNING id`,
          [codigo, produto, ton.rows[0]?.id ?? null]
        );
        if (rows[0]) {
          await registrar(cx, {
            usuario: req.usuario,
            acao: ACOES.CRIAR,
            modulo: 'cadastros',
            registroTipo: 'PRODUTO',
            registroId: rows[0].id,
            registroNumero: codigo,
            descricao: `Produto "${produto}" criado no assistente de primeiro acesso.`,
          });
        }
      }
    });

    req.session.save(() => res.redirect('/inicio/pronto'));
  } catch (e) {
    next(e);
  }
});

router.get('/pronto', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    renderizar(res, 'pronto', { resumo: await onboarding.resumo() });
  } catch (e) {
    next(e);
  }
});

router.post('/concluir', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    await onboarding.concluirAssistente(req.usuario);
    res.avisar('Tudo pronto. Bom trabalho!');
    req.session.save(() => res.redirect('/'));
  } catch (e) {
    next(e);
  }
});

/** Pular o assistente encerra ele de vez; o cartão de primeiros passos fica. */
router.post('/pular', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    await onboarding.concluirAssistente(req.usuario);
    res.avisar('Sem problema. O que faltar aparece em "Primeiros passos", na tela inicial.');
    req.session.save(() => res.redirect('/'));
  } catch (e) {
    next(e);
  }
});

/** "Armazém Principal" -> "ARMAZEM-PRINCIPAL", cortado em 20 caracteres. */
function gerarCodigo(texto, prefixo) {
  const limpo = String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
  return limpo || `${prefixo}-1`;
}

export default router;
