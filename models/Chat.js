const { Schema, model } = require('mongoose');

const ChatSchema = new Schema({
  user: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  }
});

module.exports = model('Chat', ChatSchema);
