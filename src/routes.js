// Arquivo: gerenciador-tarefas-api/src/routes.js (Versão de Correção Final)

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// MIDDLEWARE DE PERMISSÕES SIMPLIFICADO E CORRIGIDO
const checkSectorRole = (roles) => {
  return async (req, res, next) => {
    const setorId = req.params.id || req.body.setor_id;
    if (!setorId) return res.status(400).json({ error: 'ID do setor não fornecido.' });
    
    try {
      const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]);
      if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' });
      
      if (!roles.includes(rows[0].funcao)) return res.status(403).json({ error: `Acesso negado: sua função não permite esta ação.` });
      
      next();
    } catch (error) {
      res.status(500).json({ error: 'Erro de permissão no servidor.' });
    }
  };
};

// ===============================================
// ROTAS DE SETORES
// ===============================================

// POST /setores (Transacional, já estava correta)
router.post('/setores', authMiddleware, async (req, res) => {
    const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); }
});

// GET /setores (Query simples, já estava correta)
router.get('/setores', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

// ... (Rotas de Convite - vamos mantê-las por enquanto)
router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ... */ });
router.get('/convites', authMiddleware, async (req, res) => { /* ... */ });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { /* ... */ });

// ===============================================
// ROTAS DE TAREFAS
// ===============================================

// GET /tarefas (Query de colaboração, já estava correta)
router.get('/tarefas', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor FROM tarefas t JOIN setores s ON t.setor_id = s.id WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); }
});

// POST /tarefas (Transacional, com histórico)
router.post('/tarefas', authMiddleware, checkSectorRole(['dono', 'membro']), async (req, res) => {
    const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body;
    const usuarioId = req.usuarioId;
    if (!descricao || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Descrição, setor e data prevista são obrigatórios!' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, data_prevista_conclusao) VALUES (?, ?, ?, ?);`;
        const values = [descricao, responsavel_id || null, setor_id, data_prevista_conclusao];
        const [result] = await connection.query(tarefaSql, values);
        const novaTarefaId = result.insertId;
        const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior, status_novo, usuario_alteracao_id) VALUES (?, ?, ?, ?)';
        await connection.query(historySql, [novaTarefaId, null, 'Pendente', usuarioId]);
        await connection.commit();
        res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao criar tarefa:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});


// PUT /tarefas/:id (Transacional, com histórico)
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); }
        const tarefaAtual = taskRows[0];
        const statusAtual = tarefaAtual.status;
        const setorVerificarId = setor_id || tarefaAtual.setor_id;
        const [permRows] = await connection.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorVerificarId]);
        if (permRows.length === 0 || !['dono', 'membro'].includes(permRows[0].funcao)) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para este setor.' }); }
        const updateSql = `UPDATE tarefas SET descricao = ?, responsavel_id = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ?`;
        const values = [descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, tarefaId];
        await connection.query(updateSql, values);
        if (status && status !== statusAtual) {
            const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior, status_novo, usuario_alteracao_id) VALUES (?, ?, ?, ?)';
            await connection.query(historySql, [tarefaId, statusAtual, status, usuarioId]);
        }
        await connection.commit();
        res.status(200).json({ message: 'Tarefa atualizada!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao atualizar tarefa:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});


// DELETE /tarefas/:id (com verificação de permissão 'dono')
router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const usuarioId = req.usuarioId;
    try {
        const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
        const setorId = taskRows[0].setor_id;
        const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
        if (permRows.length === 0 || permRows[0].funcao !== 'dono') { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor pode deletar tarefas.' }); }
        const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
        res.status(200).json({ message: 'Tarefa deletada!' });
    } catch (error) {
        console.error("Erro ao deletar tarefa:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

module.exports = router;