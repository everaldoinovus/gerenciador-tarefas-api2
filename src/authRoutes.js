// Arquivo: gerenciador-tarefas-api/src/authRoutes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./config/database');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ROTA DE REGISTRO
router.post('/register', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const codigoVerificacao = crypto.randomBytes(3).toString('hex').toUpperCase();
    const codigoVerificacaoExpira = new Date(Date.now() + 60 * 60 * 1000); // Expira em 1 hora

    const sql = 'INSERT INTO usuarios (email, senha_hash, codigo_verificacao, codigo_verificacao_expira) VALUES ($1, $2, $3, $4)';
    await pool.query(sql, [email, senhaHash, codigoVerificacao, codigoVerificacaoExpira]);

    const mailer = req.app.get('mailer');
    if (mailer) {
      await mailer.sendMail({
        from: '"Gerenciador de Tarefas" <no-reply@gerenciador.com>',
        to: email,
        subject: 'Código de Verificação de Conta',
        html: `<p>Olá! Seu código de verificação é: <strong>${codigoVerificacao}</strong></p><p>Este código expira em 1 hora.</p>`,
      });
    }
    res.status(201).json({ message: 'Usuário registrado! Um código de verificação foi enviado para o seu e-mail.' });
  } catch (error) {
    // Código '23505' é o erro de violação de unicidade no PostgreSQL
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Este email já está em uso.' });
    }
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ROTA DE VERIFICAÇÃO
router.post('/verify', async (req, res) => {
    const { email, codigo } = req.body;
    if (!email || !codigo) return res.status(400).json({ error: 'Email e código são obrigatórios.' });

    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const usuario = result.rows[0];
        if (usuario.verificado_em) return res.status(400).json({ error: 'Esta conta já foi verificada.' });
        if (new Date() > new Date(usuario.codigo_verificacao_expira)) return res.status(400).json({ error: 'Código de verificação expirado.' });
        if (usuario.codigo_verificacao !== codigo) return res.status(400).json({ error: 'Código de verificação inválido.' });

        await pool.query('UPDATE usuarios SET verificado_em = $1, codigo_verificacao = NULL, codigo_verificacao_expira = NULL WHERE id = $2', [new Date(), usuario.id]);
        res.status(200).json({ message: 'Conta verificada com sucesso! Você já pode fazer o login.' });
    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

// ROTA DE LOGIN
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const usuario = result.rows[0];
    if (!usuario.verificado_em) {
        return res.status(403).json({ error: 'Sua conta ainda não foi verificada.', needsVerification: true });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaCorreta) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = jwt.sign({ usuarioId: usuario.id }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ token: token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;