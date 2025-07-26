const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// SETORES
router.get('/setores', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM setores WHERE usuario_id = ? ORDER BY nome ASC', [req.usuarioId]);
    res.status(200).json(rows);
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.post('/setores', authMiddleware, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' });
  try {
    const [result] = await pool.query('INSERT INTO setores (nome, usuario_id) VALUES (?, ?)', [nome, req.usuarioId]);
    res.status(201).json({ message: 'Setor criado!', id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
router.delete('/setores/:id', authMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM setores WHERE id = ? AND usuario_id = ?', [req.params.id, req.usuarioId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Setor não encontrado ou não pertence a você.' });
    res.status(200).json({ message: 'Setor deletado!' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(400).json({ error: 'Não é possível deletar. Setor em uso.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// TAREFAS
router.get('/tarefas', authMiddleware, async (req, res) => {
  try {
    // ===== AQUI ESTÁ A CORREÇÃO =====
    // Parâmetros de filtro em uma requisição GET vêm de req.query
    const { responsavel, data } = req.query;
    
    let sql = `SELECT t.*, s.nome AS setor FROM tarefas t LEFT JOIN setores s ON t.setor_id = s.id WHERE t.usuario_id = ?`;
    const values = [req.usuarioId];
    if (responsavel) { sql += ' AND t.responsavel LIKE ?'; values.push(`%${responsavel}%`); }
    if (data) { sql += ' AND t.data_prevista_conclusao = ?'; values.push(data); }
    sql += ' ORDER BY t.data_inclusao DESC;';
    const [rows] = await pool.query(sql, values);
    res.status(200).json(rows);
  } catch (error) { 
    console.error("Erro ao buscar tarefas (API):", error);
    res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); 
  }
});
router.post('/tarefas', authMiddleware, async (req, res) => {
  const { descricao, responsavel, setor_id, data_prevista_conclusao } = req.body;
  if (!descricao || !responsavel || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Todos os campos são obrigatórios!' });
  try {
    const sql = `INSERT INTO tarefas (descricao, responsavel, setor_id, usuario_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`;
    const values = [descricao, responsavel, setor_id, req.usuarioId, data_prevista_conclusao];
    const [result] = await pool.query(sql, values);
    res.status(201).json({ message: 'Tarefa criada!', id: result.insertId });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const { descricao, responsavel, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  try {
    const sql = `UPDATE tarefas SET descricao = ?, responsavel = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ? AND usuario_id = ?`;
    const values = [descricao, responsavel, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, req.params.id, req.usuarioId];
    const [result] = await pool.query(sql, values);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada ou não pertence a você.' });
    res.status(200).json({ message: 'Tarefa atualizada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM tarefas WHERE id = ? AND usuario_id = ?', [req.params.id, req.usuarioId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada ou não pertence a você.' });
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

module.exports = router;