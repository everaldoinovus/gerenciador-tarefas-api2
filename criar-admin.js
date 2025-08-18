// Arquivo: criar-admin.js

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// --- CONFIGURE SUAS CREDENCIAIS DO BANCO DE DADOS AQUI ---
// (Use as mesmas que sua aplicação usa, que provavelmente estão em .env ou config)
const dbConfig = {
    host: 'gerenciador-tarefas-db.c74i8icosmty.us-east-2.rds.amazonaws.com',
    user: 'admin',
    password: 'M4st3r23db', // Senha vazia
    database: 'gerenciador_tarefas_db',
};
// ---------------------------------------------------------

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function criarAdmin() {
    console.log('--- Criação do Primeiro Usuário Administrador ---');

    const email = await new Promise(resolve => {
        rl.question('Digite o email do administrador: ', resolve);
    });

    const senha = await new Promise(resolve => {
        rl.question('Digite a senha para o administrador: ', resolve);
    });

    if (!email || !senha) {
        console.error('❌ Email e senha são obrigatórios.');
        rl.close();
        return;
    }

    let connection;
    try {
        console.log('🔄 Conectando ao banco de dados...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conexão bem-sucedida!');

        console.log('🔄 Gerando hash da senha...');
        const senhaHash = await bcrypt.hash(senha, 10);
        console.log('✅ Hash da senha gerado.');

        const sql = `
            INSERT INTO usuarios 
            (email, senha_hash, role, status, verificado_em) 
            VALUES (?, ?, 'admin', 'ativo', ?)
            ON DUPLICATE KEY UPDATE 
            senha_hash = ?, role = 'admin', status = 'ativo', verificado_em = ?;
        `;

        const now = new Date();
        const values = [email, senhaHash, now, senhaHash, now];
        
        console.log('🔄 Inserindo/Atualizando usuário no banco de dados...');
        await connection.execute(sql, values);
        
        console.log('\n🎉 SUCESSO! 🎉');
        console.log(`O usuário administrador '${email}' foi criado/atualizado com sucesso.`);
        console.log('Você já pode fazer o login no aplicativo com as credenciais que acabou de fornecer.');

    } catch (error) {
        console.error('\n❌ ERRO DURANTE A OPERAÇÃO ❌');
        console.error('Ocorreu um erro:', error.message);
        if (error.code) {
            console.error(`Código do Erro: ${error.code}`);
        }
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Conexão com o banco de dados fechada.');
        }
        rl.close();
    }
}

criarAdmin();