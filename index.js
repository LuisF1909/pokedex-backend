const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('¡Hola desde el Backend de la Pokedex!');
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});