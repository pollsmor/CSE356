const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')('mongodb://localhost:27017/final');
const QuillDeltaToHtmlConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;

const app = express();
const server = require('http').createServer(app);
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

// WebSocket to connect server to ShareDB backend
const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
    backend.listen(new WebSocketJSONStream(ws));
});
const doc = connection.get('docs', 'doc1'); // ShareDB document
const users = new Map(); // Keep track of connected users
const streamHeaders = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
};

// Middleware that sets required header for every route
app.use(function(req, res, next) {
    res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
    next();
});
app.use(express.static('public'));
app.use(express.json());

server.listen(3000);

// Routes ====================================================================
// Frontend
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

// Establish connection
app.get('/connect/:id', function (req, res) {
    res.writeHead(200, streamHeaders); // Setup stream

    let id = req.params.id;
    users.set(id, res);
    req.on('close', function() {
        users.delete(id);
    });


    // Get whole document on initial load
    doc.fetch(function (err) {
        if (err) throw err;
        // Create document if one does not exist
        else if (doc.type === null)
            doc.create([], 'rich-text', null);

        res.write(`data: { "content": ${JSON.stringify(doc.data.ops)} }\n\n`);
    });
});

// Send ops to doc and to other users
app.post('/op/:id', function (req, res) {
    let id = req.params.id;
    for (let op of req.body)
        doc.submitOp(op);

    for (let [otherId, otherRes] of users) {
        if (id !== otherId)
            otherRes.write('data: ' + JSON.stringify(req.body) + '\n\n');
    }
    
    res.json({}); // End request
})

// Return whole document as HTML
app.get('/doc/:id', function (req, res) {
    doc.fetch(function (err) {
        if (err) throw err;
        res.set('Content-Type', 'text/html');
        const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
        const html = converter.convert();

        res.send(Buffer.from(html));
    });
})