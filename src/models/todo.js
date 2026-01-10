import mongoose from "mongoose";

const todoSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  task: { type: String, required: true },
  status: { type: String, enum: ["pendente", "concluido"], default: "pendente" },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

export const Todo = mongoose.model("Todo", todoSchema);
