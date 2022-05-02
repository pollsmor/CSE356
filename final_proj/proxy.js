require('dotenv').config();
const mongoUri = process.env.MONGO_URI;
const express = require('express');
const mongoose = require('mongoose');
const session = require('cookie-session');

/*
Port 3000: This proxy server
Port 3001: Contains stateless services (i.e. login)
*/
const app = express();
const machineIps = process.env.WORKER_MACHINES.split(' ');
const proxyPort = 3000;
const proxy = require('http-proxy').createProxyServer({ 
  host: process.env.MAIN_MACHINE,
  port: proxyPort
});

// Connect to Mongoose + models
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const DocInfo = require('./models/docinfo'); 

// Assign new documents to machines equally
const machineAssignedToDocs = {};
let machineIpIdx = 0;

// Middleware
app.set('view engine', 'ejs');
app.use(session({
  name: 'session',
  keys: ['secret']
}));
app.use(function(req, res, next) { 
  if (req.session.name) next();
  else res.json({ error: true, message: 'Session not found.' });
});

app.listen(proxyPort, () => {
  console.log(`Google Docs Clone is now running on port ${proxyPort}.`);
});

// Proxy requests =========================================================
// Easier to just put edit route right here
app.get('/doc/edit/:docid', async function (req, res) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx++];
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  // I query the DocInfo collection first because doc.del() doesn't actually delete in ShareDB.
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

// Distribute load based on document ID
app.use('/doc/connect/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx++];
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  proxy.web(req, res, {
    target: `http://${machineAssignedToDocs[docId]}/doc/connect/${docId}/${req.params.uid}`
  }, next);
});

// Need to be connected to doc first
app.use('/doc/op/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  proxy.web(req, res, {
    target: `http://${machineAssignedToDocs[docId]}/doc/op/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/get/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx++];
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  proxy.web(req, res, {
    target: `http://${machineAssignedToDocs[docId]}/doc/get/${docId}/${req.params.uid}`
  }, next);
});

// Need to be connected to doc first
app.use('/doc/presence/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  proxy.web(req, res, {
    target: `http://${machineAssignedToDocs[docId]}/doc/presence/${docId}/${req.params.uid}`
  }, next);
});