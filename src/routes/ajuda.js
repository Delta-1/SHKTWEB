import { Router } from 'express';

const router = Router();

/**
 * Treinamento somente de leitura. Não consulta nem altera o banco e fica
 * disponível para qualquer pessoa autenticada, independentemente do perfil.
 */
router.get('/tutorial', (_req, res) => {
  res.render('ajuda/tutorial', { titulo: 'Tutorial do fluxo completo' });
});

export default router;
