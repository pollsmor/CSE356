const express = require('express');
const ShareDB = require('sharedb');

const app = express();
const backend = new ShareDB();

app.use(express.static('public'));

app.listen(3000, () => {
    console.log('Final project listening on port 3000');
});

// Routes ====================================================================

// Frontend
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.get('/connect/:id', function (req, res) {
    let id = req.params.id;
    res.json({lmao: 'wtf'});
});