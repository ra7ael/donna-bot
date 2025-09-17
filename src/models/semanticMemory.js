const mongoose = require('mongoose');

const semanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },      // ID do usuário (WhatsApp)
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },    // Texto da mensagem
  embedding: { type: [Number], default: [] },   // Vetor de embedding para busca semântica
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('SemanticMemory', semanticMemorySchema);
