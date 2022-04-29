const mongoUri = 'mongodb://localhost:27017/final';
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const nodemailer = require('nodemailer');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { Client } = require('@elastic/elasticsearch');

// Mongoose models
const User = require('./models/user');
const DocInfo = require('./models/docinfo'); // For now, only to store doc name

// Session handling
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });

// Setup ShareDB
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
        }
      }
    }
  }
}).catch(err => {
  console.log('Index already exists.');
});

const app = express();
const port = 3001;
const serverIp = '209.94.58.105'; // Easier to just hardcode this

// Middleware
app.set('view engine', 'ejs');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // Parse HTML form data as JSON
app.use(fileUpload({ createParentPath: true, abortOnLimit: true }));
app.use(session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false
}));

function randomStr() {
  return Math.random().toString(36).slice(2);
}

app.listen(port, () => {
  console.log(`Stateless services running on port ${port}.`);
});

// =====================================================================
// Just for convenience, grading script actually uses /home for JSON response
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

    let fileName = file.md5 + path.extname(file.name);
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

app.post('/elastic', function (req, res) {

});