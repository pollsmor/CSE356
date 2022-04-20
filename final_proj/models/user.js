const mongoose = require('mongoose');

let User = new mongoose.Schema({
  name: { type: String, required: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  verified: { type: Boolean, default: false },
  key: { type: String, default: 'abracadabra' }
});

module.exports = mongoose.model('User', User);