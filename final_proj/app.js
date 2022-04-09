const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);

// =====================================================================
// Session handling
const mongoUri = 'mongodb://localhost:27017/final';
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const User = require('./UserModel');

const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });
store.on('error', (err) => { throw err; }); // Catch errors
app.use(session({
  secret: 'secret',
  cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  store: store,
  resave: true,
  saveUninitialized: true
}));

mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
mongoose.connection.once('open', () => {});
app.use(express.urlencoded({ extended: true })); // Parse HTML form JSON

// =====================================================================
// Setup ShareDB and connect to it via WebSockets
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');

ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
  backend.listen(new WebSocketJSONStream(ws));
});

// =====================================================================
// Middleware that sets required header for every route
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next();
});

app.use(express.static('public'));
app.use(express.json());
app.set('view engine', 'ejs');

server.listen(3000, () => {
  console.log('Google Docs Clone is now running.');
});

// Routes ====================================================================
// Frontend
app.get('/', function (req, res) {
  if (req.session.username) {
    res.render('docs');
  } else {
    res.render('login');
  }
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
  // Session found
  if (req.session.username) {
    res.json({ status: 'OK' });
  } else { // Try to log in with provided credentials
    User.findOne(
      { username: req.body.username },
      (err, user) => {
        if (!user || !user.verified || req.body.password !== user.password)
          res.json({ status: 'ERROR' });
        else { // Establish session
          req.session.username = req.body.username;
          res.json({ status: 'OK' });
        }
      }
    );
  }
});

app.post('/logout', function (req, res) {
  if (req.session.username) {
    req.session.destroy();
    res.json({ status: 'OK' });
  } else res.json({ status: 'ERROR' }); 
});