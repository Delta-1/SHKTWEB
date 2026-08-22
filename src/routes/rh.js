import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as validar from '../lib/validar.js';
import * as rh from '../services/rh.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router=Router();
const ctx=req=>({ip:req.ip,sessao:req.sessionID});
const dinheiro=(v,n)=>validar.dinheiro(v||'0',n,{obrigatorio:true,min:0});

router.get('/',exigir('rh.visualizar'),async(req,res,next)=>{try{
  res.render('rh/lista',{titulo:'RH e folha de pagamento',folhas:await rh.listarFolhas()});
}catch(e){next(e);}});
router.get('/nova',exigir('rh.criar'),async(req,res,next)=>{try{
  res.render('rh/form',{titulo:'Nova folha',ref:await carregar(['operacoes','moedas']),hoje:hojeISO()});
}catch(e){next(e);}});
router.post('/nova',exigir('rh.criar'),async(req,res,next)=>{try{
  const folha=await rh.criarFolha({competencia:validar.data(req.body.competencia,'Competência',{obrigatorio:true}),
    vencimento:validar.data(req.body.vencimento,'Vencimento',{obrigatorio:true}),
    operacaoId:validar.id(req.body.operacao_id,'Operação',{obrigatorio:true}),
    moedaId:validar.id(req.body.moeda_id,'Moeda',{obrigatorio:true}),
    observacoes:validar.texto(req.body.observacoes,'Observações')},req.usuario,ctx(req));
  res.avisar('Folha criada. Agora inclua os funcionários e confira os valores.');
  req.session.save(()=>res.redirect(`/rh/${folha.id}`));
}catch(e){next(e);}});
router.get('/:id',exigir('rh.visualizar'),async(req,res,next)=>{try{
  const [folha,ref]=await Promise.all([rh.buscarFolha(req.params.id),carregar(['funcionarios'])]);
  if(!folha) throw new ErroNaoEncontrado('Folha não encontrada.');
  res.render('rh/detalhe',{titulo:`Folha ${folha.numero}`,folha,ref});
}catch(e){next(e);}});
router.post('/:id/funcionarios',exigir('rh.editar'),async(req,res,next)=>{try{
  await rh.adicionarFuncionario(req.params.id,{funcionarioId:validar.id(req.body.funcionario_id,'Funcionário',{obrigatorio:true}),
    salarioBase:dinheiro(req.body.salario_base,'Salário-base'),horasExtras:dinheiro(req.body.horas_extras,'Horas extras'),
    adicionais:dinheiro(req.body.adicionais,'Adicionais'),comissoes:dinheiro(req.body.comissoes,'Comissões'),
    outrosProventos:dinheiro(req.body.outros_proventos,'Outros proventos'),
    adiantamentos:dinheiro(req.body.adiantamentos,'Adiantamentos'),inss:dinheiro(req.body.inss,'INSS'),
    outrosDescontos:dinheiro(req.body.outros_descontos,'Outros descontos'),
    observacoes:validar.texto(req.body.observacoes,'Observações')},req.usuario,ctx(req));
  res.avisar('Funcionário incluído na folha.'); req.session.save(()=>res.redirect(`/rh/${req.params.id}`));
}catch(e){next(e);}});
router.post('/:id/fechar',exigir('rh.aprovar'),async(req,res,next)=>{try{
  await rh.fecharFolha(req.params.id,req.usuario,ctx(req));res.avisar('Folha fechada e títulos gerados no Contas a Pagar.');
  req.session.save(()=>res.redirect(`/rh/${req.params.id}`));
}catch(e){next(e);}});
router.post('/:id/cancelar',exigir('rh.cancelar'),async(req,res,next)=>{try{
  const motivo=validar.texto(req.body.motivo,'Motivo',{obrigatorio:true,min:5});
  await rh.cancelarFolha(req.params.id,motivo,req.usuario,ctx(req));res.avisar('Folha cancelada; o histórico foi preservado.');
  req.session.save(()=>res.redirect(`/rh/${req.params.id}`));
}catch(e){next(e);}});
export default router;
