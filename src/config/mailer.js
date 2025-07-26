// Arquivo: gerenciador-tarefas-api/src/config/mailer.js

const nodemailer = require('nodemailer');

let transporterInstance = null;

async function initializeMailer() {
  // Se a instância já foi criada, não faz nada
  if (transporterInstance) {
    return transporterInstance;
  }

  try {
    const testAccount = await nodemailer.createTestAccount();

    transporterInstance = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    console.log('✅ Mailer de teste Ethereal inicializado com sucesso.');
    console.log(`📬 Para visualizar os e-mails, acesse: ${nodemailer.getTestMessageUrl({ user: testAccount.user, pass: testAccount.pass })}`);

    return transporterInstance;
  } catch (error) {
    console.error('❌ Falha ao inicializar o mailer de teste:', error);
    return null;
  }
}

// Exportamos a função de inicialização e a instância (que será preenchida)
module.exports = {
  initializeMailer,
  getTransporter: () => transporterInstance,
};