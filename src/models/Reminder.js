const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  from: String,
  text: String,
  date: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reminder', reminderSchema);
