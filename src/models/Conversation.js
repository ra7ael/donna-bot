const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  from: String,          // número do usuário
  role: String,          // 'user' ou 'assistant'
  content: String,       // texto da mensagem
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
