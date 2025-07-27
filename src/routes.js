// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// ===============================================
// ROTAS DE SETORES
// ===============================================

router.post('/setores', authMiddleware, async (req, res) => {
  const { nome } = req.body;
  const usuarioId = req.usuarioId;
  if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const setorSql = 'INSERT INTO setores (nome) VALUES (?)';
    const [setorResult] = await connection.query(setorSql, [nome]);
    const novoSetorId = setorResult.insertId;
    const relacaoSql = 'INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)';
    await connection.query(relacaoSql, [usuarioId, novoSetorId, 'dono']);
    await connection.commit();
    res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' });
    console.error("Erro ao criar setor:", error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/setores', authMiddleware, async (req, res) => {
  const usuarioId = req.usuarioId;
  try {
    const sql = `
      SELECT s.*, us.funcao 
      FROM setores s
      JOIN usuarios_setores us ON s.id = us.setor_id
      WHERE us.usuario_id = ?
      ORDER BY s.nome ASC;
    `;
    const [rows] = await pool.query(sql, [usuarioId]);
    res.status(200).json(rows);
  } catch (error) {
    console.error("Erro ao listar setores:", error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.delete('/setores/:id', authMiddleware, async (req, res) => {
  try {
    // Este código está obsoleto e precisa ser atualizado
    const [result] = await pool.query('DELETE FROM setores WHERE id = ? AND usuario_id = ?', [req.params.id, req.usuarioId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Setor não encontrado ou não pertence a você.' });
    res.status(200).json({ message: 'Setor deletado!' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(400).json({ error: 'Não é possível deletar. Setor em uso.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ===============================================
// ROTAS DE TAREFAS (Ainda no modelo antigo)
// ===============================================

router.get('/tarefas', authMiddleware, async (req, res) => {
  try {
    const { responsavel, data } = req.query;
    // Este código está obsoleto e precisa ser atualizado
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
  const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body;
  if (!descricao || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Descrição, setor e data prevista são obrigatórios!' });
  try {
    // Este código está obsoleto e precisa ser atualizado
    const sql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, data_prevista_conclusao) VALUES (?, ?, ?, ?);`;
    const values = [descricao, responsavel_id || null, setor_id, data_prevista_conclusao];
    const [result] = await pool.query(sql, values);
    res.status(201).json({ message: 'Tarefa criada!', id: result.insertId });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

router.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  try {
    // Este código está obsoleto e precisa ser atualizado
    const sql = `UPDATE tarefas SET descricao = ?, responsavel_id = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ?`;
    const values = [descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, req.params.id];
    const [result] = await pool.query(sql, values);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa atualizada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  try {
    // Este código está obsoleto e precisa ser atualizado
    const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

module.exports = router;