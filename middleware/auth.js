const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pokedex_super_secret_key_123';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado.' });
        }

        // El 'user' decodificado (ej: { id: 1, email: "..." })
        req.user = user;
        next();
    });
}

module.exports = { authenticateToken, JWT_SECRET };
