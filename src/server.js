// Arquivo: gerenciador-tarefas-api/src/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeMailer } = require('./config/mailer');

const authRoutes = require('./authRoutes');
const routes = require('./routes');

// Inicia a inicialização do mailer em segundo plano, mas não espera por ela.
initializeMailer();

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