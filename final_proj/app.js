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
const nodemailer = require('nodemailer');
const QuillDeltaToHtmlConverter = require('quill-delta-to-html').QuillDeltaToHtmlConverter;
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');

// MongoDB/Mongoose models
const User = require('./models/user');
const File = require('./models/file'); // To store mediaid/md5 and MIME type of file
const DocInfo = require('./models/docinfo'); // For now, only to store doc name

// Session handling
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
mongoose.connection.once('open', () => {});
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });
store.on('error', (err) => { throw err; }); // Catch errors

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

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse HTML form data as JSON
app.use(session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false
}));

app.use(fileUpload({
  createParentPath: true,
  abortOnLimit: true
}));

// Set ID header for every route
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next();
});

// Constants
let serverIp = '209.94.59.175'; // Easier to just hardcode this
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
  await transport.sendMail({
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
app.post('/collection/create', function (req, res) {
  if (req.session.name) {
    let docId = randomStr(); // Since documents can share names
    let doc = connection.get('docs', docId); // ShareDB document

    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type != null) // Just in case randomStr() generates the same docId somehow
        return res.json({ error: true, message: '[CREATE DOC] Please try again.' });

      doc.create([], 'rich-text', (err2) => {
        if (err2) throw err2;

        // Use another collection to store document metadata
        let docinfo = new DocInfo({ docId: docId, name: req.body.name });
        docinfo.save();
        res.json({ docid: docId });
      });
    });
  } else res.json({ error: true, message: '[CREATE DOC] No session found.' });
});

app.post('/collection/delete', function(req, res) {
  if (req.session.name) {
    let docId = req.body.docid;
    let doc = connection.get('docs', docId); // ShareDB document

    doc.fetch(async (err) => {
      if (err) throw err;
      if (doc.type == null) {
        res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });
      } else {
        await DocInfo.deleteOne({ id: docId });
        doc.del(); // Sets doc.type to null
        doc.destroy(); // Removes doc object from memory
        res.json({});
      }
    });
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
    if (!docinfo) { // Document does not exist
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

      // doc.version is too slow, store doc version on initial load
      if (!(docId in docVersions)) 
        docVersions[docId] = doc.version;

      // Setup stream and provide initial document contents
      res.writeHead(200, streamHeaders); 
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
        return res.json({ error: true, message: '[SUBMIT OP] Client is somehow ahead of server.' });
      } else {
        docVersions[docId]++; // Increment version, thereby locking document
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

  // Broadcast presence to everyone else
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
    file.mv(filePath, async (err) => {
      if (err) throw err;

      // Store mime type into MongoDB (if it does not exist)
      await File.updateOne(
        { md5: file.md5 },
        { $set: { mime: mime }},
        { upsert: true }
      );
      res.json({ mediaid: file.md5 });
    });
  } else res.json({ error: true, message: '[UPLOAD] Session not found.' });
});

app.get('/media/access/:mediaid', async function (req, res) {
  if (req.session.name) {
    let mediaId = req.params.mediaid;
    let filePath = __dirname + '/public/img/' + mediaId;
    if (fs.existsSync(filePath)) {
      let file = await File.findOne({ md5: mediaId });
      console.log(file);
      let mime = file.mime;
      if (mime !== 'image/png' && mime !== 'image/jpeg') {
        res.json({ error: true, message: '[ACCESS MEDIA] Not a .png or .jpeg!' });
      } else {
        res.set('Content-Type', mime);
        //res.sendFile(filePath); // Might need this for submission
        res.send(`http://${serverIp}/img/${mediaId}`);
      }
    } else res.json({ error: true, message: '[ACCESS MEDIA] File does not exist. ' });
  } else res.json({ error: true, message: 'Session not found.' });
});