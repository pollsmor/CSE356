const mongoUri = 'mongodb://localhost:27017/final';

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const WebSocket = require('ws');
const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const nodemailer = require('nodemailer');
const QuillDeltaToHtmlConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');

// MongoDB/Mongoose models
const User = require('./models/User');
const File = require('./models/File');
const DocMetadata = require('./models/DocMetadata');

// Setup ShareDB and connect to it via WebSockets
const app = express();
const server = http.createServer(app);
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();
const wss = new WebSocket.Server({ server: server });
wss.on('connection', (ws) => {
  backend.listen(new WebSocketJSONStream(ws));
});

// Connect to local Postfix mail server
const transport = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  tls: { rejectUnauthorized: false }
});

// Session handling
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
mongoose.connection.once('open', () => {});
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });
store.on('error', (err) => { throw err; }); // Catch errors
app.use(session({
  secret: 'secret',
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    sameSite: 'lax'
  }, 
  store: store,
  resave: false,
  saveUninitialized: false
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse form data as JSON
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 1024 * 1024 }, // 1 MB
  abortOnLimit: true
}));
// Set ID header for every route
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next();
});

let serverIp = '209.94.56.234'; // Easier to just hardcode this
const users_of_docs = new Map(); // Keep track of users viewing each document
const docVersions = {};
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache'
};

server.listen(3000, () => {
  console.log('Google Docs Clone is now running.');
});

function randomStr() {
  return Math.random().toString(36).slice(2);
}

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
app.post('/users/login', function (req, res) {
  // Try to log in with provided credentials
  let email = req.body.email;
  User.findOne(
    { email: email },
    (err, user) => {
      if (err) throw err;
      if (!user || !user.verified || req.body.password !== user.password)
        res.json({ error: true, message: 'Incorrect credentials or unverified.' });
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
  let email = req.body.email;
  let emailExists = await User.exists({ email: email });
  if (emailExists)
    return res.json({ error: true, message: 'Email already exists.' });

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
  let encodedEmail = encodeURIComponent(user.email);
  await transport.sendMail({
      to: email,
      subject: 'Verification key',
      text: `http://${serverIp}/users/verify?email=${encodedEmail}&key=${key}`
  });

  res.json({});
});

app.get('/users/verify', async function (req, res) {
  let email = req.query.email;
  User.findOne(
    { email: email },
    (err, user) => {
      if (err) throw err;
      if (user == null || user.key !== req.query.key)
        res.json({ error: true, message: 'Invalid email or key.'});
      else {
        user.verified = true;
        user.save();

        // Establish session
      req.session.name = user.name; 
      req.session.email = email;
      res.redirect('/home'); // (Optional) redirect to homepage
      }
    }
  );
});

// =====================================================================
// Collection routes
app.post('/collection/create', function (req, res) {
  if (req.session.name) {
    let docId = randomStr();
    let doc = connection.get('docs', docId); // ShareDB document
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type != null)
        return res.json({ error: true, message: 'Document already exists.' });

      doc.create([], 'rich-text', (err2) => {
        if (err2) throw err2;
        console.log('Create document.');

        // Use another collection to store document metadata
        let metadata = new DocMetadata({ id: docId, name: req.body.name });
        metadata.save();

        res.json({ docid: docId });
      });
    });
  } else res.json({ error: true, message: '[CREATE DOC] No session found.' });
});

app.post('/collection/delete', function(req, res) {
  if (req.session.name) {
    let docId = req.body.docid;

    let doc = connection.get('docs', docId); // ShareDB document
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null)
        res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });
      else {
        console.log('Delete document.');
        DocMetadata.deleteOne(
          { id: docId }, (err) => {
            if (err) throw err;
            doc.del(); // Sets doc.type to null
            doc.destroy(); // Removes doc object from memory

            res.json({});
          }
        );
      }
    });
  } else res.json({ error: true, message: '[DELETE DOC] No session found.' });
});

app.get('/collection/list', async function (req, res) {
  if (req.session.name) {
    connection.createFetchQuery('docs', {
      $sort: {'_m.mtime': -1 },
      $limit: 10,
    }, {}, async (err, results) => {
      if (err) throw err;

      // Since API wants an id and name field (need metadata)
      let docIds = results.map(r => r.id);
      // Maintain order of docIds passed in via aggregate()
      let metadataArr = await DocMetadata.aggregate([
        { $match: { id: { $in: docIds }}},
        { $addFields: { '_order': {$indexOfArray: [docIds, '$id']}}},
        { $sort: { '_order': 1 }}
      ]);

      let output = [];
      for (let i = 0; i < results.length; i++) {
        let obj = {};
        obj.id = metadataArr[i].id;
        obj.name = metadataArr[i].name;

        output.push(obj);
      }

      res.json(output);
    });
  } else res.json({ error: true, message: '[DOC LIST] No session found.' });
});

// =====================================================================
// Doc routes
app.get('/doc/edit/:docid', async function (req, res) {
  if (req.session.name) {
    let docId = req.params.docid;

    // I query the metadata DB first because doc.del() doesn't actually delete in ShareDB.
    let metadata = await DocMetadata.findOne({ id: docId });
    if (metadata == null) // Document does not exist
      return res.json({ error: true, message: '[EDIT DOC] Document does not exist.' });

    connection.createFetchQuery('docs', { _id: docId }, {}, (err, results) => {
      let doc = results[0];
      res.render('doc', {
        name: req.session.name,
        email: req.session.email,
        docName: metadata.name,
        docId: doc.id
      });
    });
  } else res.json({ error: true, message: '[EDIT DOC] Session not found.' });
});

// Setup Delta event stream
app.get('/doc/connect/:docid/:uid', function (req, res) {
  if (req.session.name) {
    let docId = req.params.docid;
    let uid = req.params.uid;

    // Tie res object to doc
    if (users_of_docs.has(docId))
      users_of_docs.get(docId).set(uid, res); 
    else { // Doc not tracked in map yet
      let docMap = new Map();
      docMap.set(uid, res);
      users_of_docs.set(docId, docMap);
    }

    // Get whole document on initial load
    let doc = connection.get('docs', docId);
    doc.subscribe((err) => {
      if (err) throw err;
      if (doc.type == null)
        return res.json({ error: true, message: '[SETUP STREAM] Document does not exist.' });

      console.log(`User ${uid} has connected to document ${docId}.`);
      if (!(docId in docVersions))
        docVersions[docId] = doc.version;

      res.writeHead(200, streamHeaders); // Setup stream
      res.write(`data: { "content": ${JSON.stringify(doc.data.ops)}, "version": ${docVersions[docId]} }\n\n`);
      
      let receiveOp = (op, source) => {
        if (source !== uid)
          res.write(`data: ${JSON.stringify(op)}\n\n`);
      };
      
      doc.on('op', receiveOp);

      // Remove connection upon closing
      res.on('close', () => {
        doc.off('op', receiveOp);
        doc.unsubscribe();
        users_of_docs.get(docId).delete(uid);

        // Broadcast presence disconnection
        for (let [otherUid, otherRes] of users_of_docs.get(docId)) {
          otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": null }}\n\n`);
        }
      });
    });
  } else res.json({ error: true, message: '[SETUP STREAM] Session not found' });
});

// Submit Delta op to ShareDB and to other users
app.post('/doc/op/:docid/:uid', function (req, res) {
  if (req.session.name) {
    let docId = req.params.docid;
    let uid = req.params.uid;
    let version = req.body.version;
    let op = req.body.op;

    let doc = connection.get('docs', docId);
    doc.fetch((err) => {
      if (err) throw err;
      else if (doc.type == null)
        return res.json({ error: true, message: '[SUBMIT OP] Document does not exist.' });
      if (version < docVersions[docId]) { // Reject and tell client to retry
        return res.json({ status: 'retry' });
      } else if (version > docVersions[docId]) {
        console.log('AHEAD');
        return res.json({ error: true, message: '[SUBMIT OP] Client is somehow ahead of server.' });
      } else {
        docVersions[docId]++;
        doc.submitOp(op, { source: uid }, (err) => {
          if (err) throw err;   

          users_of_docs.get(docId).get(uid).write(`data: { "ack": ${JSON.stringify(op)} }\n\n`);
          res.json({ status: 'ok' });
        });
      }
    });
  } else res.json({ error: true, message: '[SUBMIT OP] Session not found.' });
});

// Get HTML of current document
app.get('/doc/get/:docid/:uid', function (req, res) {
  if (req.session.name) {
    let doc = connection.get('docs', req.params.docid);
    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null)
        return res.json({ error: true, message: '[GET HTML] Document does not exist!' });

      res.set('Content-Type', 'text/html');
      const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
      const html = converter.convert();

      res.send(Buffer.from(html));
    });
  } else res.json({ error: true, message: '[GET HTML] Session not found.' });
});

// Presence
app.post('/doc/presence/:docid/:uid', function(req, res) {
  let docId = req.params.docid;
  let uid = req.params.uid;
  let presenceData = { 
    index: req.body.index, 
    length: req.body.length,
    name: uid
  };

  for (let [otherUid, otherRes] of users_of_docs.get(docId)) {
    if (uid !== otherUid) {
      otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": ${JSON.stringify(presenceData)} }}\n\n`);
    }
  }

  res.json({});
});

// =====================================================================
// Media routes
app.post('/media/upload', function (req, res) {
  if (req.session.name) {
    if (!req.files)
      return res.json({ error: true, message: '[UPLOAD] No file uploaded.' });

    let file = req.files.image; // Testing uses .image
    if (file == null) file = req.files.file;
    let mime = file.mimetype;
    if (mime !== 'image/png' && mime !== 'image/jpeg')
      return res.json({error: true, message: '[UPLOAD] Only .png and .jpeg files allowed.' });

    let filePath = `${__dirname}/public/img/${file.md5}`;
    file.mv(filePath, (err) => {
      if (err) throw err;

      // Store mime type into MongoDB
      let fileData = new File({ md5: file.md5, mime: mime})
      fileData.save();
      res.json({ mediaid: file.md5 });
    });
  } else res.json({ error: true, message: '[UPLOAD] Session not found.' });
});

app.get('/media/access/:mediaid', function (req, res) {
  if (req.session.name) {
    let mediaId = req.params.mediaid;
    let filePath = __dirname + '/public/img/' + mediaId;
    if (fs.existsSync(filePath)) {
      File.findOne({ md5: mediaId }, (err, file) => {
        let mime = file.mime;
        if (mime !== 'image/png' && mime !== 'image/jpeg')
          res.json({ error: true, message: '[ACCESS MEDIA] Not a .png or .jpeg!' });
        else {
          res.set('Content-Type', mime);
          res.sendFile(filePath);
        }
      });
    } else res.json({ error: true, message: '[ACCESS MEDIA] File does not exist. ' });
  } else res.json({ error: true, message: 'Session not found.' });
});