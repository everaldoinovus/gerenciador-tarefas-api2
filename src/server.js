// Arquivo: gerenciador-tarefas-api/src/server.js

require('dotenv').config();
console.log("DATABASE_URL a ser usada pela API:", process.env.DATABASE_URL);

const express = require('express');
const cors = require('cors');
const { initializeMailer } = require('./config/mailer'); // Importa a função de inicialização

const authRoutes = require('./authRoutes');
const routes = require('./routes');

async function startServer() {
  // Primeiro, inicializa o mailer
  await initializeMailer();

  const app = express();
  
  // ... (configuração do CORS continua a mesma)
  const allowedOrigins = [ 'http://localhost:5173', 'https://SEU-SITE.vercel.app' ];
  const corsOptions = { /* ... */ };
  app.use(cors(corsOptions));
  
  app.use(express.json());

  app.use('/auth', authRoutes);
  app.use(routes);

  const PORT = process.env.PORT || 3333;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
  });
}

startServer();