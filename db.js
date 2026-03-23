const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Tabla de Usuarios
        db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      friend_code TEXT UNIQUE NOT NULL
    )`);

        // Tabla de Suscripciones Push
        db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription_json TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

        // Tabla de Favoritos
        db.run(`CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pokemon_id INTEGER NOT NULL,
      characteristics TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

        // Tabla de Equipos
        db.run(`CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      pokemon_ids TEXT NOT NULL, -- JSON string array
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

        // Tabla de Amigos
        db.run(`CREATE TABLE IF NOT EXISTS friends (
      user_id_1 INTEGER NOT NULL,
      user_id_2 INTEGER NOT NULL,
      PRIMARY KEY (user_id_1, user_id_2),
      FOREIGN KEY (user_id_1) REFERENCES users (id),
      FOREIGN KEY (user_id_2) REFERENCES users (id)
    )`);
    });
}

module.exports = db;
