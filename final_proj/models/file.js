const mongoose = require('mongoose');

// Because I can't figure out how to store (permanent) fields in ShareDB docs.
let File = new mongoose.Schema({
  name:   { type: String, required: true },
  mime: { type: String, required: true }
});

module.exports = mongoose.model('File', File);