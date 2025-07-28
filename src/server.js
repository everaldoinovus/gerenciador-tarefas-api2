require('dotenv').config();
const express = require('express');
const cors = require('cors');

// REMOVEMOS a importação e a chamada do initializeMailer daqui

const authRoutes = require('./authRoutes');
const routes = require('./routes');

const app = express();

const allowedOrigins = [ /* ... sua lista ... */ ];
const corsOptions = { /* ... */ };
app.use(cors(corsOptions));
app.use(express.json());

app.use('/auth', authRoutes);
app.use(routes);

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});