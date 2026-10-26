import {Router} from 'express';
import {exigir} from '../lib/auth.js';
import {carregar} from '../services/fluxo.js';
const router=Router();
router.get('/',exigir('dashboard.visualizar'),async(req,res,next)=>{try{
 res.render('fluxo/index',{titulo:'Operações SHKT',...await carregar(req.usuario)});
}catch(e){next(e);}});
export default router;
