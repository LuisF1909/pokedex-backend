const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            friend_code TEXT UNIQUE NOT NULL
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            subscription_json TEXT NOT NULL
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS favorites (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            pokemon_id INTEGER NOT NULL,
            characteristics TEXT
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS teams (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            pokemon_ids TEXT NOT NULL
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS friends (
            user_id_1 INTEGER NOT NULL REFERENCES users(id),
            user_id_2 INTEGER NOT NULL REFERENCES users(id),
            PRIMARY KEY (user_id_1, user_id_2)
        )`);

        console.log('Base de datos PostgreSQL inicializada.');
    } finally {
        client.release();
    }
}

pool.connect((err, client, release) => {
    if (err) {
        console.error('Error al conectar con PostgreSQL:', err.message);
    } else {
        release();
        console.log('Conectado a PostgreSQL.');
        initDb().catch(console.error);
    }
});

module.exports = pool;
