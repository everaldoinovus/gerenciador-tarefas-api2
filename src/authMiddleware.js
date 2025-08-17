// Arquivo: gerenciador-tarefas-api/src/authMiddleware.js - VERSÃO COM DEBUG

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
  console.log(`[DEBUG] authMiddleware: Recebida requisição para ${req.method} ${req.path}`);
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log('[DEBUG] authMiddleware: Falha - Token não fornecido.');
    return res.status(401).json({ error: 'Token não fornecido.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2) {
    console.log('[DEBUG] authMiddleware: Falha - Erro no formato do token.');
    return res.status(401).json({ error: 'Erro no formato do token.' });
  }

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) {
    console.log('[DEBUG] authMiddleware: Falha - Token mal formatado.');
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('[DEBUG] authMiddleware: Falha - Token inválido ou expirado.', err.message);
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    // LOG MAIS IMPORTANTE: O que está dentro do token?
    console.log('[DEBUG] authMiddleware: Token decodificado com sucesso:', decoded);

    req.usuarioId = decoded.usuarioId;
    req.role = decoded.role;

    console.log(`[DEBUG] authMiddleware: Anexado à requisição -> usuarioId: ${req.usuarioId}, role: ${req.role}`);

    return next();
  });
};

const checkRole = (roles) => {
  return (req, res, next) => {
    console.log(`[DEBUG] checkRole: Verificando se o role '${req.role}' está em [${roles.join(', ')}] para a rota ${req.path}`);
    if (!roles.includes(req.role)) {
      console.log('[DEBUG] checkRole: Acesso NEGADO.');
      return res.status(403).json({ error: 'Acesso negado: você não tem permissão para esta ação.' });
    }
    console.log('[DEBUG] checkRole: Acesso PERMITIDO.');
    next();
  };
};

module.exports = {
  authMiddleware,
  checkGlobalRole: checkRole,
};


// Arquivo: gerenciador-tarefas-api/src/authMiddleware.js - VERSÃO ATUALIZADA
/*
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

    // ===== MUDANÇA PRINCIPAL AQUI =====
    // Anexa as informações do usuário à requisição usando o novo formato do token
    req.usuarioId = decoded.usuarioId;
    req.role = decoded.role; // Anexa o 'role' (ex: 'admin', 'user') em vez de 'funcaoGlobal'

    return next();
  });
};

// ===== MIDDLEWARE DE VERIFICAÇÃO DE PAPEL (ROLE) ATUALIZADO =====
// Renomeado de checkGlobalRole para checkRole para maior clareza
const checkRole = (roles) => {
  return (req, res, next) => {
    // A verificação agora usa 'req.role'
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Acesso negado: você não tem permissão para esta ação.' });
    }
    next();
  };
};

// Exporta um objeto com os dois middlewares (o segundo foi renomeado)
module.exports = {
  authMiddleware,
  checkGlobalRole: checkRole, // Mantive o nome 'checkGlobalRole' na exportação para evitar quebrar as importações
};
*/

/*
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
};*/