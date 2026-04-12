const axios = require('axios');

const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

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

        const moveUrls = data.moves.slice(0, 20);
        const moveDetails = [];

        for (const moveEntry of moveUrls) {
            if (moveDetails.length >= 4) break;
            try {
                const moveRes = await axios.get(moveEntry.move.url);
                const m = moveRes.data;
                if (m.power && m.power > 0) {
                    const nameEs = m.names?.find(n => n.language.name === 'es')?.name
                        || m.names?.find(n => n.language.name === 'en')?.name
                        || m.name;
                    moveDetails.push({
                        name: nameEs,
                        internalName: m.name,
                        power: m.power,
                        type: m.type.name,
                        damageClass: m.damage_class.name,
                        accuracy: m.accuracy || 100,
                        pp: m.pp
                    });
                }
            } catch (e) { /* Si falla un move lo ignoramos */ }
        }

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

    // STAB
    const stab = attacker.types.includes(attackType) ? 1.5 : 1;

    // Variación aleatoria
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

module.exports = {
    TYPE_CHART,
    getTypeEffectiveness,
    fetchPokemonBattleData,
    calculateDamage
};
