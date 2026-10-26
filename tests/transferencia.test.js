import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {migrarCadastros} from '../scripts/verificar-origem.js';
const url=new URL(process.env.TEST_DATABASE_URL||'postgres://shkt:shkt@127.0.0.1:5432/shkt_erp_test');
const administrador=new pg.Client({connectionString:url.toString()});
const sufixo=crypto.randomBytes(4).toString('hex');
const nomes=['shkt_origem_'+sufixo,'shkt_destino_'+sufixo];
let origem,destino;
function preparar(nome){return new Promise((resolve,reject)=>{
 const u=new URL(url);u.pathname='/'+nome;
 const p=spawn(process.execPath,['scripts/preparar-banco.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:u.toString(),SHKT_SUPABASE_URL:''},stdio:['ignore','pipe','pipe']});
 let saida='';p.stdout.on('data',c=>saida+=c);p.stderr.on('data',c=>saida+=c);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(saida)));
});}
before(async()=>{
 await administrador.connect();for(const nome of nomes){await administrador.query(`CREATE DATABASE ${nome}`);await preparar(nome);}
 const a=new URL(url),b=new URL(url);a.pathname='/'+nomes[0];b.pathname='/'+nomes[1];origem=new pg.Client({connectionString:a.toString()});destino=new pg.Client({connectionString:b.toString()});await origem.connect();await destino.connect();
 await destino.query('GRANT UPDATE ON ALL SEQUENCES IN SCHEMA public TO shkt_backend');
 await destino.query('SET ROLE shkt_backend');
 const {rows:[antigoPerfil]}=await destino.query("SELECT id FROM perfis WHERE codigo='ADMIN'");
 const {rows:[novoPerfil]}=await destino.query("INSERT INTO perfis(codigo,nome) VALUES('ADMIN-TEMP','Administrador') RETURNING id");
 await destino.query('INSERT INTO perfil_permissoes(perfil_id,permissao) SELECT $1,permissao FROM perfil_permissoes WHERE perfil_id=$2',[novoPerfil.id,antigoPerfil.id]);
 await destino.query('UPDATE usuarios SET perfil_id=$1 WHERE perfil_id=$2',[novoPerfil.id,antigoPerfil.id]);
 await destino.query('DELETE FROM perfil_permissoes WHERE perfil_id=$1',[antigoPerfil.id]);await destino.query('DELETE FROM perfis WHERE id=$1',[antigoPerfil.id]);
 await destino.query("UPDATE perfis SET codigo='ADMIN' WHERE id=$1",[novoPerfil.id]);
 await origem.query("INSERT INTO parceiros(codigo,razao_social,is_fornecedor,criado_por) VALUES('MIG-01','Fornecedor de origem',true,1)");
 await origem.query("INSERT INTO auditoria(usuario_id,usuario_nome,acao,modulo,descricao) VALUES(1,'Usuário original','CRIAR','cadastros','Cadastro original preservado')");
 await origem.query("UPDATE parametros SET valor='EMPRESA DE ORIGEM' WHERE chave='empresa.nome'");
});
after(async()=>{await origem?.end();await destino?.end();for(const nome of nomes)await administrador.query(`DROP DATABASE ${nome}`);await administrador.end();});
test('transfere cadastro e acesso; preserva salvaguarda e mantém a origem intacta',async()=>{
 const antes=(await destino.query('SELECT senha_hash FROM usuarios WHERE id=1')).rows[0].senha_hash;
 await migrarCadastros(origem,destino);
 assert.equal((await destino.query("SELECT count(*)::int n FROM parceiros WHERE codigo='MIG-01'")).rows[0].n,1);
 assert.equal((await origem.query("SELECT count(*)::int n FROM parceiros WHERE codigo='MIG-01'")).rows[0].n,1);
 assert.equal((await destino.query("SELECT count(*)::int n FROM auditoria WHERE descricao='Cadastro original preservado'")).rows[0].n,1);
 assert.equal((await destino.query("SELECT valor FROM parametros WHERE chave='empresa.nome'")).rows[0].valor,'EMPRESA DE ORIGEM');
 const a=(await origem.query('SELECT senha_hash FROM usuarios WHERE id=1')).rows[0].senha_hash;
 assert.equal((await destino.query('SELECT senha_hash FROM usuarios WHERE id=1')).rows[0].senha_hash,a);
 const s=(await destino.query('SELECT * FROM shkt_transferencia.salvaguardas')).rows[0];assert.ok(s.concluido);assert.equal(s.dados_destino.usuarios[0].senha_hash,antes);
 await migrarCadastros(origem,destino);assert.equal((await destino.query('SELECT count(*)::int n FROM parceiros')).rows[0].n,1);
});
test('impede transferência automática se houver operações',async()=>{
 await destino.query('UPDATE shkt_transferencia.salvaguardas SET concluido=false');
 await origem.query("INSERT INTO pedidos_compra(numero,fornecedor_id) VALUES('MIG-0001',1)");
 await assert.rejects(migrarCadastros(origem,destino),/possui operações/);
 assert.equal((await destino.query('SELECT count(*)::int n FROM pedidos_compra')).rows[0].n,0);
});
