require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Conectar ao MongoDB
connectDB();

app.use(bodyParser.json());

// Rotas
const webhookRoutes = require('./routes/webhook');
app.use('/webhook', webhookRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Donna bot rodando!");
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

