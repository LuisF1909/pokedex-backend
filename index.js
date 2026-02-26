const express = require("express");
const cors = require("cors");
const webpush = require("web-push");
require("dotenv").config(); // Esto lee tu archivo .env (Requisito cumplido)

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

// Array temporal para simular una base de datos de usuarios
let suscripcionesGuardadas = [];

// Endpoint para guardar suscripciones
app.post("/api/subscribe", (req, res) => {
  const suscripcion = req.body;
  suscripcionesGuardadas.push(suscripcion);
  res.status(201).json({ message: "Usuario suscrito a notificaciones" });
});

// ==========================================================
// 2. ENDPOINTS PARA ENVIAR NOTIFICACIONES PUSH
// ==========================================================

// Endpoint: Invitación de Amistad
app.post("/api/amigos/invitar", (req, res) => {
  const payload = JSON.stringify({
    titulo: "¡Nueva Solicitud de Amistad!",
    mensaje: "Un entrenador quiere agregarte a su lista de amigos."
  });

  suscripcionesGuardadas.forEach(suscripcion => {
    webpush.sendNotification(suscripcion, payload).catch(err => console.error(err));
  });
  
  res.status(200).json({ message: "Notificación de amistad enviada" });
});

// Endpoint: Reto a Batalla
app.post("/api/batallas/retar", (req, res) => {
  const payload = JSON.stringify({
    titulo: "¡Te han retado a una batalla!",
    mensaje: "¡Prepara tu equipo Pokémon, la batalla está por comenzar!"
  });

  suscripcionesGuardadas.forEach(suscripcion => {
    webpush.sendNotification(suscripcion, payload).catch(err => console.error(err));
  });
  
  res.status(200).json({ message: "Notificación de batalla enviada" });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});