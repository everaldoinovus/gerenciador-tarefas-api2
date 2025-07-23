const jwt = require('jsonwebtoken');

// A mesma chave secreta que usamos para criar o token
const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (request, response, next) => {
  // O token geralmente vem no cabeçalho 'Authorization' no formato 'Bearer TOKEN'
  const authHeader = request.headers.authorization;

  // 1. Verifica se o cabeçalho de autorização existe
  if (!authHeader) {
    return response.status(401).json({ error: 'Token não fornecido.' });
  }

  // 2. Separa a palavra 'Bearer' do token em si
  const parts = authHeader.split(' ');
  if (parts.length !== 2) {
    return response.status(401).json({ error: 'Erro no formato do token.' });
  }

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) {
    return response.status(401).json({ error: 'Token mal formatado.' });
  }

  // 3. Verifica se o token é válido
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return response.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    // 4. Se o token for válido, adicionamos o ID do usuário na requisição
    // para que as rotas seguintes saibam quem é o usuário logado.
    request.usuarioId = decoded.usuarioId;

    // 5. Deixa a requisição continuar para a próxima etapa (a rota)
    return next();
  });
};

module.exports = authMiddleware;