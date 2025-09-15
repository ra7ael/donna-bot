Conversation.jsconst mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  from: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
