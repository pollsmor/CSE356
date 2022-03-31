const express = require('express');
const ShareDB = require('sharedb');
const mongodb = require('mongodb').MongoClient;
const db = require('sharedb-mongo')({mongo: function(callback) {
    mongodb.connect('mongodb://localhost:27017/final', callback);
}});

const app = express();
const port = 3000;
const backend = new ShareDB({db});

app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.listen(port, () => {
    console.log('Final project listening on port ' + port);
});

// Routes ====================================================================
app.get('/', function (req, res) {
    res.end('Hello world!');
});