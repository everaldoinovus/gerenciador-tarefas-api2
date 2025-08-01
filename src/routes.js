// Arquivo: gerenciador-tarefas-api/src.routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => {
    let setorId = req.params.id || req.body.setor_id;
    if (!setorId && req.params.id) {
        try {
            const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [req.params.id]);
            if (taskRows.length > 0) {
                setorId = taskRows[0].setor_id;
            }
        } catch (e) {
            return res.status(500).json({ error: 'Erro interno.' });
        }
    }
    if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' });

    try {
        const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]);
        if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' });
        req.userRole = rows[0].funcao;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Erro de permissão no servidor.' });
    }
};

const checkOwnership = (req, res, next) => {
    if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') {
        return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' });
    }
    next();
};

// ===============================================
// ROTAS DE SETORES
// ===============================================
router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { nome } = req.body;
    const usuarioId = req.usuarioId;
    if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]);
        const novoSetorId = setorResult.insertId;
        await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']);
        const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }];
        for (const status of statusPadrao) {
            await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]);
        }
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
        const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `;
        const [rows] = await pool.query(sql, [usuarioId]);
        res.status(200).json(rows);
    } catch (error) {
        console.error("Erro ao listar setores:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/setores/:id/status', authMiddleware, async (req, res) => {
    const { id: setorId } = req.params;
    const usuarioId = req.usuarioId;
    try {
        const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
        if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' });
        const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]);
        res.status(200).json(statusRows);
    } catch (error) {
        console.error("Erro ao listar status do setor:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => {
    const { id: setorId } = req.params;
    const { email: emailConvidado } = req.body;
    const usuarioConvidouId = req.usuarioId;
    if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' });
    try {
        const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]);
        if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const usuarioConvidadoId = userRows[0].id;
        const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]);
        if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' });
        await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]);
        res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' });
        console.error("Erro ao criar convite:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/setores/:id/membros', authMiddleware, async (req, res) => {
    const { id: setorId } = req.params;
    const usuarioId = req.usuarioId;
    try {
        const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
        if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' });
        const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`;
        const [members] = await pool.query(sql, [setorId]);
        res.status(200).json(members);
    } catch (error) {
        console.error("Erro ao listar membros do setor:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => {
    const { id: setorId } = req.params;
    try {
        await pool.query('DELETE FROM setores WHERE id = ?', [setorId]);
        res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' });
    }
});

router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { id: setorId } = req.params;
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' });
    try {
        const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]);
        const novaOrdem = (maxOrder[0].max_ordem || 0) + 1;
        const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]);
        res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar status.' });
    }
});

router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { id: statusId } = req.params;
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' });
    try {
        const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' });
        res.status(200).json({ message: 'Status atualizado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar status.' });
    }
});

router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { id: statusId } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' });
        res.status(200).json({ message: 'Status deletado!' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' });
        }
        console.error("Erro ao deletar status:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { id: setorId } = req.params;
    const { orderedStatuses } = req.body;
    if (!Array.isArray(orderedStatuses)) {
        return res.status(400).json({ error: 'Lista de status ordenada é necessária.' });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const updatePromises = orderedStatuses.map((status, index) => {
            const novaOrdem = index + 1;
            return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]);
        });
        await Promise.all(updatePromises);
        await connection.commit();
        res.status(200).json({ message: 'Ordem das colunas atualizada!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao reordenar status:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/convites', authMiddleware, async (req, res) => {
    try {
        const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]);
        if (userRows.length === 0) {
            return res.status(200).json([]);
        }
        const userEmail = userRows[0].email;
        const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `;
        const [convites] = await pool.query(sql, [userEmail]);
        res.status(200).json(convites);
    } catch (error) {
        console.error("Erro ao listar convites:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => {
    const { id: conviteId } = req.params;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]);
        const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]);
        if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); }
        const convite = inviteRows[0];
        const userEmail = userRows[0].email;
        if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); }
        await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']);
        await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]);
        await connection.commit();
        res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' });
    } catch (error) {
        if (connection) await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); }
        console.error("Erro ao aceitar convite:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/tarefas', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId;
    try {
        const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `;
        const [rows] = await pool.query(sql, [usuarioId]);
        res.status(200).json(rows);
    } catch (error) {
        console.error("Erro ao buscar tarefas (API):", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' });
    }
});

router.post('/tarefas', authMiddleware, checkMembership, async (req, res) => {
    const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body;
    const usuarioId = req.usuarioId;
    if (!descricao || !setor_id || !data_prevista_conclusao) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]);
        if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); }
        const statusInicialId = statusRows[0].id;
        const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`;
        const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao];
        const [result] = await connection.query(tarefaSql, values);
        const novaTarefaId = result.insertId;
        const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)';
        await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]);
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

router.put('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const updates = req.body;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); }
        const tarefaAtual = taskRows[0];
        const setorAtualId = tarefaAtual.setor_id;
        const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]);
        if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); }
        if (updates.setor_id && updates.setor_id !== setorAtualId) { const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]); if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); } }
        const statusAtualId = tarefaAtual.status_id;
        const fieldsToUpdate = Object.keys(updates);
        if (fieldsToUpdate.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Nenhum dado para atualizar.' }); }
        const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
        const values = fieldsToUpdate.map(field => updates[field]);
        values.push(tarefaId);
        const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
        await connection.query(updateSql, values);
        if (updates.status_id && updates.status_id !== statusAtualId) {
            const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)';
            await connection.query(historySql, [tarefaId, statusAtualId, updates.status_id, usuarioId]);
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

router.delete('/tarefas/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => {
    const { id: tarefaId } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });
        res.status(200).json({ message: 'Tarefa deletada!' });
    } catch (error) {
        console.error("Erro ao deletar tarefa:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/tarefas/:id/historico', authMiddleware, checkMembership, async (req, res) => {
    const { id: tarefaId } = req.params;
    try {
        const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `;
        const [history] = await pool.query(sql, [tarefaId]);
        res.status(200).json(history);
    } catch (error) {
        console.error("Erro ao buscar histórico da tarefa:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

module.exports = router;