// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// MIDDLEWARE DE PERMISSÕES
const checkSectorRole = (roles) => {
  return async (req, res, next) => {
    // O id pode vir do req.params (para /setores/:id) ou do req.body (para criar/editar tarefa)
    const setorId = req.params.id || req.body.setor_id;
    if (!setorId) return res.status(400).json({ error: 'ID do setor não fornecido.' });
    
    const usuarioId = req.usuarioId;
    try {
      const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
      if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' });
      
      const userRole = rows[0].funcao;
      if (!roles.includes(userRole)) return res.status(403).json({ error: `Acesso negado: sua função ('${userRole}') não permite esta ação.` });
      
      req.userRole = userRole;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Erro de permissão no servidor.' });
    }
  };
};

// ===============================================
// ROTAS DE SETORES
// ===============================================

router.post('/setores', authMiddleware, async (req, res) => { /* ...código anterior, já está correto... */ });
router.get('/setores', authMiddleware, async (req, res) => { /* ...código anterior, já está correto... */ });
router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ...código anterior, já está correto... */ });

// ROTA DE DELETAR SETOR - CORRIGIDA
router.delete('/setores/:id', authMiddleware, checkSectorRole(['dono']), async (req, res) => {
  const { id: setorId } = req.params;
  try {
    // A tabela 'setores' tem ON DELETE CASCADE, então ao deletar um setor,
    // as tarefas e as relações em usuarios_setores serão deletadas automaticamente.
    await pool.query('DELETE FROM setores WHERE id = ?', [setorId]);
    res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' });
  }
});


// ===============================================
// ROTAS DE TAREFAS - TODAS CORRIGIDAS
// ===============================================

// LISTAR TAREFAS DE TODOS OS SETORES DO USUÁRIO
router.get('/tarefas', authMiddleware, async (req, res) => {
  const usuarioId = req.usuarioId;
  try {
    // Busca todas as tarefas dos setores aos quais o usuário pertence
    const sql = `
      SELECT t.*, s.nome AS setor 
      FROM tarefas t
      JOIN setores s ON t.setor_id = s.id
      WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?)
    `;
    const [rows] = await pool.query(sql, [usuarioId]);
    res.status(200).json(rows);
  } catch (error) { 
    console.error("Erro ao buscar tarefas (API):", error);
    res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); 
  }
});

// CRIAR UMA NOVA TAREFA (precisa ser membro ou dono)
router.post('/tarefas', authMiddleware, checkSectorRole(['dono', 'membro']), async (req, res) => {
  const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body;
  if (!descricao || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Descrição, setor e data prevista são obrigatórios!' });
  try {
    const sql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, data_prevista_conclusao) VALUES (?, ?, ?, ?);`;
    const values = [descricao, responsavel_id || null, setor_id, data_prevista_conclusao];
    const [result] = await pool.query(sql, values);
    res.status(201).json({ message: 'Tarefa criada!', id: result.insertId });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

// ATUALIZAR UMA TAREFA (precisa ser membro ou dono)
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const { id: tarefaId } = req.params;
  const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  const usuarioId = req.usuarioId;
  try {
    // Verifica a permissão antes de atualizar
    const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]);
    if (permRows.length === 0 || !['dono', 'membro'].includes(permRows[0].funcao)) {
      return res.status(403).json({ error: 'Acesso negado a este setor.' });
    }

    const sql = `UPDATE tarefas SET descricao = ?, responsavel_id = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ?`;
    const values = [descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, tarefaId];
    const [result] = await pool.query(sql, values);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa atualizada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

// DELETAR UMA TAREFA (precisa ser dono)
router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  const { id: tarefaId } = req.params;
  const usuarioId = req.usuarioId;
  try {
    // Descobre a qual setor a tarefa pertence
    const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    const setorId = taskRows[0].setor_id;

    // Verifica se o usuário é o dono daquele setor
    const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
    if (permRows.length === 0 || permRows[0].funcao !== 'dono') {
      return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor pode deletar tarefas.' });
    }

    await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]);
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

module.exports = router;