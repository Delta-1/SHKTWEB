import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {prepararBanco,query,um,transacao,referencias,usuarioTeste,encerrar,limparOperacional} from './ambiente.js';
import * as rascunhos from '../src/services/rascunhos.js';
import * as documentos from '../src/services/documentos.js';
import * as compras from '../src/services/compras.js';
import {carregar as carregarFluxo} from '../src/services/fluxo.js';
import {criarApp} from '../src/server.js';
import {gerarHash} from '../src/lib/auth.js';
let usuario,ref,servidor,base,cookie;
const dadosCompra=()=>({data:'2026-10-26',fornecedorId:ref.fornecedorId,localEntregaId:ref.localId,tipo:'MERCADORIA',moeda:'BRL',itens:[{produtoId:ref.produtoId,descricao:'Milho',quantidade:'100',unidadeId:ref.tonId,precoUnitario:'1500'}]});
before(async()=>{
 await prepararBanco();usuario=await usuarioTeste();ref=await referencias();
 await query('UPDATE usuarios SET trocar_senha=false,senha_hash=$1 WHERE id=$2',[await gerarHash('SenhaTeste123!'),usuario.id]);
 await query(`INSERT INTO parametros(chave,valor,grupo) VALUES('onboarding.concluido','sim','SISTEMA') ON CONFLICT(chave) DO UPDATE SET valor='sim'`);
 servidor=criarApp().listen(0,'127.0.0.1');await new Promise(r=>servidor.once('listening',r));base=`http://127.0.0.1:${servidor.address().port}`;
 const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:usuario.email,senha:'SenhaTeste123!'})});
 assert.equal(login.status,302);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(r=>servidor.close(r));await encerrar();});
beforeEach(async()=>{await query('TRUNCATE tarefas_documentos,rascunhos_formulario');await limparOperacional();});
const api=(url,options={})=>fetch(base+url,{redirect:'manual',...options,headers:{Cookie:cookie,Accept:'application/json',...options.headers}});

test('rascunho não cria estoque nem financeiro; versão concorrente é rejeitada',async()=>{
 const chave=rascunhos.validarAcesso(usuario,'compras','novo');
 const a=await rascunhos.salvar(usuario.id,chave,{campos:{fornecedor:'1'}},0);
 const tentativas=await Promise.allSettled([rascunhos.salvar(usuario.id,chave,{campos:{x:'A'}},a.versao),rascunhos.salvar(usuario.id,chave,{campos:{x:'B'}},a.versao)]);
 assert.equal(tentativas.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(tentativas.find(r=>r.status==='rejected').reason.status,409);
 assert.equal((await um('SELECT count(*)::int n FROM estoque_movimentos')).n,0);
 assert.equal((await um('SELECT count(*)::int n FROM contas_pagar')).n,0);
 const atual=await rascunhos.buscar(usuario.id,chave);
 await rascunhos.remover(usuario.id,chave,a.versao);assert.ok(await rascunhos.buscar(usuario.id,chave),'versão antiga não apaga o novo rascunho');
 await rascunhos.remover(usuario.id,chave,atual.versao);assert.equal(await rascunhos.buscar(usuario.id,chave),null);
});
test('rascunhos verificam permissão de edição e ficam isolados por usuário',async()=>{
 assert.throws(()=>rascunhos.validarAcesso({permissoes:['compras.visualizar']},'compras','novo'),{status:403});
 assert.throws(()=>rascunhos.validarAcesso({permissoes:['compras.criar']},'compras','12-editar'),{status:403});
 const a=await rascunhos.salvar(usuario.id,'compras:novo',{campos:{nome:'teste'}},0);
 assert.equal(await rascunhos.buscar(-1,'compras:novo'),null);
 await assert.rejects(rascunhos.salvar(usuario.id,'compras:novo',{},0),{status:409});
 await assert.rejects(rascunhos.salvar(usuario.id,'compras:novo',{texto:'a'.repeat(100001)},a.versao),{status:413});
});
test('HTTP grava e recupera rascunho em JSON; origem externa é bloqueada',async()=>{
 const r=await api('/rascunhos/compras/novo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({dados:{campos:{'observacoes#0':'recuperável'}},versao:0})});assert.equal(r.status,200);
 const consulta=await api('/rascunhos/compras/novo');assert.equal((await consulta.json()).rascunho.dados.campos['observacoes#0'],'recuperável');
 assert.equal((await api('/rascunhos/compras/novo',{method:'PUT',headers:{Origin:'https://externo.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
test('gravação de negócio limpa apenas a revisão enviada do rascunho',async()=>{
 const salvo=await rascunhos.salvar(usuario.id,'compras:novo',{campos:{teste:'ok'}},0);
 const body=new URLSearchParams({data:'2026-10-26',fornecedor_id:String(ref.fornecedorId),local_entrega_id:String(ref.localId),tipo:'MERCADORIA',moeda:'BRL',item_produto_id:String(ref.produtoId),item_descricao:'Milho',item_quantidade:'100',item_unidade_id:String(ref.tonId),item_preco:'1500',_rascunho_chave:'compras:novo',_rascunho_versao:String(salvo.versao)});
 const r=await api('/compras/novo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});assert.equal(r.status,302);
 assert.equal(await rascunhos.buscar(usuario.id,'compras:novo'),null);
 assert.equal((await um('SELECT count(*)::int n FROM pedidos_compra')).n,1);
});
test('pedido inválido mantém o rascunho recuperável',async()=>{
 const salvo=await rascunhos.salvar(usuario.id,'compras:novo',{campos:{teste:'ok'}},0);
 const r=await api('/compras/novo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_rascunho_chave:'compras:novo',_rascunho_versao:String(salvo.versao)})});
 assert.equal(r.status,422);assert.ok(await rascunhos.buscar(usuario.id,'compras:novo'));
});
test('PDFs são idempotentes por versão do documento e têm autorização',async()=>{
 const p=await compras.criar(dadosCompra(),usuario);
 const [a,b]=await Promise.all([documentos.solicitar('compras',p.id,usuario),documentos.solicitar('compras',p.id,usuario)]);assert.equal(a.id,b.id);
 await assert.rejects(documentos.solicitar('compras',p.id,{...usuario,permissoes:[]}),{status:403});
 await assert.rejects(documentos.buscar(a.id,{...usuario,id:-1}),{status:404});
 await compras.enviarParaAprovacao(p.id,usuario);
 const novo=await documentos.solicitar('compras',p.id,usuario);assert.notEqual(novo.id,a.id);
});
test('fila com dois trabalhadores não reserva o mesmo trabalho; lease vencida é recuperada',async()=>{
 const p=await compras.criar(dadosCompra(),usuario);const a=await documentos.solicitar('compras',p.id,usuario);
 const [x,y]=await Promise.all([documentos.reservar(),documentos.reservar()]);assert.equal([x,y].filter(Boolean).length,1);
 const primeiro=x||y;assert.equal(primeiro.id,a.id);
 await query(`UPDATE tarefas_documentos SET iniciado_em=now()-interval '6 minutes' WHERE id=$1`,[a.id]);
 const retomado=await documentos.reservar();assert.equal(retomado.id,a.id);assert.notEqual(retomado.token,primeiro.token);
 const {rowCount}=await query(`UPDATE tarefas_documentos SET erro='token antigo' WHERE id=$1 AND token=$2`,[a.id,primeiro.token]);assert.equal(rowCount,0);
});
test('trabalho gera PDF real persistido, sem alterar a operação',async()=>{
 const p=await compras.criar(dadosCompra(),usuario);const a=await documentos.solicitar('compras',p.id,usuario);
 assert.equal((await um('SELECT dados FROM tarefas_documentos WHERE id=$1',[a.id])).dados.itens[0].quantidade,'100,000');
 assert.equal(await documentos.processarUma(),true);
 const t=await documentos.buscar(a.id,usuario,true);assert.equal(t.status,'CONCLUIDO');assert.equal(t.arquivo.subarray(0,4).toString(),'%PDF');
 assert.equal((await compras.buscar(p.id)).status,'RASCUNHO');assert.equal((await um('SELECT count(*)::int n FROM contas_pagar')).n,0);
 const download=await api(`/documentos/${a.id}/baixar`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
});
test('fila tenta três vezes, informa falha e permite reprocessar',async()=>{
 const p=await compras.criar(dadosCompra(),usuario);const a=await documentos.solicitar('compras',p.id,usuario);
 for(let i=0;i<3;i++){await documentos.processarUma({gerar:async()=>{throw new Error('falha simulada');}});await query('UPDATE tarefas_documentos SET disponivel_em=now() WHERE id=$1',[a.id]);}
 assert.equal((await documentos.buscar(a.id,usuario)).status,'FALHOU');
 await documentos.tentarNovamente(a.id,usuario);assert.equal((await documentos.buscar(a.id,usuario)).status,'PENDENTE');
});
test('anexo é armazenado no banco e pode ser baixado sem disco local',async()=>{
 const p=await compras.criar(dadosCompra(),usuario);const form=new FormData();const conteudo=Buffer.from('%PDF-1.4\nTeste de comprovante');form.append('arquivo',new Blob([conteudo],{type:'application/pdf'}),'comprovante.pdf');
 const r=await api(`/anexos/COMPRA/${p.id}`,{method:'POST',body:form});assert.equal(r.status,201,await r.text());
 const a=await um('SELECT id,conteudo,caminho FROM anexos WHERE entidade_tipo=$1 AND entidade_id=$2',['COMPRA',p.id]);assert.deepEqual(a.conteudo,conteudo);assert.match(a.caminho,/^db:/);
 const baixar=await api(`/anexos/arquivo/COMPRA/${a.id}`);assert.deepEqual(Buffer.from(await baixar.arrayBuffer()),conteudo);
});
test('central consulta dados reais e as páginas principais respondem',async()=>{
 const fluxo=await carregarFluxo(usuario);assert.equal(fluxo.etapas.length,8);
 const restrito=await carregarFluxo({...usuario,permissoes:['dashboard.visualizar','compras.visualizar']});assert.equal(restrito.etapas.length,1);
 for(const url of ['/fluxo','/documentos','/compras/novo','/vendas/novo','/fumigacao/novo','/carregamentos/novo','/financeiro/pagar/novo','/frota/viagens/nova','/rh/nova','/impostos/nova']){
  const r=await api(url,{headers:{Accept:'text/html'}});assert.equal(r.status,200,url+': '+(await r.text()).slice(0,120));
 }
});

test('papel do servidor usa RLS sem privilégios de administração',async()=>{
 const role=await um("SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='shkt_backend'");
 assert.deepEqual(role,{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false});
 await transacao(async cx=>{
  await cx.query('SET LOCAL ROLE shkt_backend');
  const {rows:[r]}=await cx.query('SELECT count(*)::int n FROM usuarios');assert.ok(r.n>0);
  await cx.query("INSERT INTO rascunhos_formulario(usuario_id,chave,dados) VALUES($1,'compras:papel_teste','{}')",[usuario.id]);
  await cx.query("DELETE FROM rascunhos_formulario WHERE usuario_id=$1 AND chave='compras:papel_teste'",[usuario.id]);
 });
});
