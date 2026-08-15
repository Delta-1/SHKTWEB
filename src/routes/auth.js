import { Router } from 'express';
import { autenticar, gerarHash, conferirSenha } from '../lib/auth.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { transacao, query, um } from '../db/index.js';
import { ErroNegocio } from '../lib/erros.js';
import * as validar from '../lib/validar.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  res.render('login', {
    titulo: 'Entrar',
    erro: null,
    aviso: req.query.expirou ? 'Sua sessão expirou. Entre novamente.' : null,
    email: '',
    destino: req.query.destino || '',
  });
});

router.post('/login', async (req, res, next) => {
  const { email, senha, destino } = req.body;
  const contexto = { ip: req.ip, sessao: req.sessionID };

  try {
    const usuario = await autenticar(email, senha);

    if (!usuario || usuario.bloqueado) {
      await transacao((cx) =>
        registrar(cx, {
          usuario: { id: null, nome: String(email || '').slice(0, 120) },
          acao: ACOES.LOGIN_FALHOU,
          modulo: 'admin',
          descricao: usuario?.bloqueado
            ? 'Tentativa de acesso com usuário inativo.'
            : 'Tentativa de acesso com credenciais inválidas.',
          ...contexto,
        })
      );

      return res.status(401).render('login', {
        titulo: 'Entrar',
        erro: usuario?.bloqueado
          ? 'Este usuário está inativo. Procure o administrador do sistema.'
          : 'E-mail ou senha incorretos.',
        aviso: null,
        email: email || '',
        destino: destino || '',
      });
    }

    await query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [usuario.id]);
    await transacao((cx) =>
      registrar(cx, {
        usuario,
        acao: ACOES.LOGIN,
        modulo: 'admin',
        registroTipo: 'USUARIO',
        registroId: usuario.id,
        descricao: `Acesso ao sistema por ${usuario.email}.`,
        ...contexto,
      })
    );

    // Renova o id da sessao no login (evita fixacao de sessao)
    req.session.regenerate((erro) => {
      if (erro) return next(erro);
      req.session.usuarioId = usuario.id;
      req.session.save(() => {
        if (usuario.trocar_senha) return res.redirect('/trocar-senha');
        const alvo = destino && destino.startsWith('/') ? destino : '/';
        res.redirect(alvo);
      });
    });
  } catch (e) {
    next(e);
  }
});

router.get('/sair', async (req, res) => {
  if (req.usuario) {
    await transacao((cx) =>
      registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.LOGOUT,
        modulo: 'admin',
        descricao: 'Saída do sistema.',
        ip: req.ip,
        sessao: req.sessionID,
      })
    );
  }
  req.session.destroy(() => res.redirect('/login'));
});

// --------------------------------------------------------------------------
// Troca de senha (obrigatoria no primeiro acesso)
// --------------------------------------------------------------------------

router.get('/trocar-senha', (req, res) => {
  if (!req.usuario) return res.redirect('/login');
  res.render('trocar-senha', {
    titulo: 'Trocar senha',
    obrigatoria: req.usuario.trocar_senha,
  });
});

router.post('/trocar-senha', async (req, res, next) => {
  if (!req.usuario) return res.redirect('/login');

  try {
    const atual = validar.texto(req.body.senha_atual, 'Senha atual', { obrigatorio: true });
    const nova = validar.texto(req.body.senha_nova, 'Nova senha', { obrigatorio: true, min: 8 });
    const confirmacao = validar.texto(req.body.senha_confirmacao, 'Confirmação', { obrigatorio: true });

    if (nova !== confirmacao) throw new ErroNegocio('A nova senha e a confirmação não conferem.');
    if (nova === atual) throw new ErroNegocio('A nova senha deve ser diferente da atual.');

    const registro = await um('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!(await conferirSenha(atual, registro.senha_hash)))
      throw new ErroNegocio('A senha atual está incorreta.');

    const hash = await gerarHash(nova);
    await transacao(async (cx) => {
      await cx.query(
        'UPDATE usuarios SET senha_hash = $1, trocar_senha = FALSE, atualizado_por = $2 WHERE id = $2',
        [hash, req.usuario.id]
      );
      await registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.ALTERAR,
        modulo: 'admin',
        registroTipo: 'USUARIO',
        registroId: req.usuario.id,
        descricao: 'Senha alterada pelo próprio usuário.',
        ip: req.ip,
        sessao: req.sessionID,
      });
    });

    res.avisar('Senha alterada com sucesso.');
    req.session.save(() => res.redirect('/'));
  } catch (e) {
    next(e);
  }
});

export default router;
