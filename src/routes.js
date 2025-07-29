// Arquivo: gerenciador-tarefas-api/src/routes.js

const express = require('express');
const router = express.Router();
const pool = require('./config/database');
const authMiddleware = require('./authMiddleware');

// ===============================================
// MIDDLEWARE DE PERMISSÕES (será usado nas próximas etapas)
// ===============================================
const checkMembership = async (req, res, next) => {
    // ... (lógica futura)
    next();
};

const checkOwnership = (req, res, next) => {
    // ... (lógica futura)
    next();
};

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

        const statusPadrao = [
            { nome: 'Pendente', ordem: 1 },
            { nome: 'Em Andamento', ordem: 2 },
            { nome: 'Concluído', ordem: 3 }
        ];
        
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

// ROTA OBSOLETA - SERÁ REESCRITA
router.get('/setores', authMiddleware, async (req, res) => {
    // Este código precisa ser atualizado para o modelo de colaboração
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

// O restante das rotas está temporariamente comentado ou simplificado
// para evitar erros. Nós as reescreveremos nas próximas etapas.

// ROTAS DE CONVITES
router.post('/setores/:id/convidar', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.get('/convites', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.post('/convites/:id/aceitar', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));

// ROTAS DE TAREFAS
router.get('/tarefas', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.post('/tarefas', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.put('/tarefas/:id', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.delete('/tarefas/:id', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));
router.get('/tarefas/:id/historico', authMiddleware, (req, res) => res.status(501).json({ message: 'Não implementado.'}));


module.exports = router;