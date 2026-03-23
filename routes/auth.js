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

        const stmt = db.prepare('INSERT INTO users (email, password, friend_code) VALUES (?, ?, ?)');
        stmt.run([email, hashedPassword, friendCode], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'El email ya está registrado.' });
                }
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }

            // Devolvemos datos del usuario pero sin la contraseña
            res.status(201).json({
                message: 'Usuario registrado exitosamente',
                user: { id: this.lastID, email, friend_code: friendCode }
            });
        });
        stmt.finalize();
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar el registro.' });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error de base de datos.' });
        }
        if (!user) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                const token = jwt.sign(
                    { id: user.id, email: user.email, friend_code: user.friend_code },
                    JWT_SECRET,
                    { expiresIn: '7d' } // Expira en 7 días
                );

                res.json({
                    message: 'Login exitoso',
                    token,
                    user: { id: user.id, email: user.email, friend_code: user.friend_code }
                });
            } else {
                res.status(400).json({ error: 'Credenciales inválidas.' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Error al verificar la contraseña.' });
        }
    });
});

module.exports = router;
