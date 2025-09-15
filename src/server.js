require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

const webhook = require('./bot/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use('/webhook', webhook);

app.get('/', (req, res) => {
  res.send('🚀 Donna bot rodando!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
