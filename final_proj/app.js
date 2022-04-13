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
// Native MongoDB driver
const { MongoClient } = require('mongodb');
const client = new MongoClient(mongoUri);
let docs;
client.connect((err) => {
  if (err) throw err;
  const db = client.db('final');
  docs = db.collection('docs');
});

// Setup ShareDB and connect to it via WebSockets
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const DocName = require('./models/DocNameModel');

ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
  backend.listen(new WebSocketJSONStream(ws));
});

// Keep track of users for every document
const users_of_docs = new Map();

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
      doc.create([], 'rich-text', () => {
        // Separate collection to store document name
        let docName = new DocName({ 
          id: docId,
          name: req.body.name 
        });

        docName.save();
        res.json({ docid: docId });
      });
    });
  } else res.json({ error: true, message: 'No session found.' });
});

app.post('/collection/delete', function(req, res) {
  if (req.session.name) {
    let doc = connection.get('docs', req.body.docid); // ShareDB document
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null) // Doc does not exist
        res.json({ error: true, message: 'Document does not exist.' });
      else {
        DocName.deleteOne({ id: req.body.docid }, (err) => {
          if (err) throw err;
          doc.del();
          doc.destroy();
          res.json({});
        })
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

    // Since API wants an id and name field
    for (let result of results) {
      result.id = result._id;
      let docName = await DocName.findOne({ id: result.id });
      result.name = docName.name;
    }

    res.json(results);
  } else res.json({ error: true, message: 'No session found.' });
});

// =====================================================================
// Doc routes
app.get('/doc/edit/:docid', async function (req, res) {
  if (req.session.name) {
    let docId = req.params.docid;
    let doc = await docs.findOne({ _id: docId });
    if (doc == null) // Document does not exist
      return res.json({ error: true, message: 'Document does not exist.' });
      
    let docName = await DocName.findOne({ id: docId });
    res.render('doc', {
      name: req.session.name,
      email: req.session.email,
      docName: docName.name,
      docId: doc._id
    });
  } else res.json({ error: true, message: 'Session not found.' });
});

// Setup Delta event stream
app.get('/doc/connect/:docid/:uid', function (req, res) {
  if (req.session.email === req.params.uid) {
    // Tie res object to doc
    let docId = req.params.docid;
    let uid = req.params.uid;
    if (users_of_docs.has(docId)) {
      users_of_docs.get(docId).set(uid, res); 
    } else { // Doc not tracked in map yet
      let docMap = new Map();
      docMap.set(req.params.uid, res);
      users_of_docs.set(docId, docMap);
    }

    // Untie res object from doc upon disconnect
    req.on('close', () => {
      users_of_docs.get(docId).delete(uid);
    });

    const streamHeaders = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };

    // Get whole document on initial load
    let doc = connection.get('docs', docId);
    doc.fetch((err) => {
      if (err) throw err;
      res.writeHead(200, streamHeaders); // Setup stream
      res.write(`data: { "content": ${JSON.stringify(doc.data.ops)}, "version": ${doc.version} }\n\n`);
    });
  } else res.json({ error: true, message: 'Session not found' });
});

// Submit Delta op and to other users
app.post('/doc/op/:docid/:uid', function (req, res) {
  if (req.session.email === req.params.uid) {
    let docVersion = req.body.version;
    let doc = connection.get('docs', req.params.docid);
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null)
        return res.json({ error: true, message: 'Document does not exist.' });

      if (docVersion <= doc.version)
        return res.json({ status: 'retry' });
      else {
        let op = req.body.op;
        doc.submitOp(op);
        let docUsers = users_of_docs.get(req.params.docid);
        for (let [uid, otherRes] of docUsers) {
          if (req.params.uid !== uid) // Other users
            otherRes.write(`data: ${JSON.stringify(op)}\n\n`);
          else // Acknowledge operation suceeded for sender
            otherRes.write(`data: { "ack": ${JSON.stringify(op)} }\n\n`);
        }

        res.json({ status: 'ok' });
      }
    });
  } else res.json({ error: true, message: 'Session not found.' });
});

// Get HTML of current document
app.get('/doc/get/:docid/:uid', function (req, res) {
  if (req.session.email === req.params.uid) {
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