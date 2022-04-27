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
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html')
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { Client } = require('@elastic/elasticsearch');
const redis = require('async-redis');

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

// Create Elasticsearch index if not exists
const esClient = new Client({ node: 'http://localhost:9200' });
esClient.indices.create({
  index: 'docs',
  body: { 
    settings: {
      analysis: {
        analyzer: {
          my_analyzer: {
            tokenizer: 'standard',
            char_filter: ['html_strip'],
            filter: ['lowercase', 'porter_stem', 'stop']
          }
        }
      },
    },
    mappings: {
      properties: {
        contents: {
          type: 'text',
          analyzer: 'my_analyzer'
        }
      }
    }
  }
}).catch(err => {
  console.log('Index already exists.');
});

const redisClient = redis.createClient();
redisClient.on('error', (err) => {
  throw err;
});

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Parse HTML form data as JSON
app.use(fileUpload({ createParentPath: true, abortOnLimit: true }));
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

// Constants
let serverIp = '209.94.59.175'; // Easier to just hardcode this
const users_of_docs = new Map(); // Keep track of users viewing each document
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
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

        // Use another collection to store document info (for now, name)
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

    doc.fetch((err) => {
      if (err) throw err;
      if (doc.type == null) {
        res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });
      } else {
        DocInfo.deleteOne({ id: docId });
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
app.get('/doc/connect/:docid/:uid', function (req, res) {
  if (req.session.name) {
    let docId = req.params.docid;
    let uid = req.params.uid;

    // Tie res object to doc
    if (users_of_docs.has(docId))
      users_of_docs.get(docId).set(uid, res); 
    else { // Doc not tracked in map yet
      let users_of_doc = new Map();
      users_of_doc.set(uid, res);
      users_of_docs.set(docId, users_of_doc);
    }

    // Get whole document on initial load
    let doc = connection.get('docs', docId);
    doc.subscribe(async (err) => {
      if (err) throw err;
      if (doc.type == null)
        return res.json({ error: true, message: '[SETUP STREAM] Document does not exist.' });

      // doc.version is too slow, store doc version on initial load of doc
      await redisClient.set(docId, doc.version);
      // Setup stream and provide initial document contents
      res.writeHead(200, streamHeaders); 
      res.write(`data: { "content": ${JSON.stringify(doc.data.ops)}, "version": ${doc.version} }\n\n`);
      
      let receiveOp = (op, source) => {
        if (source !== uid) {
          res.write(`data: ${JSON.stringify(op)}\n\n`);
        }
      };
      
      doc.on('op', receiveOp);
      res.on('close', () => { // End connection
        doc.off('op', receiveOp);
        doc.unsubscribe();
        users_of_docs.get(docId).delete(uid);

        // Broadcast presence disconnection
        let users_of_doc = users_of_docs.get(docId);
        users_of_doc.forEach((otherRes, otherUid) => {
          otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": null }}\n\n`);
        });
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
    doc.fetch(async (err) => {
      if (err) throw err;
      else if (doc.type == null)
        return res.json({ error: true, message: '[SUBMIT OP] Document does not exist.' });

      let docVersion = await redisClient.get(docId);
      if (version == docVersion) {
        await redisClient.incr(docId);
        doc.submitOp(op, { source: uid }, async (err2) => {
          if (err2) throw err2;   
          let userThatSubmitted = users_of_docs.get(docId).get(uid);
          if (userThatSubmitted != null) // In case user disconnected right when submitOp happened
            userThatSubmitted.write(`data: { "ack": ${JSON.stringify(op)} }\n\n`);

          // Index into Elasticsearch from time to time
          // if (docVersions[docId] % 20 === 0) {
          //   let docinfo = await DocInfo.findOne({ docId: docId });
          //   let converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
          //   let html = converter.convert().toString();
          //   esClient.index({
          //     index: 'docs',
          //     id: docId,
          //     body: {
          //       docName: docinfo.name,
          //       contents: html,
          //     }
          //   });
          // }

          res.json({ status: 'ok' });
        });
      } else if (version < docVersion) {
        res.json({ status: 'retry' });
      } else { // Shouldn't get to this point
        res.json({ error: true, message: '[SUBMIT OP] Client is somehow ahead of server.' });
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

      const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
      const html = converter.convert();

      res.set('Content-Type', 'text/html');
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
  let users_of_doc = users_of_docs.get(docId);
  users_of_doc.forEach((otherRes, otherUid) => {
    if (uid !== otherUid)
      otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": ${JSON.stringify(presenceData)} }}\n\n`);
  });

  res.json({});
});

// =====================================================================
// Media routes
app.post('/media/upload', function (req, res) {
  if (req.session.name) {
    if (!req.files)
      return res.json({ error: true, message: '[UPLOAD] No file uploaded.' });

    let file = req.files.image; // doc.js's image uploading for client uses .image
    if (file == null) file = req.files.file;
    let mime = file.mimetype;
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/gif')
      return res.json({error: true, message: '[UPLOAD] Only .png .jpg and .gif files allowed.' });

    let fileName = file.md5 + path.extname(file.name)
    file.mv(`${__dirname}/public/img/${fileName}`, (err) => {
      if (err) throw err;
      res.json({ mediaid: fileName });
    });
  } else res.json({ error: true, message: '[UPLOAD] Session not found.' });
});

app.get('/media/access/:mediaid', async function (req, res) {
  if (req.session.name) {
    let fileName = req.params.mediaid;
    let filePath = __dirname + '/public/img/' + fileName;
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else res.json({ error: true, message: '[ACCESS MEDIA] File does not exist. ' });
  } else res.json({ error: true, message: '[VIEW MEDIA] Session not found.' });
});

// =====================================================================
// Milestone 3: Search/Suggest
app.get('/index/search', async function (req, res) {
  if (req.session.name) {
    let word = req.query.q;
    if (word == null) 
      return res.json({ error: true, message: '[SEARCH] Empty query string.' });

    let results = await esClient.search({
      index: 'docs',
      query: {
        bool: {
          should: [
            { prefix: { docName: word }},
            { prefix: { contents: word }}
          ]
        }
      },
      highlight: {
        fields: { contents: {}}
      },
      size: 10
    });

    res.json(results);
  } else res.json({ error: true, message: '[SEARCH] Session not found.' });
});

app.get('/index/suggest', function (req, res) {
  if (req.session.name) {
    
  } else res.json({ error: true, message: '[SUGGEST] Session not found.' });
});