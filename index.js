require("dotenv").config(); // Esto lee tu archivo .env (Requisito cumplido)
const express = require("express");
const cors = require("cors");
const webpush = require("web-push");

// Importar Base de Datos (esto inicializa SQLite)
const db = require("./db");
const { authenticateToken } = require("./middleware/auth");

// Importar Rutas
const authRoutes = require("./routes/auth");
const pokemonRoutes = require("./routes/pokemon");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// ==========================================================
// 1. CONFIGURACIÓN DEL SERVIDOR PUSH (Usando variables de entorno)
// ==========================================================
webpush.setVapidDetails(
  process.env.EMAIL_CONTACTO,
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
);

// Endpoints de Suscripción (Guarda en BD con autenticación JWT)
app.post("/api/subscribe", authenticateToken, (req, res) => {
  const suscripcion = req.body;
  const userId = req.user.id;
  const subscriptionJson = JSON.stringify(suscripcion);

  // Upsert: si ya existe una suscripción para este usuario, la actualizamos
  db.get('SELECT id FROM push_subscriptions WHERE user_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error de servidor' });

    if (row) {
      db.run('UPDATE push_subscriptions SET subscription_json = ? WHERE id = ?',
        [subscriptionJson, row.id],
        (err) => {
          if (err) return res.status(500).json({ error: 'Error actualizando suscripción' });
          res.status(200).json({ message: 'Suscripción push actualizada' });
        });
    } else {
      db.run('INSERT INTO push_subscriptions (user_id, subscription_json) VALUES (?, ?)',
        [userId, subscriptionJson],
        (err) => {
          if (err) return res.status(500).json({ error: 'Error guardando suscripción' });
          res.status(201).json({ message: 'Usuario suscrito a notificaciones' });
        });
    }
  });
});

// ==========================================================
// 2. RUTAS DE LA API (BFF)
// ==========================================================

// --- Autenticación ---
app.use("/api/auth", authRoutes);

// --- Proxies PokeAPI ---
app.use("/api/pokemon", pokemonRoutes);

// --- Funciones Sociales y de Usuario ---
const socialRoutes = require('./routes/social');
app.use("/api/social", socialRoutes);

// (Endpoints legado eliminados — la lógica Push se maneja en routes/social.js)

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});