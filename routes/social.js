const express = require('express');
const axios = require('axios');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const webpush = require("web-push");

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
// ==================================================

// Tabla de efectividad de tipos
const TYPE_CHART = {
    normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
    fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
    dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
};

function getTypeEffectiveness(attackType, defenseTypes) {
    let multiplier = 1;
    for (const defType of defenseTypes) {
        const chart = TYPE_CHART[attackType];
        if (chart && chart[defType] !== undefined) {
            multiplier *= chart[defType];
        }
    }
    return multiplier;
}

// Obtener stats y movimientos de un Pokémon desde PokeAPI
async function fetchPokemonBattleData(pokemonId) {
    try {
        const res = await axios.get(`${POKEAPI_BASE}/pokemon/${pokemonId}`);
        const data = res.data;
        const stats = {};
        data.stats.forEach(s => { stats[s.stat.name] = s.base_stat; });

        // Obtener los primeros 4 movimientos de daño con datos completos
        const moveUrls = data.moves.slice(0, 20); // Tomar pool de 20 para filtrar
        const moveDetails = [];

        for (const moveEntry of moveUrls) {
            if (moveDetails.length >= 4) break;
            try {
                const moveRes = await axios.get(moveEntry.move.url);
                const m = moveRes.data;
                // Solo movimientos que hacen daño (power > 0)
                if (m.power && m.power > 0) {
                    const nameEs = m.names?.find(n => n.language.name === 'es')?.name
                        || m.names?.find(n => n.language.name === 'en')?.name
                        || m.name;
                    moveDetails.push({
                        name: nameEs,
                        internalName: m.name,
                        power: m.power,
                        type: m.type.name,
                        damageClass: m.damage_class.name, // 'physical' o 'special'
                        accuracy: m.accuracy || 100,
                        pp: m.pp
                    });
                }
            } catch (e) { /* Si falla un move lo ignoramos */ }
        }

        // Si no encontramos suficientes movimientos, agregar uno genérico
        if (moveDetails.length === 0) {
            moveDetails.push({
                name: 'Placaje',
                internalName: 'tackle',
                power: 40,
                type: 'normal',
                damageClass: 'physical',
                accuracy: 100,
                pp: 35
            });
        }

        return {
            id: data.id,
            name: data.name,
            types: data.types.map(t => t.type.name),
            stats,
            moves: moveDetails,
            image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${data.id}.png`,
            sprite: data.sprites.front_default
        };
    } catch (err) {
        return null;
    }
}

// Calcular daño de un ataque con movimiento específico
function calculateDamage(attacker, defender, move) {
    const attackType = move ? move.type : attacker.types[0];
    const effectiveness = getTypeEffectiveness(attackType, defender.types);

    const level = 50;
    const power = move ? move.power : 80;
    const isSpecial = move ? move.damageClass === 'special'
        : ['fire', 'water', 'electric', 'grass', 'ice', 'psychic', 'dragon', 'dark', 'fairy'].includes(attackType);
    const atkStat = isSpecial ? attacker.stats['special-attack'] : attacker.stats['attack'];
    const defStat = isSpecial ? defender.stats['special-defense'] : defender.stats['defense'];

    // STAB (Same Type Attack Bonus)
    const stab = attacker.types.includes(attackType) ? 1.5 : 1;

    // Variación aleatoria (85-100%)
    const random = (Math.random() * 0.15 + 0.85);

    // Precisión
    const accuracy = move ? (move.accuracy || 100) : 100;
    if (Math.random() * 100 > accuracy) {
        return { damage: 0, effectiveness, attackType, moveName: move?.name || 'Ataque', missed: true };
    }

    const damage = Math.floor(
        (((2 * level / 5 + 2) * power * atkStat / defStat) / 50 + 2) * stab * effectiveness * random
    );

    return {
        damage: Math.max(1, damage),
        effectiveness,
        attackType,
        moveName: move?.name || 'Ataque',
        missed: false
    };
}

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
