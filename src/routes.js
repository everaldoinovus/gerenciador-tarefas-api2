// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// ===============================================
// MIDDLEWARES DE PERMISSÃO (simplificados para uso futuro)
// ===============================================
const checkMembership = (req, res, next) => { next(); };
const checkOwnership = (req, res, next) => { next(); };

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

// NOVA ROTA PARA BUSCAR OS STATUS (COLUNAS) DE UM SETOR
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

// ===============================================
// ROTAS DE TAREFAS
// ===============================================

// ROTA GET TAREFAS ATUALIZADA PARA O NOVO MODELO
router.get('/tarefas', authMiddleware, async (req, res) => {
    const usuarioId = req.usuarioId;
    try {
        const sql = `
            SELECT 
                t.*, 
                s.nome AS setor_nome,
                st.nome AS status_nome,
                u.email AS responsavel_email
            FROM tarefas t
            JOIN setores s ON t.setor_id = s.id
            JOIN status st ON t.status_id = st.id
            LEFT JOIN usuarios u ON t.responsavel_id = u.id
            WHERE t.setor_id IN (
                SELECT setor_id FROM usuarios_setores WHERE usuario_id = ?
            )
        `;
        const [rows] = await pool.query(sql, [usuarioId]);
        res.status(200).json(rows);
    } catch (error) {
        console.error("Erro ao buscar tarefas (API):", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar tarefas.' });
    }
});


// As rotas abaixo serão o nosso próximo foco de trabalho
router.post('/tarefas', authMiddleware, (req, res) => res.status(501).json({ message: 'Rota POST /tarefas a ser implementada.' }));
router.put('/tarefas/:id', authMiddleware, (req, res) => res.status(501).json({ message: 'Rota PUT /tarefas/:id a ser implementada.' }));
router.delete('/tarefas/:id', authMiddleware, (req, res) => res.status(501).json({ message: 'Rota DELETE /tarefas/:id a ser implementada.' }));

// Rotas de convites, membros e histórico também serão reativadas depois
router.post('/setores/:id/convidar', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.get('/setores/:id/membros', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.get('/convites', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.post('/convites/:id/aceitar', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.get('/tarefas/:id/historico', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));


module.exports = router;