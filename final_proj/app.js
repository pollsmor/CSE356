const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const ShareDB = require('sharedb');

// Because Quill doesn't use the default type of ShareDB
ShareDB.types.register(require('rich-text').type);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server: server });

const backend = new ShareDB();
const connection = backend.connect();
wss.on('connection', (ws) => {
    const stream = new WebSocketJSONStream(ws);
    backend.listen(stream);
});

const doc = connection.get('documents', 'firstDocument');
app.use(express.static('public'));
server.listen(3000);

// Routes ====================================================================

// Frontend
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.get('/connect/:id', function (req, res) {
    let id = req.params.id;
    doc.fetch(function (err) {
        if (err) throw err;
        if (doc.type === null)
            doc.create([], 'rich-text', null);
    });

    res.json({test: 'wtf'});
});