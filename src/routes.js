// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// MIDDLEWARE DE PERMISSÕES (Vamos precisar dele para as outras rotas)
const checkSectorRole = (roles) => {
  return async (req, res, next) => {
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
// ROTAS DE SETORES (JÁ FUNCIONAIS)
// ===============================================

router.post('/setores', authMiddleware, async (req, res) => { /* ...código anterior, já está correto... */ });
router.get('/setores', authMiddleware, async (req, res) => { /* ...código anterior, já está correto... */ });
// Vamos deixar a rota de convite aqui, pois ela não interfere no problema atual.
router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ...código anterior, já está correto... */ });
router.delete('/setores/:id', authMiddleware, checkSectorRole(['dono']), async (req, res) => { /* ...código para deletar setor... */ });


// ===============================================
// ROTAS DE TAREFAS - CORRIGIDAS PARA O MODELO DE COLABORAÇÃO
// ===============================================

// LISTAR TAREFAS DE TODOS OS SETORES DO USUÁRIO
router.get('/tarefas', authMiddleware, async (req, res) => {
  const usuarioId = req.usuarioId;
  try {
    // ESTA É A QUERY CORRETA
    // 1. Encontra todos os setor_id do usuário.
    // 2. Busca todas as tarefas onde o setor_id está nessa lista.
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

// CRIAR UMA NOVA TAREFA (precisa ser membro ou dono do setor)
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

// ATUALIZAR UMA TAREFA (precisa ser membro ou dono do setor da tarefa)
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const { id: tarefaId } = req.params;
  const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body;
  const usuarioId = req.usuarioId;
  try {
    // Antes de atualizar, verifica se o usuário tem permissão no setor da tarefa
    const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]);
    if (permRows.length === 0 || !['dono', 'membro'].includes(permRows[0].funcao)) {
      return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para editar tarefas neste setor.' });
    }

    const sql = `UPDATE tarefas SET descricao = ?, responsavel_id = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ?`;
    const values = [descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, tarefaId];
    const [result] = await pool.query(sql, values);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa atualizada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

// DELETAR UMA TAREFA (precisa ser dono do setor da tarefa)
router.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  const { id: tarefaId } = req.params;
  const usuarioId = req.usuarioId;
  try {
    const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]);
    if (permRows.length === 0 || permRows[0].funcao !== 'dono') {
      return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor pode deletar tarefas.' });
    }

    const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    res.status(200).json({ message: 'Tarefa deletada!' });
  } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); }
});

module.exports = router;```

---
### **Código Completo para `routes.js` (para garantir)**

```javascript
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

const checkSectorRole = (roles) => { return async (req, res, next) => { const setorId = req.params.id || req.body.setor_id; if (!setorId) return res.status(400).json({ error: 'ID do setor não fornecido.' }); const usuarioId = req.usuarioId; try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); const userRole = rows[0].funcao; if (!roles.includes(userRole)) return res.status(403).json({ error: `Acesso negado: sua função ('${userRole}') não permite esta ação.` }); req.userRole = userRole; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } }; };

router.post('/setores', authMiddleware, async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkSectorRole(['dono']), async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkSectorRole(['dono']), async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });

router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor FROM tarefas t JOIN setores s ON t.setor_id = s.id WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, checkSectorRole(['dono', 'membro']), async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; if (!descricao || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Descrição, setor e data prevista são obrigatórios!' }); try { const sql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, data_prevista_conclusao) VALUES (?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, data_prevista_conclusao]; const [result] = await pool.query(sql, values); res.status(201).json({ message: 'Tarefa criada!', id: result.insertId }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const { descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0 || !['dono', 'membro'].includes(permRows[0].funcao)) { return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para editar tarefas neste setor.' }); } const sql = `UPDATE tarefas SET descricao = ?, responsavel_id = ?, setor_id = ?, status = ?, data_prevista_conclusao = ?, data_finalizacao = ?, notas = ? WHERE id = ?`; const values = [descricao, responsavel_id, setor_id, status, data_prevista_conclusao, data_finalizacao, notas, tarefaId]; const [result] = await pool.query(sql, values); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa atualizada!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0 || permRows[0].funcao !== 'dono') { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;