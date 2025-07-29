// Arquivo: gerenciador-tarefas-api/src/authMiddleware.js

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Erro no formato do token.' });
  }

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    // Anexa as informações do usuário à requisição
    req.usuarioId = decoded.usuarioId;
    req.funcaoGlobal = decoded.funcaoGlobal; // Anexa a função global do token

    return next();
  });
};

// NOVO MIDDLEWARE DE VERIFICAÇÃO DE FUNÇÃO GLOBAL
const checkGlobalRole = (roles) => {
  return (req, res, next) => {
    // Verifica se a função global do usuário (anexada pelo authMiddleware)
    // está incluída na lista de funções permitidas.
    if (!roles.includes(req.funcaoGlobal)) {
      return res.status(403).json({ error: 'Acesso negado: você não tem permissão para esta ação.' });
    }
    next();
  };
};

// Exporta um objeto com os dois middlewares
module.exports = {
  authMiddleware,
  checkGlobalRole,
};