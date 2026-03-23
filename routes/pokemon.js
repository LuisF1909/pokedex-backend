const express = require('express');
const axios = require('axios');
const router = express.Router();

const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

// Cache para lista completa de Pokémon (mejora performance del buscador)
let allPokemonCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

async function getAllPokemon() {
    const now = Date.now();
    if (allPokemonCache && (now - cacheTimestamp) < CACHE_TTL) {
        return allPokemonCache;
    }
    const response = await axios.get(`${POKEAPI_BASE}/pokemon?limit=1025&offset=0`);
    allPokemonCache = response.data.results.map(p => {
        const parts = p.url.split('/');
        const id = parts[parts.length - 2];
        return {
            name: p.name,
            id: parseInt(id),
            image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
        };
    });
    cacheTimestamp = now;
    return allPokemonCache;
}

// GET /api/pokemon/search?q=pikachu
// Buscar pokémon por nombre (para el selector de equipos)
router.get('/search', async (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query || query.length < 2) {
        return res.json({ results: [] });
    }

    try {
        const allPokemon = await getAllPokemon();
        const results = allPokemon
            .filter(p => p.name.includes(query))
            .slice(0, 20); // Limitar a 20 resultados
        res.json({ results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error buscando Pokémon' });
    }
});

// GET /api/pokemon
// Obtener una lista de pokemon (con paginación)
router.get('/', async (req, res) => {
    const limit = req.query.limit || 20;
    const offset = req.query.offset || 0;

    try {
        const response = await axios.get(`${POKEAPI_BASE}/pokemon?limit=${limit}&offset=${offset}`);
        // Podríamos enriquecer los datos aquí pidiendo el ID o la imagen directamente para no hacer sobrecargar el front
        const resultsConImagenId = response.data.results.map(p => {
            // Extraer ID de la URL: https://pokeapi.co/api/v2/pokemon/1/
            const parts = p.url.split('/');
            const id = parts[parts.length - 2];
            return {
                ...p,
                id,
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
            };
        });

        res.json({
            count: response.data.count,
            next: response.data.next,
            previous: response.data.previous,
            results: resultsConImagenId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener la lista de Pokémon desde PokeAPI' });
    }
});

// GET /api/pokemon/:id
// Obtener todos los detalles de un pokemon + cadena evolutiva
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Obtener datos basicos y stats
        const pokeRes = await axios.get(`${POKEAPI_BASE}/pokemon/${id}`);
        const pokemonData = pokeRes.data;

        // 2. Obtener especie (para descripcion y cadena evolutiva)
        const speciesRes = await axios.get(pokemonData.species.url);
        const speciesData = speciesRes.data;

        // 3. Obtener cadena evolutiva
        const evoRes = await axios.get(speciesData.evolution_chain.url);
        const evolutionData = evoRes.data;

        // Extraer descripción en español
        const flavorTextEntry = speciesData.flavor_text_entries.find(entry => entry.language.name === 'es')
            || speciesData.flavor_text_entries.find(entry => entry.language.name === 'en');

        res.json({
            id: pokemonData.id,
            name: pokemonData.name,
            types: pokemonData.types.map(t => t.type.name),
            stats: pokemonData.stats.map(s => ({ name: s.stat.name, value: s.base_stat })),
            weight: pokemonData.weight,
            height: pokemonData.height,
            image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonData.id}.png`,
            description: flavorTextEntry ? flavorTextEntry.flavor_text.replace(/\n|\f/g, ' ') : 'Sin descripción.',
            // Podríamos parsear el evolution_chain aquí para dárselo en bandeja de plata al frontend
            evolution_chain_url: speciesData.evolution_chain.url, // O mandar el raw y parsear en el front
            evolution_chain: parseEvolutionChain(evolutionData.chain)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener detalles del Pokémon' });
    }
});

// GET /api/pokemon/filter/type/:type
// Filtrar por tipo (el frontend podría usar esto o cargar todos en caché)
router.get('/filter/type/:type', async (req, res) => {
    const { type } = req.params;
    try {
        const response = await axios.get(`${POKEAPI_BASE}/type/${type}`);
        const results = response.data.pokemon.map(p => {
            const parts = p.pokemon.url.split('/');
            const id = parts[parts.length - 2];
            return {
                name: p.pokemon.name,
                url: p.pokemon.url,
                id,
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
            };
        });
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: 'Error al filtrar por tipo' });
    }
});

// GET /api/pokemon/filter/region/:region
// Filtrar por región (generación)
router.get('/filter/region/:region', async (req, res) => {
    const regionMap = {
        kanto: 1, johto: 2, hoenn: 3, sinnoh: 4,
        unova: 5, kalos: 6, alola: 7, galar: 8, paldea: 9
    };

    const region = req.params.region.toLowerCase();
    const genId = regionMap[region];

    if (!genId) {
        return res.status(400).json({ error: `Región inválida. Opciones: ${Object.keys(regionMap).join(', ')}` });
    }

    try {
        const response = await axios.get(`${POKEAPI_BASE}/generation/${genId}`);
        const results = await Promise.all(
            response.data.pokemon_species.map(async (species) => {
                const parts = species.url.split('/');
                const speciesId = parts[parts.length - 2];
                return {
                    name: species.name,
                    id: speciesId,
                    image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${speciesId}.png`
                };
            })
        );
        // Ordenar por ID
        results.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        res.json({ region, results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al filtrar por región' });
    }
});

// Función auxiliar para parsear cadena evolutiva
function parseEvolutionChain(chain) {
    const evolutions = [];
    let currentEvo = chain;

    while (currentEvo != null) {
        if (currentEvo.species) {
            const parts = currentEvo.species.url.split('/');
            const id = parts[parts.length - 2];
            evolutions.push({
                name: currentEvo.species.name,
                id: id,
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
            });
        }
        currentEvo = currentEvo.evolves_to[0];
    }
    return evolutions;
}

module.exports = router;
