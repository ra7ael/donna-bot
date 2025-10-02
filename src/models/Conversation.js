import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema({
  from: { type: String, required: true },
  role: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model("Conversation", ConversationSchema);
export default Conversation;
