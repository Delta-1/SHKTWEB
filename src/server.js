import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

import config, { ROOT } from './config.js';
import { pool } from './db/index.js';
import { injetarUsuario, exigirLogin } from './lib/auth.js';
import { ErroNegocio } from './lib/erros.js';
import * as formato from './lib/formato.js';
import { icone, SPRITE } from './lib/icones.js';
import { estatico } from './lib/estaticos.js';

import rotasAuth from './routes/auth.js';
import rotasPainel from './routes/painel.js';
import rotasCadastros from './routes/cadastros.js';
import rotasEstoque from './routes/estoque.js';
import rotasFumigacao from './routes/fumigacao.js';
import rotasCertificados from './routes/certificados.js';
import rotasCarregamento from './routes/carregamento.js';
import rotasInicio from './routes/inicio.js';
import rotasCompras from './routes/compras.js';
import rotasRecebimentos from './routes/recebimentos.js';
import rotasVendas from './routes/vendas.js';
import rotasFrota from './routes/frota.js';
import rotasRh from './routes/rh.js';
import rotasImpostos from './routes/impostos.js';
import rotasImportacoes from './routes/importacoes.js';
import rotasAnexos from './routes/anexos.js';
import rotasFinanceiro from './routes/financeiro.js';
import rotasRelatorios from './routes/relatorios.js';
import rotasAuditoria from './routes/auditoria.js';
import rotasAdmin from './routes/admin.js';
import rotasAjuda from './routes/ajuda.js';
import rotasCaixa from './routes/caixa.js';

/**
 * Enquanto o assistente de primeiro acesso não tiver sido encerrado, quem
 * entra cai nele em vez de num sistema vazio. Vale só para navegação normal:
 * POST, requisição de dados e troca de senha passam direto.
 *
 * O estado só muda uma vez na vida da instalação, então basta lembrar dele
 * em memória — depois de concluído, nenhuma consulta a mais acontece.
 */
let assistenteEncerrado = false;

async function levarAoAssistente(req, res, next) {
  if (assistenteEncerrado) return next();
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  if (req.path.startsWith('/inicio') || req.path === '/sair' || req.path === '/trocar-senha') {
    return next();
  }

  try {
    const { assistenteConcluido } = await import('./services/onboarding.js');
    if (await assistenteConcluido()) {
      assistenteEncerrado = true;
      return next();
    }
    return res.redirect('/inicio');
  } catch {
    // Banco indisponível não pode virar tela branca: segue o fluxo normal e
    // o erro aparece na própria página, com mensagem.
    return next();
  }
}

export function criarApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.set('trust proxy', 1); // atras de nginx/Cloudflare em producao

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/estatico',
    express.static(path.join(ROOT, 'src', 'public'), {
      // Endereco com impressao digital (?v=) e imutavel: pode ficar guardado
      // para sempre. Sem marca, o navegador precisa reconferir.
      setHeaders(res, _caminho, _stat) {
        const versionado = res.req.query && res.req.query.v;
        res.setHeader(
          'Cache-Control',
          versionado ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'
        );
      },
    })
  );

  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ pool, tableName: 'sessoes', createTableIfMissing: false }),
      name: 'shkt.sid',
      secret: config.sessao.segredo,
      resave: false,
      saveUninitialized: false,
      rolling: true, // renova a sessao a cada acao do usuario
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.sessao.seguro,
        maxAge: config.sessao.duracaoHoras * 3600 * 1000,
      },
    })
  );

  // Variaveis disponiveis em todas as telas
  app.use((req, res, next) => {
    res.locals.f = formato;
    res.locals.ic = icone;
    res.locals.sprite = SPRITE;
    res.locals.estatico = estatico;
    res.locals.empresa = config.empresa;
    res.locals.caminho = req.path;
    res.locals.query = req.query;
    res.locals.aviso = null;
    res.locals.erro = null;
    res.locals.titulo = 'ERP SHKT';
    res.locals.acoesCabecalho = null;
    // Definidos aqui para que a tela de erro funcione mesmo sem sessão
    res.locals.usuario = null;
    res.locals.pode = () => false;
    res.locals.mensagem = null;

    // Mensagens de uma tela para outra (padrao POST -> redirect -> GET)
    if (req.session?.mensagem) {
      res.locals.mensagem = req.session.mensagem;
      delete req.session.mensagem;
    }
    if (req.session?.mensagemErro) {
      res.locals.erro = req.session.mensagemErro;
      delete req.session.mensagemErro;
    }

    // Atalho usado pelos controladores para avisar o usuario apos um redirect
    res.avisar = (texto, tipo = 'ok') => {
      req.session.mensagem = { texto, tipo };
    };
    res.avisarErro = (texto) => {
      req.session.mensagemErro = texto;
    };

    next();
  });

  app.use(injetarUsuario);

  // Rotas publicas
  app.use('/', rotasAuth);

  // Rotas protegidas
  app.use('/inicio', exigirLogin, rotasInicio);
  app.use(exigirLogin, levarAoAssistente);
  app.use('/', rotasPainel);
  app.use('/cadastros', exigirLogin, rotasCadastros);
  app.use('/estoque', exigirLogin, rotasEstoque);
  app.use('/fumigacao', exigirLogin, rotasFumigacao);
  app.use('/certificados', exigirLogin, rotasCertificados);
  app.use('/carregamentos', exigirLogin, rotasCarregamento);
  app.use('/compras', exigirLogin, rotasCompras);
  app.use('/recebimentos', exigirLogin, rotasRecebimentos);
  app.use('/vendas', exigirLogin, rotasVendas);
  app.use('/frota', exigirLogin, rotasFrota);
  app.use('/rh', exigirLogin, rotasRh);
  app.use('/impostos', exigirLogin, rotasImpostos);
  app.use('/importacoes', exigirLogin, rotasImportacoes);
  app.use('/anexos', exigirLogin, rotasAnexos);
  app.use('/financeiro', exigirLogin, rotasFinanceiro);
  app.use('/caixa', exigirLogin, rotasCaixa);
  app.use('/relatorios', exigirLogin, rotasRelatorios);
  app.use('/auditoria', exigirLogin, rotasAuditoria);
  app.use('/admin', exigirLogin, rotasAdmin);
  app.use('/ajuda', exigirLogin, rotasAjuda);

  // 404
  app.use((req, res) => {
    res.status(404).render('erro', {
      titulo: 'Página não encontrada',
      status: 404,
      mensagem: 'A página que você tentou acessar não existe.',
      detalhes: req.originalUrl,
    });
  });

  // Tratamento central de erros
  app.use((erro, req, res, _next) => {
    const negocio = erro instanceof ErroNegocio || erro.negocio;
    const status = negocio ? erro.status || 422 : 500;

    if (!negocio) {
      console.error('[erro]', req.method, req.originalUrl, '\n', erro);
    }

    if (req.accepts('html')) {
      // Erros de regra voltam para a tela anterior com a mensagem visivel
      const voltarPara = req.get('referer');
      if (negocio && voltarPara && req.method === 'POST') {
        req.session.mensagemErro = erro.message;
        return req.session.save(() => res.redirect(voltarPara));
      }
      return res.status(status).render('erro', {
        titulo: negocio ? 'Operação não permitida' : 'Erro no sistema',
        status,
        mensagem: negocio
          ? erro.message
          : 'Ocorreu um erro inesperado. A operação não foi concluída e nada foi alterado.',
        detalhes: negocio ? null : config.env === 'development' ? erro.stack : null,
      });
    }

    res.status(status).json({ erro: negocio ? erro.message : 'Erro interno do servidor.' });
  });

  return app;
}

/**
 * Conferencia de partida: mostra a que banco o sistema se conectou e o que
 * encontrou nele. Em uma hospedagem, é isso que diferencia "no ar" de "no ar,
 * apontando para o banco certo, com os dados carregados" - sem precisar abrir
 * a tela para descobrir.
 */
async function conferirBanco() {
  const { um } = await import('./db/index.js');
  const r = await um(`
    SELECT (SELECT COUNT(*)::INT FROM usuarios)  AS usuarios,
           (SELECT COUNT(*)::INT FROM perfis)    AS perfis,
           (SELECT COUNT(*)::INT FROM produtos)  AS produtos,
           current_database()                    AS banco
  `);

  console.log(`  Banco "${r.banco}": ${r.usuarios} usuário(s), ${r.perfis} perfil(is), ${r.produtos} produto(s)`);

  if (r.usuarios === 0) {
    console.warn(
      '  ATENÇÃO: nenhum usuário cadastrado — ninguém consegue entrar.\n' +
        '  Rode a carga inicial: node src/db/seed.js'
    );
  }
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (executadoDiretamente) {
  fs.mkdirSync(config.uploads.diretorio, { recursive: true });

  const app = criarApp();
  app.listen(config.porta, '0.0.0.0', async () => {
    console.log(`\n  ERP SHKT no ar em http://localhost:${config.porta}`);
    console.log(`  Ambiente: ${config.env}`);
    try {
      await conferirBanco();
    } catch (e) {
      // Não derruba o servidor: ele sobe e a tela mostra o erro de banco
      console.error(`  Não foi possível consultar o banco: ${e.message}`);
    }
    console.log('');
  });
}

export default criarApp;
