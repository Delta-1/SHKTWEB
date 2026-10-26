import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const url=process.env.SHKT_SUPABASE_URL||process.env.DATABASE_URL;
if(!url)throw new Error('Configure DATABASE_URL para fazer o backup.');
const conexao=new URL(url);
const pasta=path.resolve(process.env.BACKUP_DIR||'backups');
await fs.mkdir(pasta,{recursive:true});
const arquivo=path.join(pasta,`shkt-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
const env={...process.env,PGHOST:conexao.hostname,PGPORT:conexao.port||'5432',PGUSER:decodeURIComponent(conexao.username),PGPASSWORD:decodeURIComponent(conexao.password),PGDATABASE:conexao.pathname.slice(1)};
if(/supabase\.(co|com)$/.test(conexao.hostname))env.PGSSLMODE='require';
function executar(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env,stdio:['ignore','ignore','pipe']});let erro='';p.stderr.on('data',c=>erro+=c);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`Falha no ${cmd}: ${erro.replaceAll(url,'[conexão]')}`)));});}
try{
 await executar('pg_dump',['--format=custom','--file',arquivo]);
 await executar('pg_restore',['--list',arquivo]);
 const retencao=Math.max(1,Number(process.env.RETENCAO_DIAS)||30)*86400000;
 for(const nome of await fs.readdir(pasta)){if(!/^shkt-.*\.dump$/.test(nome)||nome===path.basename(arquivo))continue;const p=path.join(pasta,nome);if(Date.now()-(await fs.stat(p)).mtimeMs>retencao)await fs.unlink(p);}
 await fs.appendFile(path.join(pasta,'backups.log'),`${new Date().toISOString()} | OK | ${path.basename(arquivo)} | índice verificado\n`);
 console.log(`Backup gerado e verificado: ${arquivo}`);
}catch(e){await fs.rm(arquivo,{force:true});console.error(e.message);process.exitCode=1;}
