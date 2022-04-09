const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')('mongodb://localhost:27017/docs');
const mongoose = require('mongoose');
const User = require('./UserModel');

const app = express();
const server = http.createServer(app);
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

// WebSocket to connect server to ShareDB backend
const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
  backend.listen(new WebSocketJSONStream(ws));
});
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

mongoose.connect('mongodb://localhost:27017/users', {
  useUnifiedTopology: true,
  useNewUrlParser: true
});
mongoose.connection.once('open', () => {});

// Middleware that sets required header for every route
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next();
});
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

server.listen(3000);

// Routes ====================================================================
// Frontend
app.get('/', function (req, res) {
  res.render('login');
});

app.post('/addUser', async function (req, res) {
  let user = new User({
    username: req.body.username,
    password: req.body.password,
    email: req.body.email
  });

    const usernameExists = await User.exists({ username: user.username });
    const emailExists = await User.exists({ email: user.email });
    if (usernameExists || emailExists)
      res.json({ status: 'ERROR' });
    else {
      user.save((err, user) => {
        if (err) throw err;
        res.json({ status: 'OK' });
      });
    }
});

app.post('/verify', function (req, res) {
  if (req.body.key === 'abracadabra') {
    User.updateOne(
      { email: req.body.email }, // Filter
      { verified: true }, // Update
      (err, user) => {
        if (user.matchedCount === 0)
          res.json({status: 'ERROR' });
        else res.json({ status: 'OK' });
      }
    );
  } else res.json({ status: 'ERROR' });
});

app.post('/login', function (req, res) {
  User.findOne(
    { username: req.body.username },
    (err, user) => {
      if (!user || !user.verified || req.body.password !== user.password)
        res.json({ status: 'ERROR' });
      else {
        res.json({ status: 'OK' });
      }
    }
  );
});