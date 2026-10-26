import { Router } from 'express';
import { exigir } from '../lib/auth.js';
const router = Router();
router.get('/', exigir('dashboard.visualizar'), (req, res) => {
  res.render('fluxo/index', { titulo: 'Fluxo de operações SHKT' });
});
export default router;
