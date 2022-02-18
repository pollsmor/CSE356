const mongoose = require('mongoose');

const Schema = mongoose.Schema;

let user = new Schema({
    'username':     String,
    'password':     String,
    'email':        String,
    'verified':     Boolean,
    'key':          String,
    'games':        { 'id': String, 'start_date': String },
});

module.exports = mongoose.model('users', user);