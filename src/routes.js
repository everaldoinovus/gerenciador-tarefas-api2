// Arquivo: gerenciador-tarefas-api/src.routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// MIDDLEWARE DE PERMISSÕES
const checkSectorRole = (roles) => {
  return async (req, res, next) => {
    // Pega o ID do setor dos parâmetros da URL ou do corpo da requisição
    const setorId = req.params.id || req.body.setor_id;
    if (!setorId) {
        // Para PUT/DELETE de tarefas, o setor_id não vem no body. Precisamos buscá-lo.
        if (req.params.id) {
            try {
                const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [req.params.id]);
                if (taskRows.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
                req.setor_id_from_task = taskRows[0].setor_id; // Anexa para uso posterior
            } catch (error) {
                return res.status(500).json({ error: 'Erro ao buscar setor da tarefa.' });
            }
        } else {
            return res.status(400).json({ error: 'ID do setor não fornecido.' });
        }
    }
    
    const finalSetorId = setorId || req.setor_id_from_task;
    const usuarioId = req.usuarioId;
    try {
      const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, finalSetorId]);
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

// ... ROTAS DE SETORES E CONVITES (sem alterações) ...
router.post('/setores', authMiddleware, async (req, res) => { /* ... */ });
router.get('/setores', authMiddleware, async (req, res) => { /* ... */ });
router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ... */ });
router.delete('/setores/:id', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ... */ });
router.get('/convites', authMiddleware, async (req, res) => { /* ... */ });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { /* ... */ });


// ===============================================
// ROTAS DE TAREFAS (COM CORREÇÃO E HISTÓRICO)
// ===============================================

router.get('/tarefas', authMiddleware, async (req, res) => {
  const usuarioId = req.usuarioId;
  try {
    const sql = ` SELECT t.*, s.nome AS setor FROM tarefas t JOIN setores s ON t.setor_id = s.id WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?) `;
    const [rows] = await pool.query(sql, [usuarioId]);
    res.status(200).json(rows);
  } catch (error) {
    console.error("Erro ao buscar tarefas (API):", error);
    res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' });
  }
});

// ROTA DE CRIAÇÃO DE TAREFA - CORRIGIDA
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


router.put('/tarefas/:id', authMiddleware, checkSectorRole(['dono', 'membro']), async (req, res) => {
  const { id: tarefaId } = req.params;
  const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  const usuarioId = req.usuarioId;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
    if (taskRows.length === 0) {
      await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }
    const statusAtual = taskRows[0].status;

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
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    if (connection) connection.release();
  }
});

router.delete('/tarefas/:id', authMiddleware, checkSectorRole(['dono']), async (req, res) => {
  const { id: tarefaId } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Precisa ficar no final
module.exports = router;