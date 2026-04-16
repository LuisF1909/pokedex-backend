const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Helper para generar código de amigo único (ej: PK-A1B2C3)
function generateFriendCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'PK-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const friendCode = generateFriendCode();

        const result = await db.query(
            'INSERT INTO users (email, password, friend_code) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, friendCode]
        );

        res.status(201).json({
            message: 'Usuario registrado exitosamente',
            user: { id: result.rows[0].id, email, friend_code: friendCode }
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El email ya está registrado.' });
        }
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    }

    try {
        const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, friend_code: user.friend_code },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login exitoso',
            token,
            user: { id: user.id, email: user.email, friend_code: user.friend_code }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error de base de datos.' });
    }
});

module.exports = router;
