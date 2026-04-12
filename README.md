# Pokédex Backend API

API REST construida con **Node.js + Express** y **SQLite** que funciona como BFF (Backend For Frontend) para la Pokédex PWA. Incluye autenticación JWT, gestión social (favoritos, equipos, amigos) y batallas en tiempo real por WebSocket.

## Tecnologías

| Tecnología | Uso |
|---|---|
| **Express 5** | Framework web HTTP |
| **Socket.IO 4** | WebSocket para batallas en tiempo real |
| **SQLite3** | Base de datos relacional embebida |
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
PUBLIC_VAPID_KEY=tu_clave_publica_vapid
PRIVATE_VAPID_KEY=tu_clave_privada_vapid
EMAIL_CONTACTO=mailto:tu@email.com
JWT_SECRET=tu_clave_secreta_jwt
```

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (Railway lo inyecta automáticamente) |
| `FRONTEND_URL` | Orígenes CORS permitidos. `*` para desarrollo, URL del frontend para producción |
| `PUBLIC_VAPID_KEY` | Clave pública VAPID para push notifications |
| `PRIVATE_VAPID_KEY` | Clave privada VAPID |
| `EMAIL_CONTACTO` | Email de contacto VAPID (formato `mailto:...`) |
| `JWT_SECRET` | Secreto para firmar tokens JWT |

## Ejecución

```bash
# Producción
npm start

# Desarrollo (con hot-reload)
npm run dev
```

El servidor escucha en `0.0.0.0:{PORT}` para aceptar conexiones externas (requerido para Railway y acceso desde celulares).

## Base de Datos

SQLite con las siguientes tablas:

| Tabla | Descripción |
|---|---|
| `users` | Usuarios (email, password hash, friend_code único) |
| `favorites` | Pokémon favoritos por usuario con características personalizadas |
| `teams` | Equipos de hasta 6 Pokémon por usuario |
| `friends` | Relaciones bidireccionales de amistad |
| `push_subscriptions` | Suscripciones push por usuario |

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
2. Conectar el repositorio de GitHub
3. Configurar variables de entorno en Railway:
   - `PORT` → Railway lo inyecta automáticamente
   - `JWT_SECRET` → Clave secreta fuerte
   - `FRONTEND_URL` → URL del frontend desplegado
   - `PUBLIC_VAPID_KEY`, `PRIVATE_VAPID_KEY`, `EMAIL_CONTACTO`
4. Railway detecta `npm start` automáticamente
5. La base de datos SQLite se crea automáticamente en el filesystem

> **Nota:** SQLite en Railway es efímero. Si necesitas persistencia entre deploys, considera usar un volumen de Railway o migrar a PostgreSQL.
