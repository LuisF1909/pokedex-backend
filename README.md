# Pokédex Backend API

API REST construida con **Node.js + Express** y **SQLite** que funciona como BFF (Backend For Frontend) para la Pokédex PWA.

## Tecnologías

- **Express 5** — Framework web
- **SQLite3** — Base de datos relacional embebida
- **JWT** — Autenticación con JSON Web Tokens
- **bcrypt** — Hash de contraseñas
- **Axios** — Cliente HTTP para consumir PokeAPI
- **web-push** — Notificaciones push
- **dotenv** — Variables de entorno

## Instalación

```bash
npm install
```

## Variables de Entorno

Crear archivo `.env` en la raíz:

```env
PUBLIC_VAPID_KEY=tu_clave_publica_vapid
PRIVATE_VAPID_KEY=tu_clave_privada_vapid
EMAIL_CONTACTO=mailto:tu@email.com
JWT_SECRET=tu_clave_secreta_jwt
```

## Ejecución

```bash
node index.js
# Servidor en http://localhost:3000
```

## Base de Datos

SQLite con las siguientes tablas:

| Tabla | Descripción |
|---|---|
| `users` | Usuarios (email, password hash, friend_code) |
| `favorites` | Pokémon favoritos por usuario con características personalizadas |
| `teams` | Equipos de hasta 6 Pokémon por usuario |
| `friends` | Relaciones bidireccionales de amistad |
| `push_subscriptions` | Suscripciones push por usuario |

## Endpoints

### Autenticación (`/api/auth`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/register` | Registro con email y password. Genera código de amigo único |
| POST | `/login` | Login. Devuelve JWT válido por 7 días |

### Pokémon (`/api/pokemon`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Lista paginada (`?limit=20&offset=0`) |
| GET | `/:id` | Detalle completo: stats, tipos, descripción, cadena evolutiva |
| GET | `/filter/type/:type` | Filtrar por tipo (fire, water, etc.) |
| GET | `/filter/region/:region` | Filtrar por región (kanto, johto, hoenn, etc.) |

### Social (`/api/social`) — Requiere JWT

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/favorites` | Listar favoritos del usuario |
| POST | `/favorites` | Agregar/actualizar favorito |
| PUT | `/favorites/:id` | Editar características de un favorito |
| DELETE | `/favorites/:id` | Eliminar favorito |
| GET | `/teams` | Listar equipos del usuario |
| GET | `/teams/user/:userId` | Listar equipos de un amigo (requiere amistad) |
| POST | `/teams` | Crear equipo (nombre + hasta 6 Pokémon IDs) |
| PUT | `/teams/:id` | Editar equipo |
| DELETE | `/teams/:id` | Eliminar equipo |
| GET | `/friends` | Listar amigos |
| POST | `/friends/add` | Agregar amigo por `friend_code` |
| POST | `/battles/challenge` | Retar a un amigo: batalla por turnos con stats reales |

### Push (`/api/subscribe`) — Requiere JWT

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/subscribe` | Registrar/actualizar suscripción push |

## Sistema de Batallas

Las batallas usan la **fórmula oficial de daño de Pokémon** simplificada:

- **Stats reales** obtenidos de PokeAPI (ATK, DEF, SpA, SpD, SPD, HP)
- **Efectividad de tipos** completa (18 tipos, super efectivo ×2, no muy efectivo ×0.5, inmune ×0)
- **STAB** (Same Type Attack Bonus) ×1.5
- **Velocidad** determina quién ataca primero
- **Ataques físicos vs especiales** según el tipo del movimiento
- Resultado: log turno a turno con daño, efectividad y ganador final
