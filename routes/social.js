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
async function enviarPushAUsuario(userId, payload) {
    try {
        const { rows } = await db.query('SELECT subscription_json FROM push_subscriptions WHERE user_id = $1', [userId]);
        if (!rows.length) return null;

        const subscription = JSON.parse(rows[0].subscription_json);
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (pushErr) {
        console.error('Error enviando push a usuario', userId, pushErr.message);
        if (pushErr.statusCode === 410) {
            await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
        }
        return false;
    }
}

// ==================================================
// FAVORITOS
// ==================================================

// GET /api/social/favorites
router.get('/favorites', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM favorites WHERE user_id = $1', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// POST /api/social/favorites
router.post('/favorites', async (req, res) => {
    const { pokemon_id, characteristics } = req.body;
    if (!pokemon_id) return res.status(400).json({ error: 'Falta pokemon_id' });

    try {
        const { rows } = await db.query(
            'SELECT id FROM favorites WHERE user_id = $1 AND pokemon_id = $2',
            [req.user.id, pokemon_id]
        );

        if (rows.length > 0) {
            await db.query('UPDATE favorites SET characteristics = $1 WHERE id = $2', [characteristics || '', rows[0].id]);
            return res.json({ message: 'Favorito actualizado' });
        } else {
            const result = await db.query(
                'INSERT INTO favorites (user_id, pokemon_id, characteristics) VALUES ($1, $2, $3) RETURNING id',
                [req.user.id, pokemon_id, characteristics || '']
            );
            res.json({ message: 'Pokemon agregado a favoritos', id: result.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: 'Error agregando favorito' });
    }
});

// PUT /api/social/favorites/:id — Actualizar características de un favorito
router.put('/favorites/:id', async (req, res) => {
    const { characteristics } = req.body;
    try {
        const result = await db.query(
            'UPDATE favorites SET characteristics = $1 WHERE id = $2 AND user_id = $3',
            [characteristics || '', req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Favorito no encontrado' });
        res.json({ message: 'Características actualizadas' });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando favorito' });
    }
});

// DELETE /api/social/favorites/:id
router.delete('/favorites/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM favorites WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ message: 'Favorito eliminado' });
    } catch (err) {
        res.status(500).json({ error: 'Error de BD' });
    }
});

// ==================================================
// EQUIPOS
// ==================================================

// GET /api/social/teams — Mis equipos
router.get('/teams', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM teams WHERE user_id = $1', [req.user.id]);
        const parsedRows = rows.map(r => ({ ...r, pokemon_ids: JSON.parse(r.pokemon_ids) }));
        res.json(parsedRows);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// GET /api/social/teams/user/:userId — Equipos de un amigo (para batallas)
router.get('/teams/user/:userId', async (req, res) => {
    const targetUserId = parseInt(req.params.userId);

    try {
        const { rows: friendship } = await db.query(
            'SELECT * FROM friends WHERE user_id_1 = $1 AND user_id_2 = $2',
            [req.user.id, targetUserId]
        );
        if (!friendship.length) return res.status(403).json({ error: 'Solo puedes ver equipos de tus amigos' });

        const { rows } = await db.query('SELECT id, name, pokemon_ids FROM teams WHERE user_id = $1', [targetUserId]);
        const parsedRows = rows.map(r => ({ ...r, pokemon_ids: JSON.parse(r.pokemon_ids) }));
        res.json(parsedRows);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// POST /api/social/teams
router.post('/teams', async (req, res) => {
    const { name, pokemon_ids } = req.body;

    if (!name || !Array.isArray(pokemon_ids) || pokemon_ids.length > 6) {
        return res.status(400).json({ error: 'Nombre de equipo y array de hasta 6 pokemones requerido.' });
    }

    try {
        const result = await db.query(
            'INSERT INTO teams (user_id, name, pokemon_ids) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, name, JSON.stringify(pokemon_ids)]
        );
        res.status(201).json({ message: 'Equipo creado', id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'Error guardando equipo' });
    }
});

// PUT /api/social/teams/:id — Actualizar equipo
router.put('/teams/:id', async (req, res) => {
    const { name, pokemon_ids } = req.body;

    if (!name || !Array.isArray(pokemon_ids) || pokemon_ids.length > 6 || pokemon_ids.length === 0) {
        return res.status(400).json({ error: 'Nombre y array de 1-6 pokemones requerido.' });
    }

    try {
        const result = await db.query(
            'UPDATE teams SET name = $1, pokemon_ids = $2 WHERE id = $3 AND user_id = $4',
            [name, JSON.stringify(pokemon_ids), req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
        res.json({ message: 'Equipo actualizado' });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando equipo' });
    }
});

// DELETE /api/social/teams/:id — Eliminar equipo
router.delete('/teams/:id', async (req, res) => {
    try {
        const result = await db.query(
            'DELETE FROM teams WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
        res.json({ message: 'Equipo eliminado' });
    } catch (err) {
        res.status(500).json({ error: 'Error eliminando equipo' });
    }
});

// ==================================================
// AMIGOS
// ==================================================

// GET /api/social/friends
router.get('/friends', async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT u.id, u.email, u.friend_code
            FROM friends f
            JOIN users u ON u.id = f.user_id_2
            WHERE f.user_id_1 = $1
        `, [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener amigos' });
    }
});

// POST /api/social/friends/add
router.post('/friends/add', async (req, res) => {
    const { friend_code } = req.body;
    if (!friend_code) return res.status(400).json({ error: 'Se requiere un código de amigo.' });

    try {
        const { rows } = await db.query('SELECT id, email FROM users WHERE friend_code = $1', [friend_code]);
        const targetUser = rows[0];

        if (!targetUser) return res.status(404).json({ error: 'Amigo no encontrado con ese código.' });
        if (targetUser.id === req.user.id) return res.status(400).json({ error: 'No puedes agregarte a ti mismo.' });

        await db.query(
            'INSERT INTO friends (user_id_1, user_id_2) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.user.id, targetUser.id]
        );
        await db.query(
            'INSERT INTO friends (user_id_1, user_id_2) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [targetUser.id, req.user.id]
        );

        enviarPushAUsuario(targetUser.id, {
            titulo: '¡Nueva solicitud de amistad!',
            mensaje: `${req.user.email} te ha agregado como amigo en la Pokédex.`
        });

        res.json({ message: `¡Ahora eres amigo de ${targetUser.email}!` });
    } catch (err) {
        res.status(500).json({ error: 'Error de servidor' });
    }
});

// ==================================================
// BATALLAS (Sistema con estadísticas reales)
// Las funciones de batalla se importan de ../battleUtils.js
// ==================================================

// POST /api/social/battles/prepare
router.post('/battles/prepare', async (req, res) => {
    const { friend_id, my_team_id, opponent_team_id } = req.body;

    if (!friend_id || !my_team_id) {
        return res.status(400).json({ error: 'Se requiere friend_id y my_team_id' });
    }

    try {
        const { rows: myTeamRows } = await db.query(
            'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
            [my_team_id, req.user.id]
        );
        const myTeam = myTeamRows[0];
        if (!myTeam) return res.status(404).json({ error: 'Tu equipo no fue encontrado' });

        let opponentTeam;
        if (opponent_team_id) {
            const { rows } = await db.query(
                'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
                [opponent_team_id, friend_id]
            );
            opponentTeam = rows[0];
        } else {
            const { rows } = await db.query(
                'SELECT * FROM teams WHERE user_id = $1 LIMIT 1',
                [friend_id]
            );
            opponentTeam = rows[0];
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
        const { rows: myTeamRows } = await db.query(
            'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
            [my_team_id, req.user.id]
        );
        const myTeam = myTeamRows[0];
        if (!myTeam) return res.status(404).json({ error: 'Tu equipo no fue encontrado' });

        let opponentTeam;
        if (opponent_team_id) {
            const { rows } = await db.query(
                'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
                [opponent_team_id, friend_id]
            );
            opponentTeam = rows[0];
        } else {
            const { rows } = await db.query(
                'SELECT * FROM teams WHERE user_id = $1 LIMIT 1',
                [friend_id]
            );
            opponentTeam = rows[0];
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

        // Simular batalla
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

            const myFirst = myPoke.stats.speed >= opPoke.stats.speed;
            const first = myFirst ? myPoke : opPoke;
            const second = myFirst ? opPoke : myPoke;

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
