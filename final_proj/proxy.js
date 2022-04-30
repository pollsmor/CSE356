const express = require('express');
const os = require('os');

/*
Port 3000: This proxy server
Port 3001: Contains stateless services (i.e. login)
Port 3002-whatever: Proxies for every core
*/
const app = express();
const coreCount = 2;
const proxyPort = 3000;
const statelessPort = 3001;
const proxy = require('http-proxy').createProxyServer({ 
  host: 'http://teamsolokid.cse356.compas.cs.stonybrook.edu',
  port: proxyPort
});
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
};

// Assign new documents to cores equally
const coreAssignedToDocs = {};
let coreIdx = 0;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next(); // Set ID header for every route
});

// Ties given doc ID to specific port.
function selectPort(docId) {
  return statelessPort + 1 + coreAssignedToDocs[docId];
}

const server = app.listen(proxyPort, () => {
  console.log(`Google Docs Clone is now running on port ${proxyPort}.`);
});
server.keepAliveTimeout = 10 * 1000;
server.headersTimeout = 10 * 1000;

// Proxy requests =========================================================
app.use('/doc/edit/:docid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in coreAssignedToDocs)) {
    coreAssignedToDocs[docId] = coreIdx++;
    if (coreIdx == coreCount) coreIdx = 0;
  }

  proxy.web(req, res, {
    target: `http://localhost:${selectPort(docId)}/doc/edit/${docId}`
  }, next);
});

// Distribute load based on document ID
app.use('/doc/connect/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in coreAssignedToDocs)) {
    coreAssignedToDocs[docId] = coreIdx++;
    if (coreIdx === coreCount) coreIdx = 0;
  }

  res.writeHead(200, streamHeaders);
  let chosenPort = coreAssignedToDocs[docId];
  proxy.web(req, res, {
    target: `http://localhost:${selectPort(docId)}/doc/connect/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/op/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  let chosenPort = statelessPort + coreAssignedToDocs[docId];
  proxy.web(req, res, {
    target: `http://localhost:${selectPort(docId)}/doc/op/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/get/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  let chosenPort = statelessPort + coreAssignedToDocs[docId];
  proxy.web(req, res, {
    target: `http://localhost:${selectPort(docId)}/doc/get/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/presence/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  let chosenPort = statelessPort + coreAssignedToDocs[docId];
  proxy.web(req, res, {
    target: `http://localhost:${selectPort(docId)}/doc/presence/${docId}/${req.params.uid}`
  }, next);
});

// Stateless microservices
app.use('/', function (req, res, next) {
  proxy.web(req, res, {
    target: `http://localhost:${statelessPort}`
  }, next);
});