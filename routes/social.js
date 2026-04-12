const express = require('express');
const axios = require('axios');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const webpush = require("web-push");
const { TYPE_CHART, getTypeEffectiveness, fetchPokemonBattleData, calculateDamage } = require('../battleUtils');

const router = express.Router();
router.use(authenticateToken); // Protegemos todas estas rutas

const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

// ==================================================
// HELPER: Enviar notificación push a un usuario por ID
// ==================================================
function enviarPushAUsuario(userId, payload) {
    return new Promise((resolve, reject) => {
        db.get('SELECT subscription_json FROM push_subscriptions WHERE user_id = ?', [userId], (err, row) => {
            if (err || !row) {
                return resolve(null);
            }
            const subscription = JSON.parse(row.subscription_json);
            webpush.sendNotification(subscription, JSON.stringify(payload))
                .then(() => resolve(true))
                .catch((pushErr) => {
                    console.error('Error enviando push a usuario', userId, pushErr.message);
                    if (pushErr.statusCode === 410) {
                        db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
                    }
                    resolve(false);
                });
        });
    });
}

// ==================================================
// FAVORITOS
// ==================================================

// GET /api/social/favorites
router.get('/favorites', (req, res) => {
    db.all('SELECT * FROM favorites WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error del servidor' });
        res.json(rows);
    });
});

// POST /api/social/favorites
router.post('/favorites', (req, res) => {
    const { pokemon_id, characteristics } = req.body;
    if (!pokemon_id) return res.status(400).json({ error: 'Falta pokemon_id' });

    db.get('SELECT id FROM favorites WHERE user_id = ? AND pokemon_id = ?', [req.user.id, pokemon_id], (err, row) => {
        if (row) {
            db.run('UPDATE favorites SET characteristics = ? WHERE id = ?', [characteristics || '', row.id]);
            return res.json({ message: 'Favorito actualizado' });
        } else {
            db.run('INSERT INTO favorites (user_id, pokemon_id, characteristics) VALUES (?, ?, ?)',
                [req.user.id, pokemon_id, characteristics || ''],
                function (err) {
                    if (err) return res.status(500).json({ error: 'Error agregando favorito' });
                    res.json({ message: 'Pokemon agregado a favoritos', id: this.lastID });
                });
        }
    });
});

// PUT /api/social/favorites/:id — Actualizar características de un favorito
router.put('/favorites/:id', (req, res) => {
    const { characteristics } = req.body;
    db.run('UPDATE favorites SET characteristics = ? WHERE id = ? AND user_id = ?',
        [characteristics || '', req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: 'Error actualizando favorito' });
            if (this.changes === 0) return res.status(404).json({ error: 'Favorito no encontrado' });
            res.json({ message: 'Características actualizadas' });
        });
});

// DELETE /api/social/favorites/:id
router.delete('/favorites/:id', (req, res) => {
    db.run('DELETE FROM favorites WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], err => {
        if (err) return res.status(500).json({ error: 'Error de BD' });
        res.json({ message: 'Favorito eliminado' });
    });
});

// ==================================================
// EQUIPOS
// ==================================================

// GET /api/social/teams — Mis equipos
router.get('/teams', (req, res) => {
    db.all('SELECT * FROM teams WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error del servidor' });
        const parsedRows = rows.map(r => ({ ...r, pokemon_ids: JSON.parse(r.pokemon_ids) }));
        res.json(parsedRows);
    });
});

// GET /api/social/teams/user/:userId — Equipos de un amigo (para batallas)
router.get('/teams/user/:userId', (req, res) => {
    const targetUserId = parseInt(req.params.userId);

    // Verificar que son amigos
    db.get('SELECT * FROM friends WHERE user_id_1 = ? AND user_id_2 = ?',
        [req.user.id, targetUserId], (err, friendship) => {
            if (err) return res.status(500).json({ error: 'Error del servidor' });
            if (!friendship) return res.status(403).json({ error: 'Solo puedes ver equipos de tus amigos' });

            db.all('SELECT id, name, pokemon_ids FROM teams WHERE user_id = ?', [targetUserId], (err, rows) => {
                if (err) return res.status(500).json({ error: 'Error del servidor' });
                const parsedRows = rows.map(r => ({ ...r, pokemon_ids: JSON.parse(r.pokemon_ids) }));
                res.json(parsedRows);
            });
        });
});

// POST /api/social/teams
router.post('/teams', (req, res) => {
    const { name, pokemon_ids } = req.body;

    if (!name || !Array.isArray(pokemon_ids) || pokemon_ids.length > 6) {
        return res.status(400).json({ error: 'Nombre de equipo y array de hasta 6 pokemones requerido.' });
    }

    db.run('INSERT INTO teams (user_id, name, pokemon_ids) VALUES (?, ?, ?)',
        [req.user.id, name, JSON.stringify(pokemon_ids)],
        function (err) {
            if (err) return res.status(500).json({ error: 'Error guardando equipo' });
            res.status(201).json({ message: 'Equipo creado', id: this.lastID });
        });
});

// PUT /api/social/teams/:id — Actualizar equipo
router.put('/teams/:id', (req, res) => {
    const { name, pokemon_ids } = req.body;

    if (!name || !Array.isArray(pokemon_ids) || pokemon_ids.length > 6 || pokemon_ids.length === 0) {
        return res.status(400).json({ error: 'Nombre y array de 1-6 pokemones requerido.' });
    }

    db.run('UPDATE teams SET name = ?, pokemon_ids = ? WHERE id = ? AND user_id = ?',
        [name, JSON.stringify(pokemon_ids), req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: 'Error actualizando equipo' });
            if (this.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
            res.json({ message: 'Equipo actualizado' });
        });
});

// DELETE /api/social/teams/:id — Eliminar equipo
router.delete('/teams/:id', (req, res) => {
    db.run('DELETE FROM teams WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: 'Error eliminando equipo' });
            if (this.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
            res.json({ message: 'Equipo eliminado' });
        });
});

// ==================================================
// AMIGOS
// ==================================================

// GET /api/social/friends
router.get('/friends', (req, res) => {
    const query = `
    SELECT u.id, u.email, u.friend_code 
    FROM friends f
    JOIN users u ON u.id = f.user_id_2
    WHERE f.user_id_1 = ?
  `;
    db.all(query, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error al obtener amigos' });
        res.json(rows);
    });
});

// POST /api/social/friends/add
router.post('/friends/add', (req, res) => {
    const { friend_code } = req.body;
    if (!friend_code) return res.status(400).json({ error: 'Se requiere un código de amigo.' });

    db.get('SELECT id, email FROM users WHERE friend_code = ?', [friend_code], (err, targetUser) => {
        if (err) return res.status(500).json({ error: 'Error de servidor' });
        if (!targetUser) return res.status(404).json({ error: 'Amigo no encontrado con ese código.' });
        if (targetUser.id === req.user.id) return res.status(400).json({ error: 'No puedes agregarte a ti mismo.' });

        db.serialize(() => {
            db.run('INSERT OR IGNORE INTO friends (user_id_1, user_id_2) VALUES (?, ?)', [req.user.id, targetUser.id]);
            db.run('INSERT OR IGNORE INTO friends (user_id_1, user_id_2) VALUES (?, ?)', [targetUser.id, req.user.id], (err) => {
                if (err) { /* Ignoramos el error si ya existían */ }

                enviarPushAUsuario(targetUser.id, {
                    titulo: '¡Nueva solicitud de amistad!',
                    mensaje: `${req.user.email} te ha agregado como amigo en la Pokédex.`
                });

                res.json({ message: `¡Ahora eres amigo de ${targetUser.email}!` });
            });
        });
    });
});

// ==================================================
// BATALLAS (Sistema con estadísticas reales)
// Las funciones de batalla se importan de ../battleUtils.js
// ==================================================

// POST /api/social/battles/prepare
// Devuelve los datos de ambos equipos con sus movimientos para batalla interactiva
router.post('/battles/prepare', async (req, res) => {
    const { friend_id, my_team_id, opponent_team_id } = req.body;

    if (!friend_id || !my_team_id) {
        return res.status(400).json({ error: 'Se requiere friend_id y my_team_id' });
    }

    try {
        const myTeam = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM teams WHERE id = ? AND user_id = ?', [my_team_id, req.user.id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!myTeam) return res.status(404).json({ error: 'Tu equipo no fue encontrado' });

        let opponentTeam;
        if (opponent_team_id) {
            opponentTeam = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM teams WHERE id = ? AND user_id = ?', [opponent_team_id, friend_id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
        } else {
            opponentTeam = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM teams WHERE user_id = ? LIMIT 1', [friend_id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
        }
        if (!opponentTeam) return res.status(404).json({ error: 'El oponente no tiene equipos' });

        const myPokemonIds = JSON.parse(myTeam.pokemon_ids);
        const opponentPokemonIds = JSON.parse(opponentTeam.pokemon_ids);

        const [myPokemonData, opponentPokemonData] = await Promise.all([
            Promise.all(myPokemonIds.map(id => fetchPokemonBattleData(id))),
            Promise.all(opponentPokemonIds.map(id => fetchPokemonBattleData(id)))
        ]);

        const myTeamData = myPokemonData.filter(p => p !== null);
        const opponentTeamData = opponentPokemonData.filter(p => p !== null);

        if (myTeamData.length === 0 || opponentTeamData.length === 0) {
            return res.status(400).json({ error: 'No se pudieron cargar los datos de los Pokémon' });
        }

        // Enviar push al amigo
        enviarPushAUsuario(friend_id, {
            titulo: '⚔️ ¡Te han retado a una batalla!',
            mensaje: `${req.user.email} te ha desafiado a una batalla Pokémon.`
        });

        res.json({
            myTeamName: myTeam.name,
            opponentTeamName: opponentTeam.name,
            myPokemon: myTeamData,
            opponentPokemon: opponentTeamData,
            typeChart: TYPE_CHART
        });

    } catch (error) {
        console.error('Error preparando batalla:', error);
        res.status(500).json({ error: 'Error preparando la batalla' });
    }
});

// POST /api/social/battles/challenge
router.post('/battles/challenge', async (req, res) => {
    const { friend_id, my_team_id, opponent_team_id } = req.body;

    if (!friend_id || !my_team_id) {
        return res.status(400).json({ error: 'Se requiere friend_id y my_team_id' });
    }

    try {
        // 1. Obtener mi equipo
        const myTeam = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM teams WHERE id = ? AND user_id = ?', [my_team_id, req.user.id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!myTeam) return res.status(404).json({ error: 'Tu equipo no fue encontrado' });

        // 2. Obtener equipo del oponente
        let opponentTeam;
        if (opponent_team_id) {
            opponentTeam = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM teams WHERE id = ? AND user_id = ?', [opponent_team_id, friend_id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
        } else {
            // Si no se especifica, tomar su primer equipo
            opponentTeam = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM teams WHERE user_id = ? LIMIT 1', [friend_id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });
        }
        if (!opponentTeam) return res.status(404).json({ error: 'El oponente no tiene equipos' });

        const myPokemonIds = JSON.parse(myTeam.pokemon_ids);
        const opponentPokemonIds = JSON.parse(opponentTeam.pokemon_ids);

        // 3. Fetch battle data de todos los pokémon
        const [myPokemonData, opponentPokemonData] = await Promise.all([
            Promise.all(myPokemonIds.map(id => fetchPokemonBattleData(id))),
            Promise.all(opponentPokemonIds.map(id => fetchPokemonBattleData(id)))
        ]);

        const myTeamData = myPokemonData.filter(p => p !== null);
        const opponentTeamData = opponentPokemonData.filter(p => p !== null);

        if (myTeamData.length === 0 || opponentTeamData.length === 0) {
            return res.status(400).json({ error: 'No se pudieron cargar los datos de los Pokémon' });
        }

        // 4. Simular batalla
        const battleLog = [];
        let myHP = myTeamData.map(p => ({ ...p, currentHP: p.stats.hp }));
        let opHP = opponentTeamData.map(p => ({ ...p, currentHP: p.stats.hp }));
        let myIndex = 0;
        let opIndex = 0;
        let round = 0;

        while (myIndex < myHP.length && opIndex < opHP.length && round < 100) {
            round++;
            const myPoke = myHP[myIndex];
            const opPoke = opHP[opIndex];

            const roundLog = {
                round,
                attacker1: { name: myPoke.name, id: myPoke.id },
                attacker2: { name: opPoke.name, id: opPoke.id },
                actions: []
            };

            // El más rápido ataca primero
            const myFirst = myPoke.stats.speed >= opPoke.stats.speed;
            const first = myFirst ? myPoke : opPoke;
            const second = myFirst ? opPoke : myPoke;

            // Primer ataque
            const hit1 = calculateDamage(first, second);
            second.currentHP -= hit1.damage;
            roundLog.actions.push({
                attacker: first.name,
                defender: second.name,
                damage: hit1.damage,
                effectiveness: hit1.effectiveness,
                attackType: hit1.attackType,
                remainingHP: Math.max(0, second.currentHP)
            });

            // Si el defensor sigue vivo, contraataca
            if (second.currentHP > 0) {
                const hit2 = calculateDamage(second, first);
                first.currentHP -= hit2.damage;
                roundLog.actions.push({
                    attacker: second.name,
                    defender: first.name,
                    damage: hit2.damage,
                    effectiveness: hit2.effectiveness,
                    attackType: hit2.attackType,
                    remainingHP: Math.max(0, first.currentHP)
                });
            }

            battleLog.push(roundLog);

            // Verificar si algún pokémon fue derrotado
            if (myPoke.currentHP <= 0) {
                myIndex++;
                battleLog.push({ event: 'fainted', pokemon: myPoke.name, team: 'Tú' });
            }
            if (opPoke.currentHP <= 0) {
                opIndex++;
                battleLog.push({ event: 'fainted', pokemon: opPoke.name, team: 'Oponente' });
            }
        }

        const winner = myIndex >= myHP.length ? 'Oponente' : 'Tú';
        const result = {
            winner,
            myTeamName: myTeam.name,
            opponentTeamName: opponentTeam.name,
            myPokemon: myTeamData.map(p => ({ name: p.name, id: p.id, types: p.types, image: p.image })),
            opponentPokemon: opponentTeamData.map(p => ({ name: p.name, id: p.id, types: p.types, image: p.image })),
            battleLog,
            totalRounds: round
        };

        // Enviar push al amigo retado
        enviarPushAUsuario(friend_id, {
            titulo: '⚔️ ¡Resultado de batalla!',
            mensaje: `${req.user.email} te ha desafiado. ${winner === 'Tú' ? 'Has perdido' : '¡Has ganado!'}`
        });

        res.json(result);

    } catch (error) {
        console.error('Error en batalla:', error);
        res.status(500).json({ error: 'Error ejecutando la batalla' });
    }
});

module.exports = router;
