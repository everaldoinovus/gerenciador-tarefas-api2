// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// SETORES
router.get('/setores', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM setores WHERE usuario_id = $1 ORDER BY nome ASC', [req.usuarioId]);
    res.status(200).json(result.rows);
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.post('/setores', authMiddleware, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' });
  try {
    const result = await pool.query('INSERT INTO setores (nome, usuario_id) VALUES ($1, $2) RETURNING id', [nome, req.usuarioId]);
    res.status(201).json({ message: 'Setor criado!', id: result.rows[0].id });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Este setor já existe para este usuário.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});
router.delete('/setores/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM setores WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Setor não encontrado ou não pertence a você.' });
    res.status(200).json({ message: 'Setor deletado!' });
  } catch (error) {
    // ER_ROW_IS_REFERENCED_2 no MySQL é 23503 no PostgreSQL
    if (error.code === '23503') return res.status(400).json({ error: 'Não é possível deletar. Setor em uso.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// TAREFAS
router.get('/tarefas', authMiddleware, async (req, res) => {
  try {
    const { responsavel, data } = req.query;
    let sql = `SELECT t.*, s.nome AS setor FROM tarefas t LEFT JOIN setores s ON t.setor_id = s.id WHERE t.usuario_id = $1`;
    const values = [req.usuarioId];
    let paramIndex = 2;
    if (responsavel) { sql += ` AND t.responsavel ILIKE $${paramIndex++}`; values.push(`%${responsavel}%`); }
    if (data) { sql += ` AND t.data_prevista_conclusao = $${paramIndex++}`; values.push(data); }
    sql += ' ORDER BY t.data_inclusao DESC;';
    const result = await pool.query(sql, values);
    res.status(200).json(result.rows);
  } catch (error) { console.log(error); res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.post('/tarefas', authMiddleware, async (req, res) => {
  const { descricao, responsavel, setor_id, data_prevista_conclusao } = req.body;
  if (!descricao || !responsavel || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Todos os campos são obrigatórios!' });
  try {
    const sql = `INSERT INTO tarefas (descricao, responsavel, setor_id, usuario_id, data_prevista_conclusao) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
    const values = [descricao, responsavel, setor_id, req.usuarioId, data_prevista_conclusao];
    const result = await pool.query(sql, values);
    res.status(201).json({ message: 'Tarefa criada!', id: result.rows[0].id });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const { descricao, responsavel, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  try {
    const sql = `UPDATE tarefas SET descricao = $1, responsavel = $2, setor_id = $3, status = $4, data_prevista_conclusao = $5, data_finalizacao = $6, notas = $7 WHERE id = $8 AND usuario_id = $9`;
    const values = [descricao, responsavel, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, req.params.id, req.usuarioId];
    const result = await pool.query(sql, values);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tarefa não encontrada ou não pertence a você.' });
    res.status(200).json({ message: 'Tarefa atualizada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});
router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM tarefas WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuarioId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tarefa não encontrada ou não pertence a você.' });
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

module.exports = router;