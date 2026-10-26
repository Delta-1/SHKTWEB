(function(){
 'use strict';
 document.addEventListener('click',async e=>{
  const botao=e.target.closest('[data-gerar-pdf]');if(!botao)return;e.preventDefault();
  botao.disabled=true;const texto=botao.textContent;botao.textContent='Solicitando…';
  try{const r=await fetch(botao.dataset.gerarPdf,{method:'POST',headers:{Accept:'application/json'}});const data=await r.json();
   if(!r.ok)throw new Error(data.erro||'Não foi possível solicitar.');
   botao.textContent='Ver meus arquivos';botao.disabled=false;botao.removeAttribute('data-gerar-pdf');
   botao.onclick=()=>{location.href='/documentos';};
   if(window.avisar)window.avisar('PDF solicitado. Pode continuar trabalhando.');
  }catch(err){botao.disabled=false;botao.textContent=texto;if(window.avisar)window.avisar(err.message,'erro');}
 });
 const upload=document.querySelector('[data-upload-assincrono]');
 if(upload)upload.addEventListener('submit',e=>{
  e.preventDefault();const botao=upload.querySelector('button'),progresso=upload.querySelector('progress'),estado=upload.querySelector('[data-upload-estado]');
  const xhr=new XMLHttpRequest();xhr.open('POST',upload.action);xhr.setRequestHeader('Accept','application/json');
  botao.disabled=true;progresso.hidden=false;estado.textContent='Enviando arquivo…';
  xhr.upload.onprogress=ev=>{if(ev.lengthComputable)progresso.value=Math.round(ev.loaded/ev.total*100);};
  xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){location.reload();return;}botao.disabled=false;estado.textContent='Não foi possível enviar. Confira o tamanho e a permissão.';};
  xhr.onerror=()=>{botao.disabled=false;estado.textContent='Conexão interrompida. Tente novamente.';};
  xhr.send(new FormData(upload));
 });
 const fila=document.querySelector('[data-fila-documentos]');if(!fila)return;
 async function atualizar(){
  const linhas=Array.from(fila.querySelectorAll('[data-tarefa]')).filter(l=>['PENDENTE','PROCESSANDO'].includes(l.dataset.status));
  if(!linhas.length)return;
  if(!document.hidden){try{
   const r=await fetch('/documentos',{headers:{Accept:'application/json'}});if(!r.ok)throw new Error();const data=await r.json();
   for(const t of data.tarefas){const linha=linhas.find(l=>l.dataset.tarefa===t.id);if(!linha)continue;
    linha.dataset.status=t.status;linha.querySelector('[data-tarefa-status]').textContent={PENDENTE:'Na fila',PROCESSANDO:'Gerando PDF…',CONCLUIDO:'Pronto',FALHOU:'Falhou'}[t.status];
    if(['CONCLUIDO','FALHOU'].includes(t.status)){location.reload();return;}
   }
  }catch{/* retomar quando a conexão voltar */}}
  setTimeout(atualizar,3000);
 }
 setTimeout(atualizar,2000);
})();
