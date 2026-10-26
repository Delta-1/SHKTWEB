/* O banco é a fonte do rascunho. Nenhum dado operacional fica no localStorage. */
(function(){
 'use strict';
 function submitterSeguro(e){return e.submitter||undefined;}
 const form=document.querySelector('form[data-rascunho]');
 if(!form)return;
 const modulo=form.dataset.rascunho;
 const acao=new URL(form.action,location.href);
 const chave=acao.pathname.split('/').slice(2).join('-')||'novo';
 const url='/rascunhos/'+encodeURIComponent(modulo)+'/'+encodeURIComponent(chave);
 const barra=document.createElement('div');barra.className='rascunho-barra';
 const estado=document.createElement('span');estado.setAttribute('role','status');estado.textContent='Carregando rascunho…';
 barra.append(estado);form.prepend(barra);
 let versao=0,carregado=false,indisponivel=false,alteracao=0,salva=0,timer,salvando=null,conflito=false,submetendo=false;
 function oculto(nome,valor){let el=form.querySelector('input[name="'+nome+'"]');if(!el){el=document.createElement('input');el.type='hidden';el.name=nome;form.append(el);}el.value=valor;}
 function campos(){return Array.from(form.querySelectorAll('input[name],select[name],textarea[name]'))
  .filter(el=>!['password','file','submit','button'].includes(el.type)&&!el.name.startsWith('_')&&!el.disabled);}
 function ler(){
  const contagem={},valores={};
  for(const el of campos()){const i=contagem[el.name]||0;contagem[el.name]=i+1;
   valores[el.name+'#'+i]=['checkbox','radio'].includes(el.type)?el.checked:el.value;}
  const linhas={};form.querySelectorAll('table[data-linhas]').forEach(t=>{linhas[t.dataset.linhas]=t.tBodies[0]?.rows.length||0;});
  return {campos:valores,linhas,etapa:Number(form.dataset.etapaAtual||0),url:location.pathname+location.search,titulo:document.title};
 }
 function preencher(dados){
  for(const [nome,n] of Object.entries(dados.linhas||{})){
   const tabela=Array.from(form.querySelectorAll('table[data-linhas]')).find(t=>t.dataset.linhas===nome);
   if(!tabela?.tBodies[0]||!Number.isInteger(n)||n<1||n>200)continue;
   const corpo=tabela.tBodies[0],modelo=corpo.rows[0]?.cloneNode(true);if(!modelo)continue;
   while(corpo.rows.length>n)corpo.deleteRow(-1);
   while(corpo.rows.length<n)corpo.append(modelo.cloneNode(true));
  }
  const valores=dados.campos||dados,contagem={};
  for(const el of campos()){
   const i=contagem[el.name]||0;contagem[el.name]=i+1;const v=valores[el.name+'#'+i];
   if(v===undefined)continue;if(['checkbox','radio'].includes(el.type))el.checked=Boolean(v);else el.value=String(v);
  }
  // Recalcular só depois de restaurar TODOS os campos (não sobrescrever preços/linhas).
  form.dispatchEvent(new CustomEvent('rascunho-restaurado',{bubbles:true,detail:{etapa:dados.etapa||0}}));
 }
 function agendar(){clearTimeout(timer);if(!conflito)timer=setTimeout(()=>salvar().catch(()=>{}),1600);}
 async function salvar(){
  if(!carregado||conflito||salva===alteracao)return;
  if(salvando){await salvando;if(salva!==alteracao)return salvar();return;}
  const atual=alteracao,dados=ler();estado.textContent='Salvando…';
  salvando=(async()=>{
   const r=await fetch(url,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({dados,versao})});
   const body=await r.json();if(!r.ok){if(r.status===409)conflito=true;throw new Error(body.erro||'Não foi possível salvar.');}
   versao=body.versao;salva=atual;oculto('_rascunho_versao',versao);estado.textContent='Rascunho salvo · pode continuar depois';
  })();
  try{await salvando;}catch(e){estado.textContent=conflito?e.message:'Sem conexão. Mantenha esta tela aberta para salvar.';throw e;}
  finally{salvando=null;if(salva!==alteracao&&!conflito&&!submetendo)agendar();}
 }
 function mudou(){if(carregado&&!submetendo){alteracao++;estado.textContent='Alterações pendentes…';agendar();}}
 form.addEventListener('input',mudou);form.addEventListener('change',mudou);form.addEventListener('etapa-alterada',mudou);
 form.addEventListener('click',ev=>{if(ev.target.closest('[data-adicionar-linha],[data-remover-linha]'))setTimeout(mudou,0);});
 window.addEventListener('online',()=>salvar().catch(()=>{}));
 window.addEventListener('beforeunload',e=>{if(salva!==alteracao&&!submetendo){e.preventDefault();e.returnValue='';}});
 form.addEventListener('submit',async e=>{
  if(submetendo)return;
  e.preventDefault();clearTimeout(timer);
  if(indisponivel){submetendo=true;form.requestSubmit(submitterSeguro(e));return;}
  if(!carregado||conflito){estado.textContent=conflito?'Recarregue antes de gravar: outra aba alterou o rascunho.':'Aguarde o carregamento do rascunho.';return;}
  const submitter=e.submitter;submetendo=true;
  try{await salvar();oculto('_rascunho_chave',modulo+':'+chave);oculto('_rascunho_versao',versao);
   form.requestSubmit(submitter||undefined);
  }catch{ // O servidor ainda pode gravar mesmo com autosave indisponível; o formulário permanece íntegro.
   submetendo=false;estado.textContent+=' Tente novamente antes de gravar.';
  }
 });
 fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}}).then(async r=>{if(!r.ok)throw new Error();return r.json();})
 .then(r=>{
  versao=r.rascunho?.versao||0;
  const dados=r.rascunho?.dados;
  if(dados&&Object.keys(dados).length){
   const restaurar=document.createElement('button');restaurar.type='button';restaurar.className='btn pequeno';restaurar.textContent='Continuar rascunho';
   restaurar.onclick=()=>{preencher(dados);restaurar.remove();estado.textContent='Rascunho recuperado';};barra.append(restaurar);
   estado.textContent='Há um rascunho salvo em '+new Date(r.rascunho.atualizado_em).toLocaleString('pt-BR');
  }else estado.textContent='Salvamento automático ativo';
  carregado=true;
 }).catch(()=>{indisponivel=true;estado.textContent='Salvamento automático indisponível. Use Gravar ao concluir.';});
})();
