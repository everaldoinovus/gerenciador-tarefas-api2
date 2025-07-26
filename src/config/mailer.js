// Arquivo: gerenciador-tarefas-api/src/config/mailer.js

const nodemailer = require('nodemailer');

let transporterInstance = null;

async function initializeMailer() {
  if (transporterInstance) {
    return transporterInstance;
  }

  // Pega as credenciais das variáveis de ambiente
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  // Se as credenciais não estiverem definidas, não inicializa
  if (!user || !pass) {
    console.warn('⚠️  Credenciais do Gmail não configuradas nas variáveis de ambiente. O envio de e-mail está desativado.');
    return null;
  }

  try {
    transporterInstance = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: user, // Seu e-mail do Gmail
        pass: pass, // A senha de app de 16 letras
      },
    });

    console.log('✅ Mailer do Gmail inicializado com sucesso.');
    return transporterInstance;

  } catch (error) {
    console.error('❌ Falha ao inicializar o mailer do Gmail:', error);
    return null;
  }
}

module.exports = {
  initializeMailer,
  getTransporter: () => transporterInstance,
};