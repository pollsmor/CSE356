const mongoUri = 'mongodb://localhost:27017/final';

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const nodemailer = require('nodemailer');
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html')
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { Client } = require('@elastic/elasticsearch');
const { convert } = require('html-to-text');

// Mongoose models
const User = require('./models/user');
const DocInfo = require('./models/docinfo'); // For now, only to store doc name

// Session handling
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });

// Setup ShareDB
const app = express();
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

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
        },
        suggest: {
          type: 'completion',
          analyzer: 'my_analyzer'
        }
      }
    }
  }
}).catch(err => {
  console.log('Index already exists.');
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
const docVersions = {};
const users_of_docs = new Map();
const serverIp = '209.94.58.105'; // Easier to just hardcode this
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
};

app.listen(3000, () => {
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
app.post('/collection/create', async function (req, res) {
  if (req.session.name) {
    let docId = randomStr(); // Since documents can share names
    let doc = connection.get('docs', docId); // ShareDB document
    doc.fetch((err) => {
      if (doc.type != null) { // Just in case randomStr() generates the same docId somehow
        res.json({ error: true, message: '[CREATE DOC] Please try again.' });
      } else {
        doc.create([], 'rich-text');
  
        // Use another collection to store document info (for now, name)
        let docinfo = new DocInfo({ docId: docId, name: req.body.name });
        docinfo.save();
        res.json({ docid: docId });
      }
    });
  } else res.json({ error: true, message: '[CREATE DOC] No session found.' });
});

app.post('/collection/delete', async function(req, res) {
  if (req.session.name) {
    let docId = req.body.docid;
    let doc = connection.get('docs', docId); // ShareDB document

    doc.fetch((err) => {
      if (doc.type == null) {
        res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });
      } else {
        DocInfo.deleteOne({ id: docId });
        doc.del(); // Sets doc.type to null
        doc.destroy(); // Removes doc object from memory
        docVersions.delete(docId);
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
    let phrase = req.query.q;
    if (phrase == null) 
      return res.json({ error: true, message: '[SEARCH] Empty query string.' });

    let results = await esClient.search({
      index: 'docs',
      query: {
        bool: {
          should: [
            { 
              match: { 
                contents: phrase
              }
            },
            { 
              match: {
                 docName: phrase 
              }
            }
          ]
        }
      },
      fields: ['docName', 'contents'],
      _source: false,
      highlight: {
        fields: { 
          contents: {}
        }
      },
      size: 10
    });

    results = results.hits.hits;
    let output = await Promise.all(results.map(async (r) => {
      let docId = r._id;
      let docinfo = await DocInfo.findOne({ docId: docId });
      let snippet = 'highlight' in r ? r.highlight.contents[0] : '';

      return {
        docid: docId,
        name: docinfo.name,
        snippet: snippet
      };
    }));

    res.json(output);
  } else res.json({ error: true, message: '[SEARCH] Session not found.' });
});

app.get('/index/suggest', async function (req, res) {
  if (req.session.name) {
    let phrase = req.query.q;
    if (phrase == null) 
      return res.json({ error: true, message: '[SEARCH] Empty query string.' });

    let results = await esClient.search({
      _source: false,
      suggest: {
        suggestion: {
          prefix: phrase,
          completion: {
            field: 'suggest',
            fuzzy: {
              fuzziness: 2
            }
          }
        }
      },
      _source: false
    });

    results = results.suggest.suggestion[0].options;

    let output = results.map((r) => {
      return r.text;
    });

    res.json(output);
  } else res.json({ error: true, message: '[SUGGEST] Session not found.' });
});

// Index into Elasticsearch from time to time
setInterval(() => {
  Object.keys(docVersions).forEach((docId) => {
    let doc = connection.get('docs', docId);
    doc.fetch(async (err) => {
      if (err) throw err;
      let docinfo = await DocInfo.findOne({ docId: docId });
      let converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
      let html = convert(converter.convert());
      let words = html.split(/\s+/);
      esClient.index({
        index: 'docs',
        id: docId,
        body: {
          docName: docinfo.name,
          contents: html,
          suggest: words
        }
      });

      esClient.indices.refresh({ index: 'docs' });
    });
  })
}, 5000);