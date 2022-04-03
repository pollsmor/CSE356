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

const doc = connection.get('docs', 'doc1');
const ops = []; // Array of oplists to send back
doc.on('op', function (op, source) {
    ops.push(op);
});

const streamHeaders = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
};

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
server.listen(3000);

// Routes ====================================================================

// Frontend
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.get('/connect/:id', function (req, res) {
    res.writeHead(200, streamHeaders); // Setup stream
    // Create document if one does not exist
    if (doc.type === null) {
        doc.create([], 'rich-text', null);
    }

    setInterval(function() {
        if (ops.length > 0) {
            res.write('data: ' + JSON.stringify(ops) + '\n\n');
            ops.length = 0;
        }
    }, 1000);
});

app.post('/op/:id', function (req, res) {
    for (let op of req.body.content) {
        doc.submitOp(op);
    }
    
    res.json();
})

app.get('/doc/:id', function (req, res) {
    let id = req.params.id;
    let snapshot = doc.toSnapshot();
    console.log(snapshot);
})