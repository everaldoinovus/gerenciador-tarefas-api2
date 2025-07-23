// Carrega as variáveis de ambiente do arquivo .env para process.env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const createMailTransporter = require('./config/mailer');

const authRoutes = require('./authRoutes');
const routes = require('./routes');

async function startServer() {
  const app = express();

  // Configuração do CORS
  // Esta lista define quais "origens" (sites) podem fazer requisições para a nossa API.
  const allowedOrigins = [
    'http://localhost:5173', // Para desenvolvimento local
    // A URL do seu front-end em produção será adicionada aqui depois
    // Ex: 'https://gerenciador-tarefas-web.onrender.com'
  ];

  const corsOptions = {
    origin: function (origin, callback) {
      // Permite requisições sem 'origin' (como de apps mobile ou Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'A política de CORS para este site não permite acesso da origem especificada.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    }
  };

  app.use(cors(corsOptions));
  app.use(express.json());

  // Inicializa o transportador de e-mail e o disponibiliza para as rotas
  const mailer = await createMailTransporter();
  if (mailer) {
    app.set('mailer', mailer);
  }

  // Define as rotas da aplicação
  app.use('/auth', authRoutes);
  app.use(routes);

  // Usa a porta definida no ambiente ou a 3333 como padrão
  const PORT = process.env.PORT || 3333;
  
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
  });
}

// Inicia o servidor
startServer();