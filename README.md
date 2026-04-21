# Pokédex Backend API

API REST construida con **Node.js + Express** y **PostgreSQL** que funciona como BFF (Backend For Frontend) para la Pokédex PWA. Incluye autenticación JWT, gestión social (favoritos, equipos, amigos) y batallas en tiempo real por WebSocket.

## Tecnologías

| Tecnología | Uso |
|---|---|
| **Express 5** | Framework web HTTP |
| **Socket.IO 4** | WebSocket para batallas en tiempo real |
| **PostgreSQL** (`pg`) | Base de datos relacional persistente (Railway Postgres) |
| **JWT** | Autenticación con JSON Web Tokens (expiración 7 días) |
| **bcrypt** | Hash seguro de contraseñas |
| **Axios** | Cliente HTTP para consumir PokeAPI |
| **web-push** | Notificaciones push (VAPID) |
| **dotenv** | Variables de entorno |

## Instalación

```bash
npm install
```

## Variables de Entorno

Crear archivo `.env` en la raíz del proyecto:

```env
PORT=3000
FRONTEND_URL=*
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=tu_clave_secreta_jwt
PUBLIC_VAPID_KEY=tu_clave_publica_vapid
PRIVATE_VAPID_KEY=tu_clave_privada_vapid
EMAIL_CONTACTO=mailto:tu@email.com
```

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (Railway lo inyecta automáticamente) |
| `FRONTEND_URL` | Orígenes CORS permitidos. `*` para desarrollo, URL del frontend para producción |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL (Railway la inyecta como variable de referencia). Se acepta también `DATABASE_PUBLIC_URL` como fallback. |
| `JWT_SECRET` | Secreto para firmar tokens JWT |
| `PUBLIC_VAPID_KEY` | Clave pública VAPID para push notifications |
| `PRIVATE_VAPID_KEY` | Clave privada VAPID |
| `EMAIL_CONTACTO` | Email de contacto VAPID (formato `mailto:...`) |

## Ejecución

```bash
# Producción
npm start

# Desarrollo (con hot-reload)
npm run dev
```

El servidor escucha en `0.0.0.0:{PORT}` para aceptar conexiones externas (requerido para Railway y acceso desde celulares).

## Base de Datos

PostgreSQL (pool de conexiones vía `pg`). Las tablas se crean automáticamente en el arranque (`initDb()` en `db.js`) con `CREATE TABLE IF NOT EXISTS`:

| Tabla | Descripción |
|---|---|
| `users` | Usuarios (email, password hash bcrypt, friend_code único) |
| `favorites` | Pokémon favoritos por usuario con características personalizadas |
| `teams` | Equipos de hasta 6 Pokémon por usuario (pokemon_ids como JSON) |
| `friends` | Relaciones bidireccionales de amistad (composite PK) |
| `push_subscriptions` | Suscripciones push por usuario |

Las queries usan placeholders numerados (`$1, $2, ...`) y `async/await` con `pool.query()`. SSL habilitado (`rejectUnauthorized: false`) para Railway.

## Endpoints REST

### Autenticación (`/api/auth`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/register` | Registro con email y password. Genera código de amigo único (PK-XXXXXX) |
| POST | `/login` | Login. Devuelve JWT válido por 7 días |

### Pokémon — BFF PokeAPI (`/api/pokemon`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Lista paginada (`?limit=20&offset=0`) |
| GET | `/:id` | Detalle completo: stats, tipos, descripción, especie, cadena evolutiva |
| GET | `/search?q=pikachu` | Búsqueda por nombre (para selector de equipos) |
| GET | `/filter/types?type1=fire&type2=flying` | **Filtrar por combinación de tipo 1 y tipo 2** |
| GET | `/filter/type/:type` | Filtrar por un solo tipo |
| GET | `/filter/region/:region` | Filtrar por región (kanto, johto, hoenn, sinnoh, unova, kalos, alola, galar, paldea) |

### Social (`/api/social`) — Requiere JWT

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/favorites` | Listar favoritos del usuario |
| POST | `/favorites` | Agregar/actualizar favorito con características |
| PUT | `/favorites/:id` | Editar características de un favorito |
| DELETE | `/favorites/:id` | Eliminar favorito |
| GET | `/teams` | Listar equipos del usuario |
| GET | `/teams/user/:userId` | Listar equipos de un amigo (requiere amistad) |
| POST | `/teams` | Crear equipo (nombre + hasta 6 Pokémon IDs) |
| PUT | `/teams/:id` | Editar equipo existente |
| DELETE | `/teams/:id` | Eliminar equipo |
| GET | `/friends` | Listar amigos |
| POST | `/friends/add` | Agregar amigo por `friend_code` |
| POST | `/battles/prepare` | Preparar datos de batalla interactiva |
| POST | `/battles/challenge` | Simular batalla (modo legacy) |

### Push (`/api/subscribe`) — Requiere JWT

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/subscribe` | Registrar/actualizar suscripción push del usuario |

### Health Check

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor (útil para monitoreo de Railway) |

## Sistema de Batallas en Tiempo Real (WebSocket)

El sistema usa **Socket.IO** para comunicación bidireccional en tiempo real, permitiendo que dos personas desde dispositivos y conexiones diferentes puedan batallar.

### Flujo de Batalla

```
Jugador A                    Servidor                    Jugador B
    |                            |                            |
    |-- challenge-friend ------->|                            |
    |                            |-- battle-invitation ------>|
    |<--- challenge-sent --------|                            |
    |                            |<--- accept-challenge ------|
    |<--- battle-loading --------|--- battle-loading -------->|
    |                            |   (carga datos PokeAPI)    |
    |<--- battle-start ----------|--- battle-start ---------->|
    |                            |                            |
    |-- select-move ------------>|                            |
    |                            |<--- select-move -----------|
    |<--- turn-result -----------|--- turn-result ----------->|
    |                            |                            |
    |         (repite turnos hasta que un equipo pierda)      |
```

### Eventos WebSocket

| Evento (Cliente → Servidor) | Datos | Descripción |
|---|---|---|
| `challenge-friend` | `{ friendId, myTeamId }` | Enviar reto a un amigo conectado |
| `accept-challenge` | `{ challengeId, myTeamId }` | Aceptar un reto recibido |
| `reject-challenge` | `{ challengeId }` | Rechazar un reto |
| `select-move` | `{ battleId, moveIndex }` | Elegir movimiento en turno actual |

| Evento (Servidor → Cliente) | Datos | Descripción |
|---|---|---|
| `battle-invitation` | `{ challengeId, challengerEmail, challengerId }` | Notificación de reto recibido |
| `challenge-sent` | `{ challengeId, message }` | Confirmación de reto enviado |
| `challenge-rejected` | `{ message }` | Reto rechazado por el oponente |
| `battle-loading` | `{ battleId }` | Cargando datos de Pokémon |
| `battle-start` | `{ battleId, myPokemon[], opponentPokemon[], playerRole }` | Batallacomenzó con datos completos |
| `turn-result` | `{ turnNumber, actions[], fainted[], hpState, battleEnd? }` | Resultado del turno |
| `opponent-chose-move` | — | El oponente ya eligió su movimiento |
| `opponent-disconnected` | `{ message }` | El oponente se desconectó (ganas por default) |

### Mecánicas de Batalla

- **Fórmula de daño oficial** de Pokémon simplificada (nivel 50)
- **18 tipos** con tabla de efectividad completa (super efectivo ×2, no efectivo ×0.5, inmune ×0)
- **STAB** (Same Type Attack Bonus) ×1.5
- **Velocidad** determina quién ataca primero en cada turno
- **Ataques físicos vs especiales** según `damageClass` del movimiento
- **Precisión** del movimiento considerada (puede fallar)
- **Variación aleatoria** (0.85–1.0) en cada golpe
- Hasta **4 movimientos** por Pokémon con datos reales de PokeAPI
- Cambio automático al siguiente Pokémon cuando uno cae
- Victoria cuando el equipo completo del oponente es derrotado

## Despliegue en Railway

1. Crear proyecto nuevo en [Railway](https://railway.app)
2. Agregar servicio de **PostgreSQL** al proyecto (plantilla oficial)
3. Conectar el repositorio del backend en GitHub
4. Configurar variables de entorno en el servicio backend:
   - `DATABASE_URL` → referencia a `${{Postgres.DATABASE_URL}}` (variable de referencia de Railway)
   - `JWT_SECRET` → clave secreta fuerte
   - `FRONTEND_URL` → URL del frontend desplegado
   - `PUBLIC_VAPID_KEY`, `PRIVATE_VAPID_KEY`, `EMAIL_CONTACTO`
   - `PORT` → Railway lo inyecta automáticamente
5. Railway detecta `npm start` automáticamente
6. `initDb()` crea las tablas al arrancar; los datos persisten en el servicio PostgreSQL entre despliegues
