const http = require('http');
const express = require('express');
const nodemailer = require('nodemailer');
const QuillDeltaToHtmlConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;

const app = express();
const server = http.createServer(app);
const transport = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  tls: { rejectUnauthorized: false }
});

// =====================================================================
// Session handling
const mongoUri = 'mongodb://localhost:27017/final';
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const User = require('./models/UserModel');

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
const { MongoClient } = require('mongodb');
const client = new MongoClient(mongoUri);
let docs, o_docs;
client.connect((err) => {
  if (err) throw err;
  const db = client.db('final');
  docs = db.collection('docs');
  o_docs = db.collection('o_docs');
});

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
  if (req.session.name) {
    res.render('home', {
      name: req.session.name,
      email: req.session.email
    });
  } else res.render('login');
});

app.get('/home', function (req, res) {
  if (req.session.name) {
    res.render('home', {
      name: req.session.name,
      email: req.session.email
    });
  } else res.json({ error: true, message: 'Session not found.' });
});

// User routes
app.post('/users/login', function (req, res) {
  // Try to log in with provided credentials
  let email = req.body.email;
  User.findOne(
    { email: email },
    (err, user) => {
      if (!user || !user.verified || req.body.password !== user.password)
        res.json({ error: true, message: 'Incorrect credentials.' });
      else { // Establish session
        req.session.name = user.name;
        req.session.email = user.email;
        res.json({ name: user.name });
      }
    }
  );
});

app.post('/users/logout', function (req, res) {
  if (req.session.name) {
    req.session.destroy();
    res.json({});
  } else res.json({ error: true, message: 'You are already logged out.' }); 
});

app.post('/users/signup', async function (req, res) {
  let emailExists = await User.exists({ email: req.body.email });
  if (emailExists)
    return res.json({ error: true, message: 'Email already exists.' });

  let key = Math.random().toString(36).slice(2) // Random string
  let user = new User({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    key: key
  });

  user.save();
  let serverIp = '209.94.56.234';
  await transport.sendMail({
      to: user.email,
      subject: 'Verification key',
      text: `http://${serverIp}/users/verify?email=${user.email}&key=${key}`
  });

  res.json({});
});

app.get('/users/verify', async function (req, res) {
  let user = await User.findOne({ email: req.query.email });
  if (user == null || user.key !== req.query.key)
    res.json({ error: true, message: 'Invalid email or key.'});
  else {
    user.verified = true;
    user.save();

    // Establish session
    req.session.name = user.name; 
    req.session.email = req.query.email;
    res.redirect('/home'); // Redirect to homepage
  }
});

// =====================================================================
// Collection routes
app.post('/collection/create', function (req, res) {
  if (req.session.name) {
    let docId = Math.random().toString(36).slice(2) // Random string
    let doc = connection.get('docs', docId); // ShareDB document
    doc.fetch((err) => {
      if (err) throw err;
      doc.create([], 'rich-text', null, async () => {
        // Add name fields to documents (not really needed?)
        await docs.updateOne({ _id: docId }, { $set: { name: req.body.name }});
        await o_docs.updateOne({ d: docId }, { $set: { name: req.body.name }});

        res.json({ docid: docId });
      });
    });
  } else res.json({ error: true, message: 'No session found.' });
});

app.post('/collection/delete', function(req, res) {
  if (req.session.name) {
    let doc = connection.get('docs', req.body.docid); // ShareDB document
    doc.fetch(async (err) => {
      if (err) throw err;
      if (doc.type == null) // Doc does not exist
        res.json({ error: true, message: 'Document does not exist.' });
      else {
        doc.del();
        doc.destroy();
        res.json({});
      }
    });
  } else res.json({ error: true, message: 'No session found.' });
});

app.get('/collection/list', async function (req, res) {
  if (req.session.name) {
    let results = await docs
      .find({ _type: { $ne: null } })
      .sort({'_m.mtime': -1})
      .limit(10)
      .toArray();

    // Since API wants this field
    results.forEach((e) => { e.id = e._id; })
    res.json(results);
  } else res.json({ error: true, message: 'No session found.' });
});

// =====================================================================
// Doc routes
app.get('/doc/edit/:docid', async function (req, res) {
  if (req.session.name) {
    let doc = await docs.findOne({ _id: req.params.docid });
    res.render('doc', {
      name: req.session.name,
      email: req.session.email,
      docName: doc.name,
      docId: doc._id
    });
  } else {
    res.json({ error: true, message: 'Session not found.' });
  }
});

app.get('/doc/connect/:docid/:uid', function (req, res) {
  
});

// Get HTML of current document
app.get('/doc/get/:docid/:uid', function (req, res) {
  if (req.session.name) {
    let doc = connection.get('docs', req.params.docid);
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null) // Doc does not exist
        return res.json({ error: true, message: 'Document does not exist!' });

      res.set('Content-Type', 'text/html');
      const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
      const html = converter.convert();

      res.send(Buffer.from(html));
    });
  } else res.json({ error: true, message: 'Session not found.' });
});