const mongoose = require('mongoose');

const Schema = mongoose.Schema;

let User = new Schema({
    username:   String,
    password:   String,
    email:      String,
    verified:   Boolean,
    key:        String,
    games:      [[Object]],
    wins:       Number,
    losses:     Number,
    ties:       Number
});

module.exports = mongoose.model('User', User);