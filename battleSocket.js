const jwt = require('jsonwebtoken');
const db = require('./db');
const { fetchPokemonBattleData, calculateDamage } = require('./battleUtils');

// Estado en memoria de batallas activas
const battles = new Map();
// Mapa de userId → socketId para encontrar jugadores conectados
const userSockets = new Map();
// Retos pendientes
const pendingChallenges = new Map();

let challengeCounter = 0;

function initBattleSocket(io) {
    // Middleware de autenticación JWT
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error('Token requerido'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error('Token inválido'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user.id;
        console.log(`⚡ Socket conectado: usuario ${userId} (${socket.id})`);
        userSockets.set(userId, socket.id);

        // =============================================
        // ENVIAR RETO A UN AMIGO
        // =============================================
        socket.on('challenge-friend', async (data) => {
            const { friendId, myTeamId } = data;

            if (!friendId || !myTeamId) {
                return socket.emit('error-msg', { message: 'Faltan datos para el reto' });
            }

            // Verificar amistad
            const friendship = await dbGet(
                'SELECT * FROM friends WHERE user_id_1 = $1 AND user_id_2 = $2',
                [userId, friendId]
            );
            if (!friendship) {
                return socket.emit('error-msg', { message: 'Solo puedes retar a tus amigos' });
            }

            // Verificar que el equipo existe
            const team = await dbGet(
                'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
                [myTeamId, userId]
            );
            if (!team) {
                return socket.emit('error-msg', { message: 'Equipo no encontrado' });
            }

            // Obtener email del retador
            const challenger = await dbGet('SELECT email FROM users WHERE id = $1', [userId]);

            const challengeId = `challenge_${++challengeCounter}_${Date.now()}`;
            pendingChallenges.set(challengeId, {
                challengerId: userId,
                challengerSocketId: socket.id,
                challengerTeamId: myTeamId,
                friendId: friendId,
                createdAt: Date.now()
            });

            // Enviar invitación al amigo si está conectado
            const friendSocketId = userSockets.get(friendId);
            if (friendSocketId) {
                io.to(friendSocketId).emit('battle-invitation', {
                    challengeId,
                    challengerEmail: challenger?.email || 'Entrenador',
                    challengerId: userId
                });
                socket.emit('challenge-sent', { challengeId, message: 'Reto enviado, esperando respuesta...' });
            } else {
                socket.emit('error-msg', { message: 'Tu amigo no está conectado en este momento' });
                pendingChallenges.delete(challengeId);
            }
        });

        // =============================================
        // ACEPTAR RETO
        // =============================================
        socket.on('accept-challenge', async (data) => {
            const { challengeId, myTeamId } = data;

            const challenge = pendingChallenges.get(challengeId);
            if (!challenge) {
                return socket.emit('error-msg', { message: 'Este reto ya no está disponible' });
            }

            if (challenge.friendId !== userId) {
                return socket.emit('error-msg', { message: 'Este reto no es para ti' });
            }

            // Verificar equipo del aceptante
            const team = await dbGet(
                'SELECT * FROM teams WHERE id = $1 AND user_id = $2',
                [myTeamId, userId]
            );
            if (!team) {
                return socket.emit('error-msg', { message: 'Equipo no encontrado' });
            }

            pendingChallenges.delete(challengeId);

            // Crear la batalla
            const battleId = `battle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

            try {
                // Cargar datos de ambos equipos
                const challengerTeam = await dbGet(
                    'SELECT * FROM teams WHERE id = $1',
                    [challenge.challengerTeamId]
                );
                const accepterTeam = team;

                const challengerPokemonIds = JSON.parse(challengerTeam.pokemon_ids);
                const accepterPokemonIds = JSON.parse(accepterTeam.pokemon_ids);

                // Notificar que estamos cargando
                const challengerSocketId = userSockets.get(challenge.challengerId);
                if (challengerSocketId) {
                    io.to(challengerSocketId).emit('battle-loading', { battleId });
                }
                socket.emit('battle-loading', { battleId });

                const [challengerPokemonData, accepterPokemonData] = await Promise.all([
                    Promise.all(challengerPokemonIds.map(id => fetchPokemonBattleData(id))),
                    Promise.all(accepterPokemonIds.map(id => fetchPokemonBattleData(id)))
                ]);

                const p1Team = challengerPokemonData.filter(p => p !== null);
                const p2Team = accepterPokemonData.filter(p => p !== null);

                if (p1Team.length === 0 || p2Team.length === 0) {
                    const errMsg = { message: 'No se pudieron cargar los datos de los Pokémon' };
                    socket.emit('error-msg', errMsg);
                    if (challengerSocketId) io.to(challengerSocketId).emit('error-msg', errMsg);
                    return;
                }

                // Crear sala de batalla
                const battle = {
                    id: battleId,
                    players: {
                        p1: {
                            userId: challenge.challengerId,
                            socketId: challengerSocketId,
                            teamName: challengerTeam.name,
                            team: p1Team,
                            activeIndex: 0,
                            hp: p1Team.map(p => p.stats.hp)
                        },
                        p2: {
                            userId: userId,
                            socketId: socket.id,
                            teamName: accepterTeam.name,
                            team: p2Team,
                            activeIndex: 0,
                            hp: p2Team.map(p => p.stats.hp)
                        }
                    },
                    status: 'active',
                    currentTurnMoves: { p1: null, p2: null },
                    turnNumber: 0
                };

                battles.set(battleId, battle);

                // Unir ambos sockets a la sala
                const p1Socket = io.sockets.sockets.get(challengerSocketId);
                if (p1Socket) p1Socket.join(battleId);
                socket.join(battleId);

                // Enviar datos de batalla a ambos jugadores
                // Cada jugador recibe su equipo como "myPokemon" y el del oponente como "opponentPokemon"
                if (challengerSocketId) {
                    io.to(challengerSocketId).emit('battle-start', {
                        battleId,
                        myTeamName: challengerTeam.name,
                        opponentTeamName: accepterTeam.name,
                        myPokemon: p1Team,
                        opponentPokemon: p2Team,
                        playerRole: 'p1'
                    });
                }

                socket.emit('battle-start', {
                    battleId,
                    myTeamName: accepterTeam.name,
                    opponentTeamName: challengerTeam.name,
                    myPokemon: p2Team,
                    opponentPokemon: p1Team,
                    playerRole: 'p2'
                });

            } catch (err) {
                console.error('Error creando batalla:', err);
                socket.emit('error-msg', { message: 'Error al crear la batalla' });
            }
        });

        // =============================================
        // RECHAZAR RETO
        // =============================================
        socket.on('reject-challenge', (data) => {
            const { challengeId } = data;
            const challenge = pendingChallenges.get(challengeId);
            if (!challenge) return;

            pendingChallenges.delete(challengeId);

            const challengerSocketId = userSockets.get(challenge.challengerId);
            if (challengerSocketId) {
                io.to(challengerSocketId).emit('challenge-rejected', {
                    message: 'Tu reto ha sido rechazado 😔'
                });
            }
        });

        // =============================================
        // SELECCIONAR MOVIMIENTO
        // =============================================
        socket.on('select-move', (data) => {
            const { battleId, moveIndex } = data;
            const battle = battles.get(battleId);

            if (!battle || battle.status !== 'active') {
                return socket.emit('error-msg', { message: 'Batalla no encontrada o ya terminó' });
            }

            // Determinar si es p1 o p2
            let playerRole = null;
            if (battle.players.p1.userId === userId) playerRole = 'p1';
            else if (battle.players.p2.userId === userId) playerRole = 'p2';

            if (!playerRole) {
                return socket.emit('error-msg', { message: 'No eres parte de esta batalla' });
            }

            // Validar moveIndex
            const player = battle.players[playerRole];
            const activePokemon = player.team[player.activeIndex];
            if (moveIndex < 0 || moveIndex >= activePokemon.moves.length) {
                return socket.emit('error-msg', { message: 'Movimiento inválido' });
            }

            // Registrar movimiento
            battle.currentTurnMoves[playerRole] = moveIndex;

            // Notificar al oponente que ya eligió
            const opponentRole = playerRole === 'p1' ? 'p2' : 'p1';
            const opponentSocketId = battle.players[opponentRole].socketId;
            if (opponentSocketId) {
                io.to(opponentSocketId).emit('opponent-chose-move');
            }

            // Si ambos eligieron, resolver turno
            if (battle.currentTurnMoves.p1 !== null && battle.currentTurnMoves.p2 !== null) {
                resolveTurn(io, battle);
            }
        });

        // =============================================
        // DESCONEXIÓN
        // =============================================
        socket.on('disconnect', () => {
            console.log(`❌ Socket desconectado: usuario ${userId}`);
            userSockets.delete(userId);

            // Buscar batallas activas de este usuario
            for (const [battleId, battle] of battles) {
                if (battle.status !== 'active') continue;

                let disconnectedRole = null;
                if (battle.players.p1.userId === userId) disconnectedRole = 'p1';
                else if (battle.players.p2.userId === userId) disconnectedRole = 'p2';

                if (disconnectedRole) {
                    battle.status = 'finished';
                    const opponentRole = disconnectedRole === 'p1' ? 'p2' : 'p1';
                    const opponentSocketId = battle.players[opponentRole].socketId;
                    if (opponentSocketId) {
                        io.to(opponentSocketId).emit('opponent-disconnected', {
                            message: 'Tu oponente se ha desconectado. ¡Ganas por default!'
                        });
                    }

                    // Limpiar batalla después de un rato
                    setTimeout(() => battles.delete(battleId), 60000);
                }
            }

            // Limpiar retos pendientes
            for (const [challengeId, challenge] of pendingChallenges) {
                if (challenge.challengerId === userId || challenge.friendId === userId) {
                    pendingChallenges.delete(challengeId);
                }
            }
        });
    });
}

// =============================================
// RESOLVER TURNO
// =============================================
function resolveTurn(io, battle) {
    battle.turnNumber++;

    const p1 = battle.players.p1;
    const p2 = battle.players.p2;

    const p1Pokemon = p1.team[p1.activeIndex];
    const p2Pokemon = p2.team[p2.activeIndex];

    const p1Move = p1Pokemon.moves[battle.currentTurnMoves.p1];
    const p2Move = p2Pokemon.moves[battle.currentTurnMoves.p2];

    // Determinar orden por velocidad
    const p1Speed = p1Pokemon.stats.speed;
    const p2Speed = p2Pokemon.stats.speed;
    const p1First = p1Speed >= p2Speed;

    const first = p1First ? 'p1' : 'p2';
    const second = p1First ? 'p2' : 'p1';
    const firstPokemon = p1First ? p1Pokemon : p2Pokemon;
    const secondPokemon = p1First ? p2Pokemon : p1Pokemon;
    const firstMove = p1First ? p1Move : p2Move;
    const secondMove = p1First ? p2Move : p1Move;
    const firstPlayer = battle.players[first];
    const secondPlayer = battle.players[second];

    const turnResult = {
        turnNumber: battle.turnNumber,
        actions: []
    };

    // Primer ataque
    const hit1 = calculateDamage(firstPokemon, secondPokemon, firstMove);
    secondPlayer.hp[secondPlayer.activeIndex] = Math.max(0,
        secondPlayer.hp[secondPlayer.activeIndex] - hit1.damage
    );

    turnResult.actions.push({
        attacker: first,
        attackerName: firstPokemon.name,
        defender: second,
        defenderName: secondPokemon.name,
        moveName: firstMove.name,
        moveType: firstMove.type,
        damage: hit1.damage,
        effectiveness: hit1.effectiveness,
        missed: hit1.missed,
        defenderRemainingHP: secondPlayer.hp[secondPlayer.activeIndex],
        defenderMaxHP: secondPokemon.stats.hp
    });

    let firstFainted = false;
    let secondFainted = false;

    // Verificar si el segundo fue derrotado
    if (secondPlayer.hp[secondPlayer.activeIndex] <= 0) {
        secondFainted = true;
    }

    // Si el segundo sigue vivo, contraataca
    if (!secondFainted) {
        const hit2 = calculateDamage(secondPokemon, firstPokemon, secondMove);
        firstPlayer.hp[firstPlayer.activeIndex] = Math.max(0,
            firstPlayer.hp[firstPlayer.activeIndex] - hit2.damage
        );

        turnResult.actions.push({
            attacker: second,
            attackerName: secondPokemon.name,
            defender: first,
            defenderName: firstPokemon.name,
            moveName: secondMove.name,
            moveType: secondMove.type,
            damage: hit2.damage,
            effectiveness: hit2.effectiveness,
            missed: hit2.missed,
            defenderRemainingHP: firstPlayer.hp[firstPlayer.activeIndex],
            defenderMaxHP: firstPokemon.stats.hp
        });

        if (firstPlayer.hp[firstPlayer.activeIndex] <= 0) {
            firstFainted = true;
        }
    }

    // Manejar pokémon derrotados
    turnResult.fainted = [];

    if (secondFainted) {
        turnResult.fainted.push({
            player: second,
            pokemonName: secondPokemon.name
        });

        // Pasar al siguiente pokémon
        if (secondPlayer.activeIndex + 1 < secondPlayer.team.length) {
            secondPlayer.activeIndex++;
            turnResult.fainted[turnResult.fainted.length - 1].nextPokemon = {
                name: secondPlayer.team[secondPlayer.activeIndex].name,
                index: secondPlayer.activeIndex
            };
        }
    }

    if (firstFainted) {
        turnResult.fainted.push({
            player: first,
            pokemonName: firstPokemon.name
        });

        if (firstPlayer.activeIndex + 1 < firstPlayer.team.length) {
            firstPlayer.activeIndex++;
            turnResult.fainted[turnResult.fainted.length - 1].nextPokemon = {
                name: firstPlayer.team[firstPlayer.activeIndex].name,
                index: firstPlayer.activeIndex
            };
        }
    }

    // Actualizar HP en el resultado para ambos jugadores
    turnResult.hpState = {
        p1: { hp: [...p1.hp], activeIndex: p1.activeIndex },
        p2: { hp: [...p2.hp], activeIndex: p2.activeIndex }
    };

    // Verificar fin de batalla
    const p1AllFainted = p1.hp.every(hp => hp <= 0);
    const p2AllFainted = p2.hp.every(hp => hp <= 0);

    if (p1AllFainted || p2AllFainted) {
        battle.status = 'finished';
        const winnerRole = p1AllFainted ? 'p2' : 'p1';

        turnResult.battleEnd = {
            winner: winnerRole,
            winnerTeamName: battle.players[winnerRole].teamName
        };

        // Limpiar batalla después de un rato
        setTimeout(() => battles.delete(battle.id), 60000);
    }

    // Resetear movimientos del turno
    battle.currentTurnMoves = { p1: null, p2: null };

    // Enviar resultado a ambos jugadores
    io.to(battle.id).emit('turn-result', turnResult);
}

// =============================================
// HELPER: Wrapper para pg (devuelve la primera fila)
// =============================================
async function dbGet(query, params) {
    const { rows } = await db.query(query, params);
    return rows[0] || null;
}

module.exports = { initBattleSocket };
