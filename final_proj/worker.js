const mongoUri = 'mongodb://localhost:27017/final';

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html');
const axios = require('axios');

// Mongoose models
const DocInfo = require('./models/docinfo'); // For now, only to store doc name

// Session handling
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });

// Setup ShareDB
const app = express();
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false
}));

// Constants
const docVersions = {};
const users_of_docs = new Map();
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
};

app.listen(3002, () => {
  console.log('Proxy is now running.');
});

// Routes ====================================================================
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

    // Get whole document on initial load
    let doc = connection.get('docs', docId);
    doc.fetch((err) => {
      if (err) throw err;
      else if (doc.type == null)
      return res.json({ error: true, message: '[SETUP STREAM] Document does not exist.' });

      // Tie res object to doc
      if (users_of_docs.has(docId)) {
        users_of_docs.get(docId).set(uid, res);
      } else { // Doc not tracked yet
        let users_of_doc = new Map();
        users_of_doc.set(uid, res);
        users_of_docs.set(docId, users_of_doc);
      }

      // doc.version is too slow, store doc version on initial load of doc
      if (!(docId in docVersions))
        docVersions[docId] = doc.version;

      // Setup stream and provide initial document contents
      res.writeHead(200, streamHeaders); 
      res.write(`data: { "content": ${JSON.stringify(doc.data.ops)}, "version": ${doc.version} }\n\n`);
  
      res.on('close', () => {
        // Broadcast presence disconnection
        let users_of_doc = users_of_docs.get(docId);
        users_of_doc.delete(uid);
        users_of_doc.forEach((otherRes, otherUid) => {
          otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": null }}\n\n`);
        });
      });
    });
  } else res.json({ error: true, message: '[SETUP STREAM] Session not found' });
});

// Submit Delta op to ShareDB and to other users
app.post('/doc/op/:docid/:uid', async function (req, res) {
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

      if (version == docVersions[docId]) {
        docVersions[docId]++;
        doc.submitOp(op, { source: uid }, async (err2) => {
          if (err2) throw err2;   

          let users_of_doc = users_of_docs.get(docId);
          users_of_doc.forEach((otherRes, otherUid) => {
            if (uid !== otherUid)
              otherRes.write(`data: ${JSON.stringify(op)}\n\n`);
            else 
              otherRes.write(`data: { "ack": ${JSON.stringify(op)} }\n\n`);
          });

          res.json({ status: 'ok' });
        });
      } else if (version < docVersions[docId]) {
        res.json({ status: 'retry' });
      } else { // Shouldn't get to this point
        res.json({ error: true, message: '[SUBMIT OP] Client is somehow ahead of server.' });
      }
    });
  } else res.json({ error: true, message: '[SUBMIT OP] Session not found.' });
});

// Get HTML of current document
app.get('/doc/get/:docid/:uid', async function (req, res) {
  if (req.session.name) {
    let doc = connection.get('docs', req.params.docid);
    doc.fetch((err) => {
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
app.post('/doc/presence/:docid/:uid', async function(req, res) {
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

// Index into Elasticsearch from time to time
setInterval(() => {
  if (Object.keys(docVersions).length > 0) {
    axios.post('http://localhost:3000/index/refresh', {
      docIds: Object.keys(docVersions)
    });
  }
}, 5000);