const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const ShareDB = require('sharedb');
const QuillDeltaToHtmlConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;

const app = express();
const server = http.createServer(app);
const port = 3000;

// Because Quill doesn't use the default type of ShareDB
ShareDB.types.register(require('rich-text').type);
const backend = new ShareDB();
const connection = backend.connect();

// WebSocket to connect server to ShareDB backend
const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
    backend.listen(new WebSocketJSONStream(ws));
});

const doc = connection.get('docs', 'doc1'); // ShareDB document
const users = new Map(); // Keep track of connected users
const myId = '61f9f57773ba724f297db6bf';
const streamHeaders = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
};

app.use(express.static('public'));
app.use(express.json());

server.listen(port, () => {
    console.log('Milestone 1 running on port ' + port);
});

// Routes ====================================================================

// Frontend
app.get('/', function (req, res) {
    res.setHeader('X-CSE356', myId);
    res.sendFile(__dirname + '/index.html');
});

app.get('/connect/:id', function (req, res) {
    // Establish connection
    res.setHeader('X-CSE356', myId);
    res.writeHead(200, streamHeaders); // Setup stream
    let id = req.params.id;
    users.set(id, res);
    req.on('close', function() {
        users.delete(id);
    });

    if (doc.type === null) // Create document if one does not exist
        doc.create([], 'rich-text', null);

    // Get whole document on initial load
    doc.fetch(function (err) {
        if (err) throw err;
        res.write(`data: { "content": ${JSON.stringify(doc.data.ops)} }\n\n`);
    });
});

app.post('/op/:id', function (req, res) {
    res.setHeader('X-CSE356', myId);
    let id = req.params.id;
    for (let op of req.body)
        doc.submitOp(op);

    for (let [otherId, otherRes] of users) {
        if (id !== otherId)
            otherRes.write('data: ' + JSON.stringify(req.body) + '\n\n');
    }
    
    res.json();
})

app.get('/doc/:id', function (req, res) {
    res.setHeader('X-CSE356', myId);

    // Return whole document as HTML
    doc.fetch(function (err) {
        if (err) throw err;
        res.set('Content-Type', 'text/html');
        const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
        const html = converter.convert();

        res.send(Buffer.from(html));
    });
})