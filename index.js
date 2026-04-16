require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const webpush = require("web-push");

// Importar Base de Datos (esto inicializa PostgreSQL)
const db = require("./db");
const { authenticateToken } = require("./middleware/auth");
const { initBattleSocket } = require("./battleSocket");

// Importar Rutas
const authRoutes = require("./routes/auth");
const pokemonRoutes = require("./routes/pokemon");
const socialRoutes = require('./routes/social');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// Configuración CORS dinámica
const allowedOrigins = process.env.FRONTEND_URL || "*";

app.use(cors({
  origin: allowedOrigins === "*" ? "*" : allowedOrigins.split(",").map(s => s.trim()),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: allowedOrigins !== "*"
}));

// Socket.IO con CORS
const io = new Server(server, {
  cors: {
    origin: allowedOrigins === "*" ? "*" : allowedOrigins.split(",").map(s => s.trim()),
    methods: ["GET", "POST"]
  }
});

// Inicializar WebSocket de batallas
initBattleSocket(io);

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
app.post("/api/subscribe", authenticateToken, async (req, res) => {
  const suscripcion = req.body;
  const userId = req.user.id;
  const subscriptionJson = JSON.stringify(suscripcion);

  try {
    const { rows } = await db.query('SELECT id FROM push_subscriptions WHERE user_id = $1', [userId]);

    if (rows.length > 0) {
      await db.query('UPDATE push_subscriptions SET subscription_json = $1 WHERE id = $2', [subscriptionJson, rows[0].id]);
      res.status(200).json({ message: 'Suscripción push actualizada' });
    } else {
      await db.query('INSERT INTO push_subscriptions (user_id, subscription_json) VALUES ($1, $2)', [userId, subscriptionJson]);
      res.status(201).json({ message: 'Usuario suscrito a notificaciones' });
    }
  } catch (err) {
    console.error('Error en suscripción push:', err.message);
    res.status(500).json({ error: 'Error de servidor' });
  }
});

// ==========================================================
// 2. RUTAS DE LA API (BFF)
// ==========================================================

// --- Autenticación ---
app.use("/api/auth", authRoutes);

// --- Proxies PokeAPI ---
app.use("/api/pokemon", pokemonRoutes);

// --- Funciones Sociales y de Usuario ---
app.use("/api/social", socialRoutes);

// Health check endpoint (útil para Railway)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ==========================================================
// 3. INICIAR SERVIDOR
// ==========================================================
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Servidor escuchando en http://0.0.0.0:${port}`);
  console.log(`📡 CORS permitido para: ${allowedOrigins}`);
});