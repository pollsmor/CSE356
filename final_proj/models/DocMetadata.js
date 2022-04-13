const mongoose = require('mongoose');

// Because I can't figure out how to store (permanent) fields in ShareDB docs.
let DocMetadata = new mongoose.Schema({
  id:   { type: String, required: true },
  name: { type: String, required: true }
});

module.exports = mongoose.model('DocMetadata', DocMetadata);