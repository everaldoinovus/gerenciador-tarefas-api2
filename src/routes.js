const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const bcrypt = require('bcryptjs');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };

const checkOwnership = (req, res, next) => {
    if (req.userRole !== 'dono' && req.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou admin necessários.' });
    }
    next();
};

const checkSectorOwnershipForDeletion = async (req, res, next) => {
    const setorId = req.params.id;
    const usuarioId = req.usuarioId;
    const userRole = req.role;

    if (userRole === 'admin') {
        return next();
    }
    try {
        const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
        if (rows.length === 0 || rows[0].funcao !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um admin podem deletar.' });
        }
        next();
    } catch (error) {
        console.error("Erro no middleware de verificação de posse do setor:", error);
        res.status(500).json({ error: 'Erro no servidor ao verificar permissão para deletar setor.' });
    }
};

router.post('/setores', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { 
	const { 
		nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });



router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkSectorOwnershipForDeletion, async (req, res) => { const { id: setorId } = req.params; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); await connection.query('DELETE FROM historico_status_tarefas WHERE tarefa_id IN (SELECT id FROM tarefas WHERE setor_id = ?)', [setorId]); await connection.query('DELETE FROM tarefas WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM status WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM convites WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM usuarios_setores WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM acoes_automacao WHERE setor_destino_id = ?', [setorId]); await connection.query('DELETE FROM acoes_automacao WHERE regra_id IN (SELECT id FROM regras_automacao WHERE setor_origem_id = ?)', [setorId]); await connection.query('DELETE FROM regras_automacao WHERE setor_origem_id = ?', [setorId]); const [result] = await connection.query('DELETE FROM setores WHERE id = ?', [setorId]); if (result.affectedRows === 0) { await connection.rollback(); return res.status(404).json({ error: 'Setor não encontrado.' }); } await connection.commit(); res.status(200).json({ message: 'Setor e todos os seus dados foram deletados com sucesso!' }); } catch (error) { if (connection) { await connection.rollback(); } console.error("Erro ao deletar setor:", error); res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } finally { if (connection) { connection.release(); } } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.put('/status/:id/settings', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; const { nome, tempo_maximo_dias } = req.body; if (!nome) { return res.status(400).json({ error: 'O nome do status é obrigatório.' }); } try { const tempoMaximo = (tempo_maximo_dias && parseInt(tempo_maximo_dias, 10) > 0) ? parseInt(tempo_maximo_dias, 10) : null; const [result] = await pool.query('UPDATE status SET nome = ?, tempo_maximo_dias = ? WHERE id = ?', [nome, tempoMaximo, statusId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Status não encontrado.' }); } res.status(200).json({ message: 'Status atualizado com sucesso!' }); } catch (error) { console.error("Erro ao atualizar configurações do status:", error); res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { 
	 console.log(`[DEBUG] Rota GET /tarefas: Acessada pelo usuário ID: ${req.usuarioId} com role: ${req.role}`);
	const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email, st.tempo_maximo_dias, ( SELECT MAX(h.data_alteracao) FROM historico_status_tarefas h WHERE h.tarefa_id = t.id AND h.status_novo_id = t.status_id ) AS data_entrada_status_atual FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?) `; const [rows] = await pool.query(sql, [usuarioId]); const agora = new Date(); const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()); const tarefasProcessadas = rows.map(tarefa => { let esta_atrasado_sla = false; if (tarefa.tempo_maximo_dias > 0 && tarefa.data_entrada_status_atual) { const dataEntrada = new Date(tarefa.data_entrada_status_atual); const diffTime = Math.abs(agora - dataEntrada); const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); if (diffDays > tarefa.tempo_maximo_dias) { esta_atrasado_sla = true; } } let prazo_estourado = false; if (tarefa.data_prevista_conclusao && !tarefa.data_finalizacao) { const dataPrevista = new Date(tarefa.data_prevista_conclusao); if (hoje > dataPrevista) { prazo_estourado = true; } } return { ...tarefa, esta_atrasado_sla, prazo_estourado }; }); res.status(200).json(tarefasProcessadas); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });
/*router.put('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const updates = req.body; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const tarefaAtual = taskRows[0]; const setorAtualId = tarefaAtual.setor_id; const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]); if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); } if (updates.setor_id && updates.setor_id !== setorAtualId) { const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]); if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); } } const statusAtualId = tarefaAtual.status_id; if (tarefaAtual.tarefa_pai_id && updates.status_id && updates.status_id !== statusAtualId) { const [statusInicialRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [tarefaAtual.setor_id]); if (statusInicialRows.length > 0) { const statusInicialId = statusInicialRows[0].id; if (statusAtualId === statusInicialId) { await connection.query("UPDATE tarefas SET status_vinculado = 'em_andamento' WHERE id = ?", [tarefaAtual.tarefa_pai_id]); } } } const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas']; const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key)); if (fieldsToUpdate.length > 0) { const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', '); const values = fieldsToUpdate.map(field => updates[field]); values.push(tarefaId); const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`; await connection.query(updateSql, values); } if (updates.status_id && updates.status_id !== statusAtualId) { await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]); if (tarefaAtual.tarefa_pai_id) { const [statusInfo] = await connection.query('SELECT nome FROM status WHERE id = ?', [updates.status_id]); if (statusInfo.length > 0) { const nomeStatusNovo = statusInfo[0].nome.toLowerCase(); const [acaoOrigemRows] = await connection.query('SELECT * FROM acoes_automacao WHERE setor_destino_id = ?', [setorAtualId]); for (const acao of acaoOrigemRows) { let statusDestinoMae = null; if (nomeStatusNovo.includes('aprovado') && acao.status_retorno_sucesso_id) { statusDestinoMae = acao.status_retorno_sucesso_id; } else if (nomeStatusNovo.includes('negado') && acao.status_retorno_falha_id) { statusDestinoMae = acao.status_retorno_falha_id; } if (statusDestinoMae) { const [tarefaMaeAtualRows] = await connection.query('SELECT status_id FROM tarefas WHERE id = ?', [tarefaAtual.tarefa_pai_id]); if (tarefaMaeAtualRows.length > 0) { const tarefaMaeStatusAtual = tarefaMaeAtualRows[0].status_id; await connection.query("UPDATE tarefas SET status_id = ?, status_vinculado = 'aguardando' WHERE id = ?", [statusDestinoMae, tarefaAtual.tarefa_pai_id]); await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaAtual.tarefa_pai_id, tarefaMaeStatusAtual, statusDestinoMae, usuarioId]); } } } } } const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]); if (regras.length > 0) { for (const regra of regras) { const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]); for (const acao of acoes) { let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`; novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id); const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]); if (statusDestinoRows.length > 0) { const statusInicialDestinoId = statusDestinoRows[0].id; let dataConclusaoNovaTarefa = null; if (acao.tipo_prazo === 'copiar') { dataConclusaoNovaTarefa = tarefaAtual.data_prevista_conclusao; } else if (acao.tipo_prazo === 'dias' && acao.valor_prazo > 0) { const novaData = new Date(); novaData.setDate(novaData.getDate() + acao.valor_prazo); dataConclusaoNovaTarefa = novaData; } const insertSql = `INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const insertValues = [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id, dataConclusaoNovaTarefa]; const [novaTarefaResult] = await connection.query(insertSql, insertValues); const novaTarefaId = novaTarefaResult.insertId; await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]); } } } } } await connection.commit(); res.status(200).json({ message: 'Tarefa atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao atualizar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
*/

router.put('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const updates = req.body;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Tarefa não encontrada.' });
        }
        
        const tarefaAtual = taskRows[0];
        const setorAtualId = tarefaAtual.setor_id;

        const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]);
        if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); }
        if (updates.setor_id && updates.setor_id !== setorAtualId) {
            const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]);
            if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); }
        }

        const statusAtualId = tarefaAtual.status_id;

        if (tarefaAtual.tarefa_pai_id && updates.status_id && updates.status_id !== statusAtualId) {
            // ===== LÓGICA DE ATIVAÇÃO DO FEEDBACK MODIFICADA =====
            // 1. Descobre qual ação de automação gerou esta tarefa-filha
            const [acaoOrigemRows] = await connection.query(
                'SELECT a.* FROM acoes_automacao a JOIN tarefas t ON t.tarefa_pai_id = a.regra_id WHERE t.id = ? LIMIT 1',
                [tarefaId]
            );

            // 2. Se a ação for encontrada E a opção de feedback estiver ATIVA
            if (acaoOrigemRows.length > 0 && acaoOrigemRows[0].ativar_feedback_analise) {
                const [statusInicialRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [tarefaAtual.setor_id]);
                if (statusInicialRows.length > 0) {
                    const statusInicialId = statusInicialRows[0].id;
                    if (statusAtualId === statusInicialId) {
                        // 3. Somente então, ativa o feedback na tarefa-pai
                        await connection.query("UPDATE tarefas SET status_vinculado = 'em_andamento' WHERE id = ?", [tarefaAtual.tarefa_pai_id]);
                    }
                }
            }
        }

        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }

        if (updates.status_id && updates.status_id !== statusAtualId) {
            // ... (resto da sua lógica de histórico, automação, etc., continua aqui sem alterações)
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

router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.role !== 'admin')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um admin pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, a.status_retorno_sucesso_id, a.status_retorno_falha_id, a.tipo_prazo, a.valor_prazo FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
/*router.post('/regras_automacao', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id, tipo_prazo, valor_prazo) VALUES (?, ?, ?, ?, ?, ?, ?)'; const acaoValues = [novaRegraId, acao.setor_destino_id, acao.template_descricao || '', acao.status_retorno_sucesso_id || null, acao.status_retorno_falha_id || null, acao.tipo_prazo || 'nenhum', acao.tipo_prazo === 'dias' ? acao.valor_prazo : null]; await connection.query(acaoSql, acaoValues); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
*/
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { 
    const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body;
    const usuarioId = req.usuarioId;
    if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) {
        return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)';
        const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]);
        const novaRegraId = regraResult.insertId;
        for (const acao of acoes) {
            if (!acao.setor_destino_id) {
                throw new Error('Ação inválida: setor de destino é obrigatório.');
            }
            
            // Query SQL agora inclui o novo campo 'ativar_feedback_analise'
            const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id, tipo_prazo, valor_prazo, ativar_feedback_analise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            const acaoValues = [
                novaRegraId,
                acao.setor_destino_id,
                acao.template_descricao || '',
                acao.status_retorno_sucesso_id || null,
                acao.status_retorno_falha_id || null,
                acao.tipo_prazo || 'nenhum',
                acao.tipo_prazo === 'dias' ? acao.valor_prazo : null,
                acao.ativar_feedback_analise || false // Adiciona o novo valor
            ];
            await connection.query(acaoSql, acaoValues);
        }
        await connection.commit();
        res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao criar regra de automação:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});

router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

router.post('/users/invite', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { email, senha } = req.body; if (!email || !senha) { return res.status(400).json({ error: 'Email e senha são obrigatórios.' }); } try { const hashedPassword = await bcrypt.hash(senha, 10); const [result] = await pool.query('INSERT INTO usuarios (email, senha_hash, role, status, verificado_em) VALUES (?, ?, ?, ?, ?)', [email, hashedPassword, 'user', 'ativo', new Date()]); res.status(201).json({ message: 'Usuário criado com sucesso!', id: result.insertId }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Este email já está em uso.' }); } console.error("Erro ao criar usuário:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/users', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { try { const [users] = await pool.query('SELECT id, email, role, status FROM usuarios ORDER BY email ASC'); res.status(200).json(users); } catch (error) { console.error("Erro ao listar usuários:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/users/:id/role', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: userId } = req.params; const { role } = req.body; if (!['admin', 'user'].includes(role)) { return res.status(400).json({ error: 'Papel inválido. Use "admin" ou "user".' }); } try { const [result] = await pool.query('UPDATE usuarios SET role = ? WHERE id = ?', [role, userId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Usuário não encontrado.' }); } res.status(200).json({ message: 'Papel do usuário atualizado com sucesso.' }); } catch (error) { console.error("Erro ao atualizar papel do usuário:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/users/:id/status', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: userId } = req.params; const { status } = req.body; if (!['ativo', 'inativo'].includes(status)) { return res.status(400).json({ error: 'Status inválido. Use "ativo" ou "inativo".' }); } try { const [result] = await pool.query('UPDATE usuarios SET status = ? WHERE id = ?', [status, userId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Usuário não encontrado.' }); } res.status(200).json({ message: 'Status do usuário atualizado com sucesso.' }); } catch (error) { console.error("Erro ao atualizar status do usuário:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/users/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: userId } = req.params; try { const [result] = await pool.query('DELETE FROM usuarios WHERE id = ?', [userId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Usuário não encontrado.' }); } res.status(200).json({ message: 'Usuário deletado com sucesso.' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar este usuário pois ele possui dados associados (setores, tarefas, etc.). Considere desativá-lo.' }); } console.error("Erro ao deletar usuário:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

router.put('/users/change-password', authMiddleware, async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;
    const usuarioId = req.usuarioId; // Obtido do token pelo authMiddleware

    if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ error: 'A senha atual e a nova senha são obrigatórias.' });
    }

    if (novaSenha.length < 4) { // Você pode aumentar este requisito
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 4 caracteres.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Busca o usuário e sua senha hash atual no banco
        const [rows] = await connection.query('SELECT senha_hash FROM usuarios WHERE id = ?', [usuarioId]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        
        const usuario = rows[0];

        // 2. Compara a senha atual fornecida com a senha hash armazenada
        const senhaCorreta = await bcrypt.compare(senhaAtual, usuario.senha_hash);
        if (!senhaCorreta) {
            return res.status(401).json({ error: 'A senha atual está incorreta.' });
        }

        // 3. Se a senha atual estiver correta, gera o hash da nova senha
        const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

        // 4. Atualiza a senha no banco de dados
        await connection.query('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novaSenhaHash, usuarioId]);

        res.status(200).json({ message: 'Senha alterada com sucesso!' });

    } catch (error) {
        console.error("Erro ao alterar senha:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao alterar a senha.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});


module.exports = router;


/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const bcrypt = require('bcryptjs');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };

const checkOwnership = (req, res, next) => {
    if (req.userRole !== 'dono' && req.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou admin necessários.' });
    }
    next();
};

const checkSectorOwnershipForDeletion = async (req, res, next) => {
    const setorId = req.params.id;
    const usuarioId = req.usuarioId;
    const userRole = req.role;

    if (userRole === 'admin') {
        return next();
    }
    try {
        const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]);
        if (rows.length === 0 || rows[0].funcao !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um admin podem deletar.' });
        }
        next();
    } catch (error) {
        console.error("Erro no middleware de verificação de posse do setor:", error);
        res.status(500).json({ error: 'Erro no servidor ao verificar permissão para deletar setor.' });
    }
};

router.post('/setores', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkSectorOwnershipForDeletion, async (req, res) => { const { id: setorId } = req.params; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); await connection.query('DELETE FROM historico_status_tarefas WHERE tarefa_id IN (SELECT id FROM tarefas WHERE setor_id = ?)', [setorId]); await connection.query('DELETE FROM tarefas WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM status WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM convites WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM usuarios_setores WHERE setor_id = ?', [setorId]); await connection.query('DELETE FROM acoes_automacao WHERE setor_destino_id = ?', [setorId]); await connection.query('DELETE FROM acoes_automacao WHERE regra_id IN (SELECT id FROM regras_automacao WHERE setor_origem_id = ?)', [setorId]); await connection.query('DELETE FROM regras_automacao WHERE setor_origem_id = ?', [setorId]); const [result] = await connection.query('DELETE FROM setores WHERE id = ?', [setorId]); if (result.affectedRows === 0) { await connection.rollback(); return res.status(404).json({ error: 'Setor não encontrado.' }); } await connection.commit(); res.status(200).json({ message: 'Setor e todos os seus dados foram deletados com sucesso!' }); } catch (error) { if (connection) { await connection.rollback(); } console.error("Erro ao deletar setor:", error); res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } finally { if (connection) { connection.release(); } } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.put('/status/:id/settings', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; const { nome, tempo_maximo_dias } = req.body; if (!nome) { return res.status(400).json({ error: 'O nome do status é obrigatório.' }); } try { const tempoMaximo = (tempo_maximo_dias && parseInt(tempo_maximo_dias, 10) > 0) ? parseInt(tempo_maximo_dias, 10) : null; const [result] = await pool.query('UPDATE status SET nome = ?, tempo_maximo_dias = ? WHERE id = ?', [nome, tempoMaximo, statusId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Status não encontrado.' }); } res.status(200).json({ message: 'Status atualizado com sucesso!' }); } catch (error) { console.error("Erro ao atualizar configurações do status:", error); res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email, st.tempo_maximo_dias, ( SELECT MAX(h.data_alteracao) FROM historico_status_tarefas h WHERE h.tarefa_id = t.id AND h.status_novo_id = t.status_id ) AS data_entrada_status_atual FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?) `; const [rows] = await pool.query(sql, [usuarioId]); const agora = new Date(); const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()); const tarefasProcessadas = rows.map(tarefa => { let esta_atrasado_sla = false; if (tarefa.tempo_maximo_dias > 0 && tarefa.data_entrada_status_atual) { const dataEntrada = new Date(tarefa.data_entrada_status_atual); const diffTime = Math.abs(agora - dataEntrada); const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); if (diffDays > tarefa.tempo_maximo_dias) { esta_atrasado_sla = true; } } let prazo_estourado = false; if (tarefa.data_prevista_conclusao && !tarefa.data_finalizacao) { const dataPrevista = new Date(tarefa.data_prevista_conclusao); if (hoje > dataPrevista) { prazo_estourado = true; } } return { ...tarefa, esta_atrasado_sla, prazo_estourado }; }); res.status(200).json(tarefasProcessadas); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });
router.put('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const updates = req.body; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const tarefaAtual = taskRows[0]; const setorAtualId = tarefaAtual.setor_id; const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]); if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); } if (updates.setor_id && updates.setor_id !== setorAtualId) { const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]); if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); } } const statusAtualId = tarefaAtual.status_id; if (tarefaAtual.tarefa_pai_id && updates.status_id && updates.status_id !== statusAtualId) { const [statusInicialRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [tarefaAtual.setor_id]); if (statusInicialRows.length > 0) { const statusInicialId = statusInicialRows[0].id; if (statusAtualId === statusInicialId) { await connection.query("UPDATE tarefas SET status_vinculado = 'em_andamento' WHERE id = ?", [tarefaAtual.tarefa_pai_id]); } } } const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas']; const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key)); if (fieldsToUpdate.length > 0) { const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', '); const values = fieldsToUpdate.map(field => updates[field]); values.push(tarefaId); const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`; await connection.query(updateSql, values); } if (updates.status_id && updates.status_id !== statusAtualId) { await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]); if (tarefaAtual.tarefa_pai_id) { const [statusInfo] = await connection.query('SELECT nome FROM status WHERE id = ?', [updates.status_id]); if (statusInfo.length > 0) { const nomeStatusNovo = statusInfo[0].nome.toLowerCase(); const [acaoOrigemRows] = await connection.query('SELECT * FROM acoes_automacao WHERE setor_destino_id = ?', [setorAtualId]); for (const acao of acaoOrigemRows) { let statusDestinoMae = null; if (nomeStatusNovo.includes('aprovado') && acao.status_retorno_sucesso_id) { statusDestinoMae = acao.status_retorno_sucesso_id; } else if (nomeStatusNovo.includes('negado') && acao.status_retorno_falha_id) { statusDestinoMae = acao.status_retorno_falha_id; } if (statusDestinoMae) { const [tarefaMaeAtualRows] = await connection.query('SELECT status_id FROM tarefas WHERE id = ?', [tarefaAtual.tarefa_pai_id]); if (tarefaMaeAtualRows.length > 0) { const tarefaMaeStatusAtual = tarefaMaeAtualRows[0].status_id; await connection.query("UPDATE tarefas SET status_id = ?, status_vinculado = 'aguardando' WHERE id = ?", [statusDestinoMae, tarefaAtual.tarefa_pai_id]); await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaAtual.tarefa_pai_id, tarefaMaeStatusAtual, statusDestinoMae, usuarioId]); } } } } } const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]); if (regras.length > 0) { for (const regra of regras) { const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]); for (const acao of acoes) { let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`; novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id); const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]); if (statusDestinoRows.length > 0) { const statusInicialDestinoId = statusDestinoRows[0].id; let dataConclusaoNovaTarefa = null; if (acao.tipo_prazo === 'copiar') { dataConclusaoNovaTarefa = tarefaAtual.data_prevista_conclusao; } else if (acao.tipo_prazo === 'dias' && acao.valor_prazo > 0) { const novaData = new Date(); novaData.setDate(novaData.getDate() + acao.valor_prazo); dataConclusaoNovaTarefa = novaData; } const insertSql = `INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const insertValues = [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id, dataConclusaoNovaTarefa]; const [novaTarefaResult] = await connection.query(insertSql, insertValues); const novaTarefaId = novaTarefaResult.insertId; await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]); } } } } } await connection.commit(); res.status(200).json({ message: 'Tarefa atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao atualizar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.role !== 'admin')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um admin pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, a.status_retorno_sucesso_id, a.status_retorno_falha_id, a.tipo_prazo, a.valor_prazo FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id, tipo_prazo, valor_prazo) VALUES (?, ?, ?, ?, ?, ?, ?)'; const acaoValues = [novaRegraId, acao.setor_destino_id, acao.template_descricao || '', acao.status_retorno_sucesso_id || null, acao.status_retorno_falha_id || null, acao.tipo_prazo || 'nenhum', acao.tipo_prazo === 'dias' ? acao.valor_prazo : null]; await connection.query(acaoSql, acaoValues); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

// ===================================================================
// NOVAS ROTAS DE GERENCIAMENTO DE USUÁRIOS (APENAS PARA ADMINS)
// ===================================================================

router.post('/users/invite', authMiddleware, checkGlobalRole(['admin']), async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(senha, 10);
        // O novo usuário sempre é criado com role 'user' e status 'ativo' e já verificado
        const [result] = await pool.query(
            'INSERT INTO usuarios (email, senha_hash, role, status, verificado_em) VALUES (?, ?, ?, ?, ?)',
            [email, hashedPassword, 'user', 'ativo', new Date()]
        );
        res.status(201).json({ message: 'Usuário criado com sucesso!', id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Este email já está em uso.' });
        }
        console.error("Erro ao criar usuário:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.get('/users', authMiddleware, checkGlobalRole(['admin']), async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, email, role, status FROM usuarios ORDER BY email ASC');
        res.status(200).json(users);
    } catch (error) {
        console.error("Erro ao listar usuários:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.put('/users/:id/role', authMiddleware, checkGlobalRole(['admin']), async (req, res) => {
    const { id: userId } = req.params;
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Papel inválido. Use "admin" ou "user".' });
    }
    try {
        const [result] = await pool.query('UPDATE usuarios SET role = ? WHERE id = ?', [role, userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        res.status(200).json({ message: 'Papel do usuário atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar papel do usuário:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.put('/users/:id/status', authMiddleware, checkGlobalRole(['admin']), async (req, res) => {
    const { id: userId } = req.params;
    const { status } = req.body;
    if (!['ativo', 'inativo'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido. Use "ativo" ou "inativo".' });
    }
    try {
        const [result] = await pool.query('UPDATE usuarios SET status = ? WHERE id = ?', [status, userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        res.status(200).json({ message: 'Status do usuário atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar status do usuário:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

router.delete('/users/:id', authMiddleware, checkGlobalRole(['admin']), async (req, res) => {
    const { id: userId } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM usuarios WHERE id = ?', [userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        res.status(200).json({ message: 'Usuário deletado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(400).json({ error: 'Não é possível deletar este usuário pois ele possui dados associados (setores, tarefas, etc.). Considere desativá-lo.' });
        }
        console.error("Erro ao deletar usuário:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});


module.exports = router;*/


/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');
*/
/*const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };*/
// SUBSTITUA A SUA FUNÇÃO checkMembership POR ESTA VERSÃO CORRIGIDA
/*
const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };

const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };


// ===== NOVO MIDDLEWARE DE VERIFICAÇÃO DE PERMISSÃO PARA DELETE =====
const checkSectorOwnershipForDeletion = async (req, res, next) => {
    const setorId = req.params.id;
    const usuarioId = req.usuarioId;
    const funcaoGlobal = req.funcaoGlobal; // Assumindo que o authMiddleware anexa isso

    // Se o usuário for um 'master', ele pode deletar qualquer setor.
    if (funcaoGlobal === 'master') {
        return next();
    }

    // Se não for master, verifica se ele é 'dono' do setor específico.
    try {
        const [rows] = await pool.query(
            'SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?',
            [usuarioId, setorId]
        );

        // Se não encontrou relação ou a função não é 'dono', nega o acesso.
        if (rows.length === 0 || rows[0].funcao !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master podem deletar.' });
        }

        // Se passou na verificação, permite continuar.
        next();
    } catch (error) {
        console.error("Erro no middleware de verificação de posse do setor:", error);
        res.status(500).json({ error: 'Erro no servidor ao verificar permissão para deletar setor.' });
    }
};



router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
/*router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });*/
/*
router.delete('/setores/:id', authMiddleware, checkSectorOwnershipForDeletion, async (req, res) => {
    const { id: setorId } = req.params;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Deleta dependências na ordem correta
        await connection.query('DELETE FROM historico_status_tarefas WHERE tarefa_id IN (SELECT id FROM tarefas WHERE setor_id = ?)', [setorId]);
        await connection.query('DELETE FROM tarefas WHERE setor_id = ?', [setorId]);
        await connection.query('DELETE FROM status WHERE setor_id = ?', [setorId]);
        await connection.query('DELETE FROM convites WHERE setor_id = ?', [setorId]);
        await connection.query('DELETE FROM usuarios_setores WHERE setor_id = ?', [setorId]);
        await connection.query('DELETE FROM acoes_automacao WHERE setor_destino_id = ?', [setorId]);
        await connection.query('DELETE FROM acoes_automacao WHERE regra_id IN (SELECT id FROM regras_automacao WHERE setor_origem_id = ?)', [setorId]);
        await connection.query('DELETE FROM regras_automacao WHERE setor_origem_id = ?', [setorId]);

        // Deleta o setor principal
        const [result] = await connection.query('DELETE FROM setores WHERE id = ?', [setorId]);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Setor não encontrado.' });
        }

        await connection.commit();
        res.status(200).json({ message: 'Setor e todos os seus dados foram deletados com sucesso!' });
        
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        
        // Mantemos o console.error, que é útil para logs de produção
        console.error("Erro ao deletar setor:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });

// ADICIONE ESTA NOVA ROTA AO SEU ARQUIVO DE ROTAS DO BACKEND

router.put('/status/:id/settings', authMiddleware, checkGlobalRole(['master']), async (req, res) => {
    const { id: statusId } = req.params;
    const { nome, tempo_maximo_dias } = req.body;

    if (!nome) {
        return res.status(400).json({ error: 'O nome do status é obrigatório.' });
    }

    try {
        // Se tempo_maximo_dias for uma string vazia ou 0, salva como NULL no banco
        const tempoMaximo = (tempo_maximo_dias && parseInt(tempo_maximo_dias, 10) > 0) 
            ? parseInt(tempo_maximo_dias, 10) 
            : null;

        const [result] = await pool.query(
            'UPDATE status SET nome = ?, tempo_maximo_dias = ? WHERE id = ?',
            [nome, tempoMaximo, statusId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Status não encontrado.' });
        }
        res.status(200).json({ message: 'Status atualizado com sucesso!' });
    } catch (error) {
        console.error("Erro ao atualizar configurações do status:", error);
        res.status(500).json({ error: 'Erro ao atualizar status.' });
    }
});

router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
//router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });

// SUBSTITUA A SUA ROTA GET /tarefas POR ESTA VERSÃO FINAL

router.get('/tarefas', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId;
    try {
        const sql = `
            SELECT 
                t.*, 
                s.nome AS setor_nome, 
                st.nome AS status_nome, 
                u.email AS responsavel_email,
                st.tempo_maximo_dias,
                (
                    SELECT MAX(h.data_alteracao) 
                    FROM historico_status_tarefas h 
                    WHERE h.tarefa_id = t.id AND h.status_novo_id = t.status_id
                ) AS data_entrada_status_atual
            FROM 
                tarefas t 
            JOIN 
                setores s ON t.setor_id = s.id 
            JOIN 
                status st ON t.status_id = st.id 
            LEFT JOIN 
                usuarios u ON t.responsavel_id = u.id 
            WHERE 
                t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?)
        `;

        const [rows] = await pool.query(sql, [usuarioId]);

        const agora = new Date();
        // Para a comparação de datas, zeramos as horas para evitar problemas de fuso horário
        const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

        const tarefasProcessadas = rows.map(tarefa => {
            // Lógica de atraso na coluna (SLA) - já existente
            let esta_atrasado_sla = false;
            if (tarefa.tempo_maximo_dias > 0 && tarefa.data_entrada_status_atual) {
                const dataEntrada = new Date(tarefa.data_entrada_status_atual);
                const diffTime = Math.abs(agora - dataEntrada);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > tarefa.tempo_maximo_dias) {
                    esta_atrasado_sla = true;
                }
            }

            // ===== NOVA LÓGICA DE PRAZO DE CONCLUSÃO ESTOURADO =====
            let prazo_estourado = false;
            // Verifica se a tarefa tem uma data de conclusão e se ainda não foi finalizada
            // (Assumindo que uma tarefa finalizada tem a coluna 'data_finalizacao' preenchida)
            if (tarefa.data_prevista_conclusao && !tarefa.data_finalizacao) {
                const dataPrevista = new Date(tarefa.data_prevista_conclusao);
                if (hoje > dataPrevista) {
                    prazo_estourado = true;
                }
            }
            
            // Renomeamos a flag anterior para maior clareza e adicionamos a nova
            return { ...tarefa, esta_atrasado_sla, prazo_estourado };
        });

        res.status(200).json(tarefasProcessadas);

    } catch (error) {
        console.error("Erro ao buscar tarefas (API):", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' });
    }
});

// SUBSTITUA A SUA ROTA GET /tarefas POR ESTA VERSÃO APRIMORADA
/*
router.get('/tarefas', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId;
    try {
        // Esta query SQL foi aprimorada para fazer o cálculo de atraso
        const sql = `
            SELECT 
                t.*, 
                s.nome AS setor_nome, 
                st.nome AS status_nome, 
                u.email AS responsavel_email,
                st.tempo_maximo_dias,
                (
                    SELECT MAX(h.data_alteracao) 
                    FROM historico_status_tarefas h 
                    WHERE h.tarefa_id = t.id AND h.status_novo_id = t.status_id
                ) AS data_entrada_status_atual
            FROM 
                tarefas t 
            JOIN 
                setores s ON t.setor_id = s.id 
            JOIN 
                status st ON t.status_id = st.id 
            LEFT JOIN 
                usuarios u ON t.responsavel_id = u.id 
            WHERE 
                t.setor_id IN (SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?)
        `;

        const [rows] = await pool.query(sql, [usuarioId]);

        // Agora, processamos os resultados no JavaScript para adicionar a flag 'esta_atrasado'
        const agora = new Date();
        const tarefasProcessadas = rows.map(tarefa => {
            let esta_atrasado = false;
            // Verifica se existe uma regra de tempo E se temos a data de entrada no status
            if (tarefa.tempo_maximo_dias > 0 && tarefa.data_entrada_status_atual) {
                const dataEntrada = new Date(tarefa.data_entrada_status_atual);
                const diffTime = Math.abs(agora - dataEntrada);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > tarefa.tempo_maximo_dias) {
                    esta_atrasado = true;
                }
            }
            return { ...tarefa, esta_atrasado };
        });

        res.status(200).json(tarefasProcessadas);

    } catch (error) {
        console.error("Erro ao buscar tarefas (API):", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' });
    }
});*/
/*
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });

router.put('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const updates = req.body;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Tarefa não encontrada.' });
        }
        
        const tarefaAtual = taskRows[0];
        const setorAtualId = tarefaAtual.setor_id;

        const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]);
        if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); }
        if (updates.setor_id && updates.setor_id !== setorAtualId) {
            const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]);
            if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); }
        }

        const statusAtualId = tarefaAtual.status_id;

        if (tarefaAtual.tarefa_pai_id && updates.status_id && updates.status_id !== statusAtualId) {
            const [statusInicialRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [tarefaAtual.setor_id]);
            if (statusInicialRows.length > 0) {
                const statusInicialId = statusInicialRows[0].id;
                if (statusAtualId === statusInicialId) {
                    await connection.query("UPDATE tarefas SET status_vinculado = 'em_andamento' WHERE id = ?", [tarefaAtual.tarefa_pai_id]);
                }
            }
        }

        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }

        if (updates.status_id && updates.status_id !== statusAtualId) {
            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]);
            
            if (tarefaAtual.tarefa_pai_id) {
                const [statusInfo] = await connection.query('SELECT nome FROM status WHERE id = ?', [updates.status_id]);
                if (statusInfo.length > 0) {
                    const nomeStatusNovo = statusInfo[0].nome.toLowerCase();
                    const [acaoOrigemRows] = await connection.query('SELECT * FROM acoes_automacao WHERE setor_destino_id = ?', [setorAtualId]);
                    for (const acao of acaoOrigemRows) {
                        let statusDestinoMae = null;
                        if (nomeStatusNovo.includes('aprovado') && acao.status_retorno_sucesso_id) { statusDestinoMae = acao.status_retorno_sucesso_id; }
                        else if (nomeStatusNovo.includes('negado') && acao.status_retorno_falha_id) { statusDestinoMae = acao.status_retorno_falha_id; }
                        
                        if (statusDestinoMae) {
                            const [tarefaMaeAtualRows] = await connection.query('SELECT status_id FROM tarefas WHERE id = ?', [tarefaAtual.tarefa_pai_id]);
                            if (tarefaMaeAtualRows.length > 0) {
                                const tarefaMaeStatusAtual = tarefaMaeAtualRows[0].status_id;
                                await connection.query(
                                    "UPDATE tarefas SET status_id = ?, status_vinculado = 'aguardando' WHERE id = ?", 
                                    [statusDestinoMae, tarefaAtual.tarefa_pai_id]
                                );
                                await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaAtual.tarefa_pai_id, tarefaMaeStatusAtual, statusDestinoMae, usuarioId]);
                            }
                        }
                    }
                }
            }
            
            const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]);
            if (regras.length > 0) {
                 for (const regra of regras) {
                    const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]);
                    for (const acao of acoes) {
                        // ===== INÍCIO DA LÓGICA DE GERAÇÃO DA NOVA TAREFA (MODIFICADA) =====
                        let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`;
                        novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id);
                        
                        const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]);
                        
                        if (statusDestinoRows.length > 0) {
                            const statusInicialDestinoId = statusDestinoRows[0].id;

                            // Lógica de Cálculo de Data
                            let dataConclusaoNovaTarefa = null;
                            if (acao.tipo_prazo === 'copiar') {
                                dataConclusaoNovaTarefa = tarefaAtual.data_prevista_conclusao;
                            } else if (acao.tipo_prazo === 'dias' && acao.valor_prazo > 0) {
                                const novaData = new Date();
                                novaData.setDate(novaData.getDate() + acao.valor_prazo);
                                dataConclusaoNovaTarefa = novaData;
                            }

                            const insertSql = `INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`;
                            const insertValues = [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id, dataConclusaoNovaTarefa];
                            
                            const [novaTarefaResult] = await connection.query(insertSql, insertValues);
                            const novaTarefaId = novaTarefaResult.insertId;
                            
                            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]);
                        }
                        // ===== FIM DA LÓGICA DE GERAÇÃO DA NOVA TAREFA (MODIFICADA) =====
                    }
                }
            }
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

router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

// ===== INÍCIO DA ROTA CORRIGIDA =====
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { 
    try {
        const sql = `
            SELECT 
                r.*, 
                s_origem.nome AS setor_origem_nome, 
                st_gatilho.nome AS status_gatilho_nome 
            FROM regras_automacao r 
            JOIN setores s_origem ON r.setor_origem_id = s_origem.id 
            JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id 
            WHERE r.usuario_criador_id = ?
        `;
        const [regras] = await pool.query(sql, [req.usuarioId]);
        for (const regra of regras) {
            // A query agora busca também os novos campos de prazo
            const acoesSql = `
                SELECT 
                    a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, 
                    a.status_retorno_sucesso_id, a.status_retorno_falha_id,
                    a.tipo_prazo, a.valor_prazo 
                FROM acoes_automacao a 
                JOIN setores s_destino ON a.setor_destino_id = s_destino.id 
                WHERE a.regra_id = ?
            `;
            const [acoes] = await pool.query(acoesSql, [regra.id]);
            regra.acoes = acoes;
        }
        res.status(200).json(regras);
    } catch (error) {
        console.error("Erro ao listar regras de automação:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});
// ===== FIM DA ROTA CORRIGIDA =====

// ===== INÍCIO DA ROTA CORRIGIDA =====
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { 
    const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body;
    const usuarioId = req.usuarioId;
    if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) {
        return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)';
        const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]);
        const novaRegraId = regraResult.insertId;
        for (const acao of acoes) {
            if (!acao.setor_destino_id) {
                throw new Error('Ação inválida: setor de destino é obrigatório.');
            }
            // Query de inserção da ação agora inclui os novos campos de prazo
            const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id, tipo_prazo, valor_prazo) VALUES (?, ?, ?, ?, ?, ?, ?)';
            const acaoValues = [
                novaRegraId,
                acao.setor_destino_id,
                acao.template_descricao || '',
                acao.status_retorno_sucesso_id || null,
                acao.status_retorno_falha_id || null,
                acao.tipo_prazo || 'nenhum',
                acao.tipo_prazo === 'dias' ? acao.valor_prazo : null
            ];
            await connection.query(acaoSql, acaoValues);
        }
        await connection.commit();
        res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao criar regra de automação:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
        if (connection) connection.release();
    }
});
// ===== FIM DA ROTA CORRIGIDA =====

router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/

/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };
const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });

// ===== INÍCIO DA ROTA CORRIGIDA =====
router.put('/tarefas/:id', authMiddleware, async (req, res) => {
    const { id: tarefaId } = req.params;
    const updates = req.body;
    const usuarioId = req.usuarioId;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]);
        if (taskRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Tarefa não encontrada.' });
        }
        
        const tarefaAtual = taskRows[0];
        const setorAtualId = tarefaAtual.setor_id;

        // Validações de permissão (sem alteração)
        const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]);
        if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); }
        if (updates.setor_id && updates.setor_id !== setorAtualId) {
            const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]);
            if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); }
        }

        const statusAtualId = tarefaAtual.status_id;

        // Lógica para LIGAR o feedback (sem alteração)
        if (tarefaAtual.tarefa_pai_id && updates.status_id && updates.status_id !== statusAtualId) {
            const [statusInicialRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [tarefaAtual.setor_id]);
            if (statusInicialRows.length > 0) {
                const statusInicialId = statusInicialRows[0].id;
                if (statusAtualId === statusInicialId) {
                    await connection.query("UPDATE tarefas SET status_vinculado = 'em_andamento' WHERE id = ?", [tarefaAtual.tarefa_pai_id]);
                }
            }
        }

        // Lógica de atualização geral (sem alteração)
        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }

        // Lógica de histórico e automação (COM A ALTERAÇÃO PRINCIPAL)
        if (updates.status_id && updates.status_id !== statusAtualId) {
            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]);
            
            // Lógica para DESLIGAR o feedback
            if (tarefaAtual.tarefa_pai_id) {
                const [statusInfo] = await connection.query('SELECT nome FROM status WHERE id = ?', [updates.status_id]);
                if (statusInfo.length > 0) {
                    const nomeStatusNovo = statusInfo[0].nome.toLowerCase();
                    const [acaoOrigemRows] = await connection.query('SELECT * FROM acoes_automacao WHERE setor_destino_id = ?', [setorAtualId]);
                    for (const acao of acaoOrigemRows) {
                        let statusDestinoMae = null;
                        if (nomeStatusNovo.includes('aprovado') && acao.status_retorno_sucesso_id) { statusDestinoMae = acao.status_retorno_sucesso_id; }
                        else if (nomeStatusNovo.includes('negado') && acao.status_retorno_falha_id) { statusDestinoMae = acao.status_retorno_falha_id; }
                        
                        if (statusDestinoMae) {
                            const [tarefaMaeAtualRows] = await connection.query('SELECT status_id FROM tarefas WHERE id = ?', [tarefaAtual.tarefa_pai_id]);
                            if (tarefaMaeAtualRows.length > 0) {
                                const tarefaMaeStatusAtual = tarefaMaeAtualRows[0].status_id;
                                
                                // ===== ALTERAÇÃO PRINCIPAL AQUI =====
                                // Atualiza o status da tarefa-mãe E reseta o feedback visual
                                await connection.query(
                                    "UPDATE tarefas SET status_id = ?, status_vinculado = 'aguardando' WHERE id = ?", 
                                    [statusDestinoMae, tarefaAtual.tarefa_pai_id]
                                );
                                // ======================================

                                await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaAtual.tarefa_pai_id, tarefaMaeStatusAtual, statusDestinoMae, usuarioId]);
                            }
                        }
                    }
                }
            }
            
            // Lógica de criação de novas tarefas (sem alteração)
            const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]);
            if (regras.length > 0) {
                 for (const regra of regras) {
                    const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]);
                    for (const acao of acoes) {
                        let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`;
                        novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id);
                        const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]);
                        if (statusDestinoRows.length > 0) {
                            const statusInicialDestinoId = statusDestinoRows[0].id;
                            const [novaTarefaResult] = await connection.query(`INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id) VALUES (?, ?, ?, ?);`, [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id]);
                            const novaTarefaId = novaTarefaResult.insertId;
                            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]);
                        }
                    }
                }
            }
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
// ===== FIM DA ROTA CORRIGIDA =====

router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, a.status_retorno_sucesso_id, a.status_retorno_falha_id FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id) VALUES (?, ?, ?, ?, ?)'; await connection.query(acaoSql, [novaRegraId, acao.setor_destino_id, acao.template_descricao || '', acao.status_retorno_sucesso_id || null, acao.status_retorno_falha_id || null]); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/



/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };
const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });
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
        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }
        if (updates.status_id && updates.status_id !== statusAtualId) {
            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]);
            if (tarefaAtual.tarefa_pai_id) {
                const [statusInfo] = await connection.query('SELECT nome FROM status WHERE id = ?', [updates.status_id]);
                if (statusInfo.length > 0) {
                    const nomeStatusNovo = statusInfo[0].nome.toLowerCase();
                    const [acaoOrigemRows] = await connection.query('SELECT * FROM acoes_automacao WHERE setor_destino_id = ?', [setorAtualId]);
                    for (const acao of acaoOrigemRows) {
                        let statusDestinoMae = null;
                        if (nomeStatusNovo.includes('aprovado') && acao.status_retorno_sucesso_id) { statusDestinoMae = acao.status_retorno_sucesso_id; }
                        else if (nomeStatusNovo.includes('negado') && acao.status_retorno_falha_id) { statusDestinoMae = acao.status_retorno_falha_id; }
                        if (statusDestinoMae) {
                            const [tarefaMaeAtualRows] = await connection.query('SELECT status_id FROM tarefas WHERE id = ?', [tarefaAtual.tarefa_pai_id]);
                            if(tarefaMaeAtualRows.length > 0) {
                                const tarefaMaeStatusAtual = tarefaMaeAtualRows[0].status_id;
                                await connection.query('UPDATE tarefas SET status_id = ? WHERE id = ?', [statusDestinoMae, tarefaAtual.tarefa_pai_id]);
                                await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaAtual.tarefa_pai_id, tarefaMaeStatusAtual, statusDestinoMae, usuarioId]);
                            }
                        }
                    }
                }
            }
            const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]);
            if (regras.length > 0) {
                for (const regra of regras) {
                    const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]);
                    for (const acao of acoes) {
                        let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`;
                        novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id);
                        const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]);
                        if (statusDestinoRows.length > 0) {
                            const statusInicialDestinoId = statusDestinoRows[0].id;
                            const [novaTarefaResult] = await connection.query(`INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id) VALUES (?, ?, ?, ?);`, [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id]);
                            const novaTarefaId = novaTarefaResult.insertId;
                            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]);
                        }
                    }
                }
            }
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
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, a.status_retorno_sucesso_id, a.status_retorno_falha_id FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id) VALUES (?, ?, ?, ?, ?)'; await connection.query(acaoSql, [novaRegraId, acao.setor_destino_id, acao.template_descricao || '', acao.status_retorno_sucesso_id || null, acao.status_retorno_falha_id || null]); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/





/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };
const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });

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
        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }

        if (updates.status_id && updates.status_id !== statusAtualId) {
            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)', [tarefaId, statusAtualId, updates.status_id, usuarioId]);
            
            const [regras] = await connection.query('SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?', [setorAtualId, updates.status_id]);
            if (regras.length > 0) {
                for (const regra of regras) {
                    const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]);
                    for (const acao of acoes) {
                        let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`;
                        novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao).replace(/{id_original}/g, tarefaAtual.id);
                        const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]);
                        if (statusDestinoRows.length > 0) {
                            const statusInicialDestinoId = statusDestinoRows[0].id;
                            const [novaTarefaResult] = await connection.query(`INSERT INTO tarefas (descricao, setor_id, status_id, tarefa_pai_id) VALUES (?, ?, ?, ?);`, [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, tarefaAtual.id]);
                            const novaTarefaId = novaTarefaResult.insertId;
                            await connection.query('INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)', [novaTarefaId, statusInicialDestinoId, usuarioId]);
                        }
                    }
                }
            }
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

router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome, a.status_retorno_sucesso_id, a.status_retorno_falha_id FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao, status_retorno_sucesso_id, status_retorno_falha_id) VALUES (?, ?, ?, ?, ?)'; await connection.query(acaoSql, [novaRegraId, acao.setor_destino_id, acao.template_descricao || '', acao.status_retorno_sucesso_id || null, acao.status_retorno_falha_id || null]); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/



/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId; if (req.body.setor_id) { setorId = req.body.setor_id; } else if (req.params.id) { const resourceId = req.params.id; try { if (req.path.includes('/tarefas/')) { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [resourceId]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } else { setorId = resourceId; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };
const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });

// ROTA PUT /tarefas/:id ATUALIZADA COM A LÓGICA DE AUTOMAÇÃO
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
        const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas'];
        const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key));
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => updates[field]);
            values.push(tarefaId);
            const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`;
            await connection.query(updateSql, values);
        }
        if (updates.status_id && updates.status_id !== statusAtualId) {
            const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)';
            await connection.query(historySql, [tarefaId, statusAtualId, updates.status_id, usuarioId]);
            const regraSql = 'SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?';
            const [regras] = await connection.query(regraSql, [setorAtualId, updates.status_id]);
            if (regras.length > 0) {
                for (const regra of regras) {
                    const [acoes] = await connection.query('SELECT * FROM acoes_automacao WHERE regra_id = ?', [regra.id]);
                    for (const acao of acoes) {
                        let novaDescricao = acao.template_descricao || `Gerado por: ${tarefaAtual.descricao}`;
                        novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao);
                        novaDescricao = novaDescricao.replace(/{id_original}/g, tarefaAtual.id);
                        const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [acao.setor_destino_id]);
                        if (statusDestinoRows.length > 0) {
                            const statusInicialDestinoId = statusDestinoRows[0].id;
                            const novaTarefaSql = `INSERT INTO tarefas (descricao, setor_id, status_id, responsavel_id) VALUES (?, ?, ?, ?);`;
                            const [novaTarefaResult] = await connection.query(novaTarefaSql, [novaDescricao, acao.setor_destino_id, statusInicialDestinoId, null]);
                            const novaTarefaId = novaTarefaResult.insertId;
                            const novoHistorySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)';
                            await connection.query(novoHistorySql, [novaTarefaId, statusInicialDestinoId, usuarioId]);
                        }
                    }
                }
            }
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

router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id WHERE r.usuario_criador_id = ? `; const [regras] = await pool.query(sql, [req.usuarioId]); for (const regra of regras) { const acoesSql = 'SELECT a.id, a.template_descricao, s_destino.nome AS setor_destino_nome FROM acoes_automacao a JOIN setores s_destino ON a.setor_destino_id = s_destino.id WHERE a.regra_id = ?'; const [acoes] = await pool.query(acoesSql, [regra.id]); regra.acoes = acoes; } res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao) VALUES (?, ?, ?)'; await connection.query(acaoSql, [novaRegraId, acao.setor_destino_id, acao.template_descricao || '']); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;
*/

/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

const checkMembership = async (req, res, next) => { let setorId = req.params.id || req.body.setor_id; if (!setorId && req.params.id) { try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [req.params.id]); if (taskRows.length > 0) { setorId = taskRows[0].setor_id; } } catch (e) { return res.status(500).json({ error: 'Erro interno.' }); } } if (!setorId) return res.status(400).json({ error: 'ID do setor não pôde ser determinado.' }); try { const [rows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if (rows.length === 0) return res.status(403).json({ error: 'Acesso negado: você não é membro deste setor.' }); req.userRole = rows[0].funcao; next(); } catch (error) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } };
const checkOwnership = (req, res, next) => { if (req.userRole !== 'dono' && req.funcaoGlobal !== 'master') { return res.status(403).json({ error: 'Acesso negado: privilégios de dono ou master necessários.' }); } next(); };

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, checkMembership, checkOwnership, async (req, res) => { const { id: setorId } = req.params; try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });
router.put('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const updates = req.body; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const tarefaAtual = taskRows[0]; const setorAtualId = tarefaAtual.setor_id; const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]); if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); } if (updates.setor_id && updates.setor_id !== setorAtualId) { const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]); if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); } } const statusAtualId = tarefaAtual.status_id; const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas']; const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key)); if (fieldsToUpdate.length > 0) { const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', '); const values = fieldsToUpdate.map(field => updates[field]); values.push(tarefaId); const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`; await connection.query(updateSql, values); } if (updates.status_id && updates.status_id !== statusAtualId) { const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [tarefaId, statusAtualId, updates.status_id, usuarioId]); const regraSql = 'SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?'; const [regras] = await connection.query(regraSql, [setorAtualId, updates.status_id]); if (regras.length > 0) { console.log(`[LOG Automação] ${regras.length} regra(s) encontrada(s). Executando...`); for (const regra of regras) { let novaDescricao = regra.template_descricao || `Gerado por: ${tarefaAtual.descricao}`; novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao); novaDescricao = novaDescricao.replace(/{id_original}/g, tarefaAtual.id); const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [regra.setor_destino_id]); if (statusDestinoRows.length > 0) { const statusInicialDestinoId = statusDestinoRows[0].id; const novaTarefaSql = `INSERT INTO tarefas (descricao, setor_id, status_id, responsavel_id) VALUES (?, ?, ?, ?);`; const [novaTarefaResult] = await connection.query(novaTarefaSql, [novaDescricao, regra.setor_destino_id, statusInicialDestinoId, null]); const novaTarefaId = novaTarefaResult.insertId; const novoHistorySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)'; await connection.query(novoHistorySql, [novaTarefaId, statusInicialDestinoId, usuarioId]); } } } } await connection.commit(); res.status(200).json({ message: 'Tarefa atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao atualizar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome, s_destino.nome AS setor_destino_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id JOIN setores s_destino ON r.setor_destino_id = s_destino.id `; const [regras] = await pool.query(sql); res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, acoes } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !Array.isArray(acoes) || acoes.length === 0) { return res.status(400).json({ error: 'Dados da regra inválidos ou faltando.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const regraSql = 'INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, usuario_criador_id) VALUES (?, ?, ?, ?)'; const [regraResult] = await connection.query(regraSql, [nome_regra, setor_origem_id, status_gatilho_id, usuarioId]); const novaRegraId = regraResult.insertId; for (const acao of acoes) { if (!acao.setor_destino_id) { throw new Error('Ação inválida: setor de destino é obrigatório.'); } const acaoSql = 'INSERT INTO acoes_automacao (regra_id, setor_destino_id, template_descricao) VALUES (?, ?, ?)'; await connection.query(acaoSql, [novaRegraId, acao.setor_destino_id, acao.template_descricao || '']); } await connection.commit(); res.status(201).json({ message: 'Regra de automação e suas ações foram criadas com sucesso!', id: novaRegraId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ? AND usuario_criador_id = ?', [regraId, req.usuarioId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada ou não pertence a você.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/

/*
const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const { authMiddleware, checkGlobalRole } = require('./authMiddleware');

router.post('/setores', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome } = req.body; const usuarioId = req.usuarioId; if (!nome) return res.status(400).json({ error: 'O nome do setor é obrigatório.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [setorResult] = await connection.query('INSERT INTO setores (nome) VALUES (?)', [nome]); const novoSetorId = setorResult.insertId; await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, novoSetorId, 'dono']); const statusPadrao = [{ nome: 'Pendente', ordem: 1 }, { nome: 'Em Andamento', ordem: 2 }, { nome: 'Concluído', ordem: 3 }]; for (const status of statusPadrao) { await connection.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [status.nome, novoSetorId, status.ordem]); } await connection.commit(); res.status(201).json({ message: 'Setor criado com sucesso!', id: novoSetorId }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este setor já existe.' }); console.error("Erro ao criar setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/setores', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT s.*, us.funcao FROM setores s JOIN usuarios_setores us ON s.id = us.setor_id WHERE us.usuario_id = ? ORDER BY s.nome ASC; `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao listar setores:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/status', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); const [statusRows] = await pool.query('SELECT * FROM status WHERE setor_id = ? ORDER BY ordem ASC', [setorId]); res.status(200).json(statusRows); } catch (error) { console.error("Erro ao listar status do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/setores/:id/convidar', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const [pRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if(pRows.length === 0 || (pRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) return res.status(403).json({ error: 'Acesso negado.'}); const { email: emailConvidado } = req.body; const usuarioConvidouId = req.usuarioId; if (!emailConvidado) return res.status(400).json({ error: 'O e-mail do convidado é obrigatório.' }); try { const [userRows] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [emailConvidado]); if (userRows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' }); const usuarioConvidadoId = userRows[0].id; const [memberRows] = await pool.query('SELECT id FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioConvidadoId, setorId]); if (memberRows.length > 0) return res.status(409).json({ error: 'Este usuário já é membro do setor.' }); await pool.query('INSERT INTO convites (setor_id, email_convidado, usuario_convidou_id) VALUES (?, ?, ?)', [setorId, emailConvidado, usuarioConvidouId]); res.status(201).json({ message: `Convite enviado para ${emailConvidado} com sucesso.` }); } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Um convite para este usuário já está pendente.' }); console.error("Erro ao criar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/setores/:id/membros', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para ver os membros deste setor.' }); const sql = ` SELECT u.id, u.email, us.funcao FROM usuarios u JOIN usuarios_setores us ON u.id = us.usuario_id WHERE us.setor_id = ? ORDER BY u.email`; const [members] = await pool.query(sql, [setorId]); res.status(200).json(members); } catch (error) { console.error("Erro ao listar membros do setor:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/setores/:id', authMiddleware, async (req, res) => { const { id: setorId } = req.params; const [pRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [req.usuarioId, setorId]); if(pRows.length === 0 || (pRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) return res.status(403).json({ error: 'Acesso negado.'}); try { await pool.query('DELETE FROM setores WHERE id = ?', [setorId]); res.status(200).json({ message: 'Setor e todas as suas tarefas foram deletados!' }); } catch (error) { res.status(500).json({ error: 'Erro interno do servidor ao deletar setor.' }); } });
router.post('/setores/:id/status', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [maxOrder] = await pool.query('SELECT MAX(ordem) as max_ordem FROM status WHERE setor_id = ?', [setorId]); const novaOrdem = (maxOrder[0].max_ordem || 0) + 1; const [result] = await pool.query('INSERT INTO status (nome, setor_id, ordem) VALUES (?, ?, ?)', [nome, setorId, novaOrdem]); res.status(201).json({ message: 'Status criado!', id: result.insertId, ordem: novaOrdem, nome: nome }); } catch (error) { res.status(500).json({ error: 'Erro ao criar status.' }); } });
router.put('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; const { nome } = req.body; if (!nome) return res.status(400).json({ error: 'O nome do status é obrigatório.' }); try { const [result] = await pool.query('UPDATE status SET nome = ? WHERE id = ?', [nome, statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status atualizado!' }); } catch (error) { res.status(500).json({ error: 'Erro ao atualizar status.' }); } });
router.delete('/status/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: statusId } = req.params; try { const [result] = await pool.query('DELETE FROM status WHERE id = ?', [statusId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Status não encontrado.' }); res.status(200).json({ message: 'Status deletado!' }); } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(400).json({ error: 'Não é possível deletar. Mova as tarefas desta coluna antes de excluí-la.' }); } console.error("Erro ao deletar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.put('/setores/:id/status/reorder', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: setorId } = req.params; const { orderedStatuses } = req.body; if (!Array.isArray(orderedStatuses)) { return res.status(400).json({ error: 'Lista de status ordenada é necessária.' }); } let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const updatePromises = orderedStatuses.map((status, index) => { const novaOrdem = index + 1; return connection.query('UPDATE status SET ordem = ? WHERE id = ? AND setor_id = ?', [novaOrdem, status.id, setorId]); }); await Promise.all(updatePromises); await connection.commit(); res.status(200).json({ message: 'Ordem das colunas atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao reordenar status:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/convites', authMiddleware, async (req, res) => { try { const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [req.usuarioId]); if (userRows.length === 0) { return res.status(200).json([]); } const userEmail = userRows[0].email; const sql = ` SELECT c.id AS convite_id, s.id AS setor_id, s.nome AS setor_nome FROM convites c JOIN setores s ON c.setor_id = s.id WHERE c.email_convidado = ? AND c.status = 'pendente' `; const [convites] = await pool.query(sql, [userEmail]); res.status(200).json(convites); } catch (error) { console.error("Erro ao listar convites:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/convites/:id/aceitar', authMiddleware, async (req, res) => { const { id: conviteId } = req.params; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [userRows] = await pool.query('SELECT email FROM usuarios WHERE id = ?', [usuarioId]); const [inviteRows] = await pool.query('SELECT * FROM convites WHERE id = ?', [conviteId]); if (inviteRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Convite não encontrado.' }); } const convite = inviteRows[0]; const userEmail = userRows[0].email; if (convite.email_convidado !== userEmail || convite.status !== 'pendente') { await connection.rollback(); return res.status(403).json({ error: 'Este convite não é válido para você.' }); } await connection.query('INSERT INTO usuarios_setores (usuario_id, setor_id, funcao) VALUES (?, ?, ?)', [usuarioId, convite.setor_id, 'membro']); await connection.query("UPDATE convites SET status = 'aceito' WHERE id = ?", [conviteId]); await connection.commit(); res.status(200).json({ message: 'Convite aceito! Você agora é membro do setor.' }); } catch (error) { if (connection) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Você já é membro deste setor.' }); } console.error("Erro ao aceitar convite:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.get('/tarefas', authMiddleware, async (req, res) => { const usuarioId = req.usuarioId; try { const sql = ` SELECT t.*, s.nome AS setor_nome, st.nome AS status_nome, u.email AS responsavel_email FROM tarefas t JOIN setores s ON t.setor_id = s.id JOIN status st ON t.status_id = st.id LEFT JOIN usuarios u ON t.responsavel_id = u.id WHERE t.setor_id IN ( SELECT setor_id FROM usuarios_setores WHERE usuario_id = ? ) `; const [rows] = await pool.query(sql, [usuarioId]); res.status(200).json(rows); } catch (error) { console.error("Erro ao buscar tarefas (API):", error); res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' }); } });
router.post('/tarefas', authMiddleware, async (req, res) => { const { descricao, responsavel_id, setor_id, data_prevista_conclusao } = req.body; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setor_id]); if (permRows.length === 0) return res.status(403).json({ error: 'Acesso negado a este setor.' }); let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [statusRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [setor_id]); if (statusRows.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Este setor não tem nenhum status configurado.' }); } const statusInicialId = statusRows[0].id; const tarefaSql = `INSERT INTO tarefas (descricao, responsavel_id, setor_id, status_id, data_prevista_conclusao) VALUES (?, ?, ?, ?, ?);`; const values = [descricao, responsavel_id || null, setor_id, statusInicialId, data_prevista_conclusao]; const [result] = await connection.query(tarefaSql, values); const novaTarefaId = result.insertId; const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [novaTarefaId, null, statusInicialId, usuarioId]); await connection.commit(); res.status(201).json({ message: 'Tarefa criada!', id: novaTarefaId }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao criar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } } catch (permError) { res.status(500).json({ error: 'Erro de permissão no servidor.' }); } });
router.put('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const updates = req.body; const usuarioId = req.usuarioId; let connection; try { connection = await pool.getConnection(); await connection.beginTransaction(); const [taskRows] = await connection.query('SELECT * FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const tarefaAtual = taskRows[0]; const setorAtualId = tarefaAtual.setor_id; const [permRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorAtualId]); if (permRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado para editar tarefas neste setor.' }); } if (updates.setor_id && updates.setor_id !== setorAtualId) { const [destPermRows] = await connection.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, updates.setor_id]); if (destPermRows.length === 0) { await connection.rollback(); return res.status(403).json({ error: 'Acesso negado ao setor de destino.' }); } } const statusAtualId = tarefaAtual.status_id; const colunasPermitidas = ['descricao', 'responsavel_id', 'setor_id', 'status_id', 'data_prevista_conclusao', 'data_finalizacao', 'notas']; const fieldsToUpdate = Object.keys(updates).filter(key => colunasPermitidas.includes(key)); if (fieldsToUpdate.length > 0) { const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', '); const values = fieldsToUpdate.map(field => updates[field]); values.push(tarefaId); const updateSql = `UPDATE tarefas SET ${setClause} WHERE id = ?`; await connection.query(updateSql, values); } if (updates.status_id && updates.status_id !== statusAtualId) { const historySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_anterior_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?, ?)'; await connection.query(historySql, [tarefaId, statusAtualId, updates.status_id, usuarioId]); const regraSql = 'SELECT * FROM regras_automacao WHERE setor_origem_id = ? AND status_gatilho_id = ?'; const [regras] = await connection.query(regraSql, [setorAtualId, updates.status_id]); if (regras.length > 0) { console.log(`[LOG Automação] ${regras.length} regra(s) encontrada(s). Executando...`); for (const regra of regras) { let novaDescricao = regra.template_descricao || `Gerado por: ${tarefaAtual.descricao}`; novaDescricao = novaDescricao.replace(/{descricao_original}/g, tarefaAtual.descricao); novaDescricao = novaDescricao.replace(/{id_original}/g, tarefaAtual.id); const [statusDestinoRows] = await connection.query('SELECT id FROM status WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1', [regra.setor_destino_id]); if (statusDestinoRows.length > 0) { const statusInicialDestinoId = statusDestinoRows[0].id; const novaTarefaSql = `INSERT INTO tarefas (descricao, setor_id, status_id, responsavel_id) VALUES (?, ?, ?, ?);`; const [novaTarefaResult] = await connection.query(novaTarefaSql, [novaDescricao, regra.setor_destino_id, statusInicialDestinoId, null]); const novaTarefaId = novaTarefaResult.insertId; const novoHistorySql = 'INSERT INTO historico_status_tarefas (tarefa_id, status_novo_id, usuario_alteracao_id) VALUES (?, ?, ?)'; await connection.query(novoHistorySql, [novaTarefaId, statusInicialDestinoId, usuarioId]); } } } } await connection.commit(); res.status(200).json({ message: 'Tarefa atualizada!' }); } catch (error) { if (connection) await connection.rollback(); console.error("Erro ao atualizar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } finally { if (connection) connection.release(); } });
router.delete('/tarefas/:id', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [taskRows] = await pool.query('SELECT setor_id FROM tarefas WHERE id = ?', [tarefaId]); if (taskRows.length === 0) { return res.status(404).json({ error: 'Tarefa não encontrada.' }); } const setorId = taskRows[0].setor_id; const [permRows] = await pool.query('SELECT funcao FROM usuarios_setores WHERE usuario_id = ? AND setor_id = ?', [usuarioId, setorId]); if (permRows.length === 0 || (permRows[0].funcao !== 'dono' && req.funcaoGlobal !== 'master')) { return res.status(403).json({ error: 'Acesso negado. Apenas o dono do setor ou um master pode deletar tarefas.' }); } const [result] = await pool.query('DELETE FROM tarefas WHERE id = ?', [tarefaId]); if (result.affectedRows === 0) return res.status(404).json({ error: 'Tarefa não encontrada.' }); res.status(200).json({ message: 'Tarefa deletada!' }); } catch (error) { console.error("Erro ao deletar tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/tarefas/:id/historico', authMiddleware, async (req, res) => { const { id: tarefaId } = req.params; const usuarioId = req.usuarioId; try { const [permRows] = await pool.query('SELECT 1 FROM usuarios_setores WHERE usuario_id = ? AND setor_id = (SELECT setor_id FROM tarefas WHERE id = ?)', [usuarioId, tarefaId]); if (permRows.length === 0) { return res.status(403).json({ error: 'Acesso negado a esta tarefa.' }); } const sql = ` SELECT h.status_anterior_id, st_ant.nome as status_anterior_nome, h.status_novo_id, st_novo.nome as status_novo_nome, h.data_alteracao, u.email AS usuario_alteracao_email FROM historico_status_tarefas h JOIN usuarios u ON h.usuario_alteracao_id = u.id LEFT JOIN status st_ant ON h.status_anterior_id = st_ant.id LEFT JOIN status st_novo ON h.status_novo_id = st_novo.id WHERE h.tarefa_id = ? ORDER BY h.data_alteracao ASC; `; const [history] = await pool.query(sql, [tarefaId]); res.status(200).json(history); } catch (error) { console.error("Erro ao buscar histórico da tarefa:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.get('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { try { const sql = ` SELECT r.*, s_origem.nome AS setor_origem_nome, st_gatilho.nome AS status_gatilho_nome, s_destino.nome AS setor_destino_nome FROM regras_automacao r JOIN setores s_origem ON r.setor_origem_id = s_origem.id JOIN status st_gatilho ON r.status_gatilho_id = st_gatilho.id JOIN setores s_destino ON r.setor_destino_id = s_destino.id `; const [regras] = await pool.query(sql); res.status(200).json(regras); } catch (error) { console.error("Erro ao listar regras de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.post('/regras_automacao', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { nome_regra, setor_origem_id, status_gatilho_id, setor_destino_id, template_descricao } = req.body; const usuarioId = req.usuarioId; if (!nome_regra || !setor_origem_id || !status_gatilho_id || !setor_destino_id) { return res.status(400).json({ error: 'Todos os campos são obrigatórios.' }); } try { const sql = ` INSERT INTO regras_automacao (nome_regra, setor_origem_id, status_gatilho_id, setor_destino_id, template_descricao, usuario_criador_id) VALUES (?, ?, ?, ?, ?, ?) `; const values = [nome_regra, setor_origem_id, status_gatilho_id, setor_destino_id, template_descricao || '', usuarioId]; const [result] = await pool.query(sql, values); res.status(201).json({ message: 'Regra de automação criada com sucesso!', id: result.insertId }); } catch (error) { console.error("Erro ao criar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });
router.delete('/regras_automacao/:id', authMiddleware, checkGlobalRole(['master']), async (req, res) => { const { id: regraId } = req.params; try { const [result] = await pool.query('DELETE FROM regras_automacao WHERE id = ?', [regraId]); if (result.affectedRows === 0) { return res.status(404).json({ error: 'Regra de automação não encontrada.' }); } res.status(200).json({ message: 'Regra de automação deletada com sucesso.' }); } catch (error) { console.error("Erro ao deletar regra de automação:", error); res.status(500).json({ error: 'Erro interno do servidor.' }); } });

module.exports = router;*/


