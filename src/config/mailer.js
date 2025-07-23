const nodemailer = require('nodemailer');

// Função assíncrona para configurar e exportar o transportador
async function createMailTransporter() {
  try {
    // Cria uma conta de teste no Ethereal
    const testAccount = await nodemailer.createTestAccount();

    // Configura o transportador usando os dados da conta de teste
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false, // true para 465, false para outras portas
      auth: {
        user: testAccount.user, // Usuário gerado pelo Ethereal
        pass: testAccount.pass, // Senha gerada pelo Ethereal
      },
    });

    console.log('Conta de e-mail de teste criada com sucesso.');
    console.log(`Para visualizar os e-mails, acesse: ${nodemailer.getTestMessageUrl(null)}`);
    console.log(`Usuário: ${testAccount.user}`);
    console.log(`Senha: ${testAccount.pass}`);


    return transporter;
  } catch (error) {
    console.error('Falha ao criar conta de e-mail de teste:', error);
    return null;
  }
}

// Exportamos a função para que possamos chamá-la no início da aplicação
module.exports = createMailTransporter;