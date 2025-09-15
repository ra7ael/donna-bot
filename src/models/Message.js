const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  from: String,       // número do usuário
  body: String,       // mensagem enviada
  response: String,   // resposta da Donna
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema);
