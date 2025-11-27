import mongoose from "mongoose";

const memorySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  memoria: { type: Object, default: {} },
});

export default mongoose.model("Memory", memorySchema);
