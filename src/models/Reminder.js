const mongoose = require('mongoose');

const ReminderSchema = new mongoose.Schema({
  from: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reminder', ReminderSchema);
