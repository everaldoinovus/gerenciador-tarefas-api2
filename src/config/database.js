// Arquivo: gerenciador-tarefas-api/src/config/database.js

require('dotenv').config();
const { Pool } = require('pg');

// Esta configuração é a ideal para se conectar a um PostgreSQL na nuvem
// como o da Clever Cloud, pois já inclui o tratamento de SSL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;