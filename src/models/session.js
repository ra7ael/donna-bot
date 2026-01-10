// src/models/session.js
import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true // Garante uma sessão única por número de telefone
  },
  messages: [{ 
    type: String // Ex: "Usuário: oi", "Amber: olá"
  }],
  lastUpdate: { 
    type: Date, 
    default: Date.now
  }
});

export const Session = mongoose.model("Session", SessionSchema);
