require('dotenv').config()
const mongoUri = process.env.MONGO_URI;
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html');
const axios = require('axios');

// Setup ShareDB
const app = express();
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

// Connect to Mongoose + models
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const DocInfo = require('./models/docinfo');
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });

// Constants
const docVersions = {};
const users_of_docs = new Map();
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
};

// Middleware
app.set('view engine', 'ejs');
app.use(express.json({ limit: '10mb' }));
app.use('/doc/edit', express.static('public'));
app.use('/doc/edit', session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false
}));

const server = app.listen(80, () => {
  console.log('Proxy is now running.');
});

// Routes ====================================================================
app.get('/doc/edit/:docid', async function (req, res) {
  let docId = req.params.docid;

  let docinfo = await DocInfo.findOne({ docId: docId }).lean();
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
});

// Setup Delta event stream
app.get('/doc/connect/:docid/:uid', function (req, res) {
  let docId = req.params.docid;
  let uid = req.params.uid;

  // Get whole document on initial load
  let doc = connection.get('docs', docId);
  doc.subscribe((err) => {
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

    let receiveOp = (op, source) => {
      op = JSON.stringify(op);
      if (source !== uid)
        res.write(`data: ${op}\n\n`);
      else
        res.write(`data: { "ack": ${op} }\n\n`);
    };
    doc.on('op', receiveOp);

    res.on('close', () => {
      // Broadcast presence disconnection
      doc.off('op', receiveOp);
      let users_of_doc = users_of_docs.get(docId);
      users_of_doc.delete(uid);
      users_of_doc.forEach((otherRes, otherUid) => {
        otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": null }}\n\n`);
      });

      if (users_of_doc.size === 0) {
        users_of_docs.delete(docId);
        setTimeout(() => { // Don't stop indexing immediately
          // Check if another user connected during the 10s and if so, don't remove this
          if (users_of_doc.size === 0)
            delete docVersions[docId];
        }, 10000);
      }
    });
  });
});

// Submit Delta op to ShareDB and to other users
app.post('/doc/op/:docid/:uid', function (req, res) {
  if (!('op' in req.body))
    return res.json({ error: true, message: '[SUBMIT OP] Undefined op not allowed!' });

  let docId = req.params.docid;
  let version = req.body.version;

  let doc = connection.get('docs', docId);
  if (version == docVersions[docId]) {
    docVersions[docId]++;
    doc.submitOp(req.body.op, { source: req.params.uid }, (err) => {
      if (err) throw err;
      res.json({ status: 'ok' });
    });
  } else if (version < docVersions[docId]) {
    res.json({ status: 'retry' });
  } else { // Shouldn't get to this point
    res.json({ error: true, message: '[SUBMIT OP] Client is somehow ahead of server.' });
  }
});

// Get HTML of current document
app.get('/doc/get/:docid/:uid', function (req, res) {
  let docId = req.params.docid;
  let doc = connection.get('docs', docId);
  doc.fetch((err) => {
    if (doc.type == null)
      return res.json({ error: true, message: '[GET HTML] Document does not exist!' });

    const converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
    const html = converter.convert();

    res.set('Content-Type', 'text/html');
    res.send(Buffer.from(html));
  });
});

// Presence
app.post('/doc/presence/:docid/:uid', function(req, res) {
  let uid = req.params.uid;
  let presenceData = JSON.stringify({
    index: req.body.index,
    length: req.body.length,
    name: uid // He doesn't even check for name :D
  });

  // Broadcast presence to everyone else
  let users_of_doc = users_of_docs.get(req.params.docid);
  users_of_doc.forEach((otherRes, otherUid) => {
    if (uid !== otherUid)
      otherRes.write(`data: { "presence": { "id": "${uid}", "cursor": ${presenceData} }}\n\n`);
  });

  res.json({});
});

// Index into Elasticsearch from time to time
setInterval(() => {
  if (Object.keys(docVersions).length > 0) {
    axios.post(`https://${process.env.MAIN_MACHINE}/index/refresh`, {
      docIds: Object.keys(docVersions)
    }).catch(err => {
      console.log(err);
    });
  }
}, 10000);
