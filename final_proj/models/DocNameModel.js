const mongoose = require('mongoose');

let DocName = new mongoose.Schema({
  id:   { type: String, required: true },
  name: { type: String, required: true }
});

module.exports = mongoose.model('DocName', DocName);