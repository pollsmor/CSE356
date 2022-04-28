const cluster = require('cluster');
const os = require('os');
let connection; // ShareDB connection

if (cluster.isMaster) {
  const mongoUri = 'mongodb://localhost:27017/final';
  const http = require('http');
  const express = require('express');
  const mongoose = require('mongoose');
  const session = require('express-session');
  const MongoDBStore = require('connect-mongodb-session')(session);
  const ShareDB = require('sharedb');
  const db = require('sharedb-mongo')(mongoUri);
  const WebSocket = require('ws');
  const WebSocketJSONStream = require('@teamwork/websocket-json-stream');

  // Mongoose models
  const User = require('./models/user');
  const DocInfo = require('./models/docinfo'); // For now, only to store doc name

  // Session handling
  mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
  const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });

  // Setup ShareDB and connect to it via WebSockets
  const app = express();
  const server = http.createServer(app);
  ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
  const backend = new ShareDB({db});
  connection = backend.connect();
  const wss = new WebSocket.Server({ server: server });
  wss.on('connection', (ws) => {
    backend.listen(new WebSocketJSONStream(ws));
  });

  const coreCount = os.cpus().length;
  const workers = [];
  let workerIdx = 0; // Cycle through workers evenly
  const docsAssignedToWorkers = {};

  // Middleware
  app.set('view engine', 'ejs');
  app.use(express.static('public'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true })); // Parse HTML form data as JSON
  app.use(session({
    secret: 'secret',
    store: store,
    resave: false,
    saveUninitialized: false
  }));
  app.use(function(req, res, next) {
    res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
    next(); // Set ID header for every route
  });

  for (let i = 0; i < coreCount; i++)
    workers[i] = cluster.fork();

  function randomStr() {
    return Math.random().toString(36).slice(2);
  }

  server.listen(3000, () => {
    console.log('Google Docs Clone is now running.');
  });

  // Routes ====================================================================
  // Route just for convenience
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
    } else res.json({ error: true, message: '[HOME] Session not found.' });
  });

  // User routes
  app.post('/users/login', async function (req, res) {
    // Try to log in with provided credentials
    let user = await User.findOne({ email: req.body.email });
    if (!user || !user.verified || req.body.password !== user.password) {
      res.json({ error: true, message: '[LOGIN] Incorrect credentials or unverified.' });
    } else { // Establish session
      req.session.name = user.name;
      req.session.email = user.email;
      res.json({ name: user.name });
    }
  });

  app.post('/users/logout', function (req, res) {
    if (req.session.name) {
      req.session.destroy();
      res.json({});
    } else res.json({ error: true, message: '[LOGOUT] You are already logged out.' }); 
  });

  app.post('/users/signup', async function (req, res) {
    let email = req.body.email;
    let emailExists = await User.exists({ email: email });
    if (emailExists)
      return res.json({ error: true, message: '[SIGN UP] Email already exists.' });

    // Create user
    let key = randomStr();
    let user = new User({
      name: req.body.name,
      email: email,
      password: req.body.password,
      key: key
    });
    user.save();

    // Send verification email
    let encodedEmail = encodeURIComponent(email);
    transport.sendMail({
        to: email,
        subject: 'Verification key',
        text: `http://${serverIp}/users/verify?email=${encodedEmail}&key=${key}`
    });

    res.json({});
  });

  app.get('/users/verify', async function (req, res) {
    let user = await User.findOne({ email: req.query.email });
    if (user == null || user.key !== req.query.key) {
      res.json({ error: true, message: '[VERIFY] Invalid email or key.'});
    } else {
      // Verify and establish session
      user.verified = true;
      user.save();
      req.session.name = user.name; 
      req.session.email = user.email;
      res.redirect('/home'); // (Optional) redirect to homepage
    }
  });

  // =====================================================================
  // Collection routes
  app.post('/collection/create', async function (req, res) {
    if (req.session.name) {
      let docId = randomStr(); // Since documents can share names
      let doc = connection.get('docs', docId); // ShareDB document
      await doc.fetch();
      if (doc.type != null) { // Just in case randomStr() generates the same docId somehow
        res.json({ error: true, message: '[CREATE DOC] Please try again.' });
      } else {
        await doc.create([], 'rich-text');

        // Use another collection to store document info (for now, name)
        let docinfo = new DocInfo({ docId: docId, name: req.body.name });
        docinfo.save();
        res.json({ docid: docId });
      }
    } else res.json({ error: true, message: '[CREATE DOC] No session found.' });
  });

  app.post('/collection/delete', async function(req, res) {
    if (req.session.name) {
      let docId = req.body.docid;
      let doc = connection.get('docs', docId); // ShareDB document

      await doc.fetch();
      if (doc.type == null) {
        res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });
      } else {
        DocInfo.deleteOne({ id: docId });
        doc.del(); // Sets doc.type to null
        doc.destroy(); // Removes doc object from memory
        res.json({});
      }
    } else res.json({ error: true, message: '[DELETE DOC] No session found.' });
  });

  app.get('/collection/list', async function (req, res) {
    if (req.session.name) {
      connection.createFetchQuery('docs', {
        $sort: {'_m.mtime': -1 }, // Sort by modification time, latest to earliest
        $limit: 10,
      }, {}, async (err, results) => {
        if (err) throw err;

        // Maintain order of docIds passed in via aggregate() function
        let docIds = results.map(r => r.id); // Query DocInfo with list of docIds
        let docinfoArr = await DocInfo.aggregate([
          { $match: { docId: { $in: docIds }}},
          { $addFields: { '_order': {$indexOfArray: [docIds, '$docId']}}},
          { $sort: { '_order': 1 }}
        ]);

        let output = docinfoArr.map(r => ({ id: r.docId, name: r.name }));
        res.json(output);
      });
    } else res.json({ error: true, message: '[DOC LIST] No session found.' });
  });

  // =====================================================================
  // Doc routes
  app.get('/doc/edit/:docid', async function (req, res) {
    if (req.session.name) {
      let docId = req.params.docid;

      // I query the DocInfo collection first because doc.del() doesn't actually delete in ShareDB.
      let docinfo = await DocInfo.findOne({ docId: docId });
      if (docinfo == null) { // Document does not exist
        res.json({ error: true, message: '[EDIT DOC] Document does not exist.' });
      } else {
        res.render('doc', {
          name: req.session.name,
          email: req.session.email,
          docName: docinfo.name,
          docId: docId
        });
      }
    } else res.json({ error: true, message: '[EDIT DOC] Session not found.' });
  });

  // Setup Delta event stream
  app.get('/doc/connect/:docid/:uid', async function (req, res) {
    if (req.session.name) {
      let docId = req.params.docid;
      let uid = req.params.uid;

      if (!(docId in docsAssignedToWorkers)) {
        docsAssignedToWorkers[docId] = workerIdx++;
        if (workerIdx === coreCount) workerIdx = 0;
      }
    } else res.json({ error: true, message: '[SETUP STREAM] Session not found' });
  });

  // Submit Delta op to ShareDB and to other users
  app.post('/doc/op/:docid/:uid', async function (req, res) {
    if (req.session.name) {
      let docId = req.params.docid;
      
    } else res.json({ error: true, message: '[SUBMIT OP] Session not found.' });
  });

} else {

}