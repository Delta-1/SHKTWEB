import { Router } from 'express';
import * as rascunhos from '../services/rascunhos.js';
const router=Router();
router.get('/',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json({rascunhos:await rascunhos.listar(req.usuario)});}catch(e){next(e);}});
router.use('/:modulo/:chave',(req,res,next)=>{try{
 req.chaveRascunho=rascunhos.validarAcesso(req.usuario,req.params.modulo,req.params.chave);next();
}catch(e){next(e);}});
router.get('/:modulo/:chave',async(req,res,next)=>{try{
 res.set('Cache-Control','no-store').json({rascunho:await rascunhos.buscar(req.usuario.id,req.chaveRascunho)});
}catch(e){next(e);}});
router.put('/:modulo/:chave',async(req,res,next)=>{try{
 res.json({salvo:true,...await rascunhos.salvar(req.usuario.id,req.chaveRascunho,req.body?.dados,req.body?.versao)});
}catch(e){next(e);}});
router.delete('/:modulo/:chave',async(req,res,next)=>{try{
 await rascunhos.remover(req.usuario.id,req.chaveRascunho,Number(req.body.versao));res.json({removido:true});
}catch(e){next(e);}});
export default router;
