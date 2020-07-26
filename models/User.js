const { Schema, model } = require('mongoose');

const UserSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    min: 3,
    max: 16
  },
  password: {
    type: String,
    required: true,
    max: 128
  }
});

module.exports = model('User', UserSchema);
