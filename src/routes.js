// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

const checkSectorRole = (roles) => {
  return async (req, res, next) => {
    const { id: setorId } = req.params;
    const usuarioId = req.usuarioId;
    try {
      const sql = 'SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?';
      const [rows] = await pool.query(sql, [usuarioId, setorId]);
      if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' });
      const userRole = rows[0].funcao;
      if (!roles.includes(userRole)) return res.status(403).json({ error: `Acesso negado: sua função ('${userRole}') não permite esta ação.` });
      req.userRole = userRole;
      next();
    } catch (error) {
      console.error("Erro na verificação de permissão:", error);
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  };
};

router.post('/setores', authMiddleware, async (req, res) => {
  const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); }
});

router.get('/setores', authMiddleware, async (req, res) => {
  const usuarioId = req.usuarioId; try { const [rows] = await pool.query(`SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC;`, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => {
  const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado. O usuário precisa ter uma conta antes de ser convidado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário neste setor já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

router.delete('/setores/:id', authMiddleware, async (req, res) => { /* código obsoleto */ });
router.get('/tarefas', authMiddleware, async (req, res) => { /* código obsoleto */ });
router.post('/tarefas', authMiddleware, async (req, res) => { /* código obsoleto */ });
router.put('/tarefas/:id', authMiddleware, async (req, res) => { /* código obsoleto */ });
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { /* código obsoleto */ });

module.exports = router;