require('dotenv').config();
const mongoUri = process.env.MONGO_URI;
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

// Connect to Mongoose + models
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const User = require('./models/user');
const DocInfo = require('./models/docinfo');
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

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse HTML form data as JSON
app.use('/media/upload', fileUpload({ createParentPath: true, abortOnLimit: true }));
app.use(session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false,
}));

const serverIp = process.env.MAIN_MACHINE;
const server = app.listen(3001, () => {
  console.log('Stateless services running on port 3001.');
});

// Distribute document IDs evenly between doc instances
const docInstances = 8; // 0-indexed, oops
let docFirstDigit = 0;
function randomStr() {
  let docId = (docFirstDigit++) + Math.random().toString(36).slice(2);
  if (docFirstDigit > docInstances) docFirstDigit = 0; // Loop back
  return docId;
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
  let user = await User.findOne({ email: req.body.email }).lean();
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
  let key = Math.random().toString(36).slice(2);
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
      text: `https://${serverIp}/users/verify?email=${encodedEmail}&key=${key}`
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
      if (doc.type != null) { // Just in case randomStr() generates the same docId somehow
        res.json({ error: true, message: '[CREATE DOC] Please try again.' });
      } else {
        doc.create([], 'rich-text');
  
        // Use another collection to store document info (just the name sadge)
        let docinfo = new DocInfo({ docId: docId, name: req.body.name });
        docinfo.save();
        res.json({ docid: docId });
      }
    });
  } else res.json({ error: true, message: '[CREATE DOC] No session found.' });
});

app.post('/collection/delete', function(req, res) {
  if (req.session.name) {
    let docId = req.body.docid;
    let doc = connection.get('docs', docId); // ShareDB document
    doc.del((err) => {
      if (err) 
        return res.json({ error: true, message: '[DELETE DOC] Document does not exist.' });

      DocInfo.deleteOne({ id: docId });
      doc.destroy() // Removes doc object from memory
      res.json({});
    });
  } else res.json({ error: true, message: '[DELETE DOC] No session found.' });
});

app.get('/collection/list', function (req, res) {
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

    let fileName = file.md5 + path.extname(file.name)
    file.mv(`${__dirname}/public/img/${fileName}`, (err) => {
      if (err) throw err;
      res.json({ mediaid: fileName });
    });
  } else res.json({ error: true, message: '[UPLOAD] Session not found.' });
});

app.get('/media/access/:mediaid', function (req, res) {
  if (req.session.name) {
    let fileName = req.params.mediaid;
    let filePath = __dirname + '/public/img/' + fileName;
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else res.json({ error: true, message: '[ACCESS MEDIA] File does not exist. ' });
  } else res.json({ error: true, message: '[VIEW MEDIA] Session not found.' });
});
