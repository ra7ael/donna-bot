require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");

const webhook = require("./bot/webhook");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Rotas
app.use("/webhook", webhook);

// Rota de teste
app.get("/", (req, res) => {
  res.send("🚀 Donna bot rodando!");
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
