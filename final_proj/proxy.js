const express = require('express');
require('dotenv').config();

/*
Port 3000: This proxy server
Port 3001: Contains stateless services (i.e. login)
*/
const app = express();
const machineIps = process.env.WORKER_MACHINES.split(' ');
const proxyPort = 3000;
const statelessPort = 3001;
const proxy = require('http-proxy').createProxyServer({ 
  host: process.env.MAIN_MACHINE,
  port: proxyPort
});
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
};

// Assign new documents to machines equally
const machineAssignedToDocs = {};
let machineIpIdx = 0;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(function(req, res, next) {
  res.setHeader('X-CSE356', '61f9f57773ba724f297db6bf');
  next(); // Set ID header for every route
});

const server = app.listen(proxyPort, () => {
  console.log(`Google Docs Clone is now running on port ${proxyPort}.`);
});
server.keepAliveTimeout = 60 * 1000;
server.headersTimeout = 60 * 1000;

// Proxy requests =========================================================
app.use('/doc/edit/:docid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx]++;
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  proxy.web(req, res, {
    target: `http://localhost:${machineAssignedToDocs[docId]}/doc/edit/${docId}`
  }, next);
});

// Distribute load based on document ID
app.use('/doc/connect/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx]++;
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  res.writeHead(200, streamHeaders);
  let chosenPort = coreAssignedToDocs[docId];
  proxy.web(req, res, {
    target: `http://localhost:${machineAssignedToDocs[docId]}/doc/connect/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/op/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  proxy.web(req, res, {
    target: `http://localhost:${machineAssignedToDocs[docId]}/doc/op/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/get/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  proxy.web(req, res, {
    target: `http://localhost:${machineAssignedToDocs[docId]}/doc/get/${docId}/${req.params.uid}`
  }, next);
});

app.use('/doc/presence/:docid/:uid', function (req, res, next) {
  let docId = req.params.docid;
  proxy.web(req, res, {
    target: `http://localhost:${machineAssignedToDocs[docId]}/doc/presence/${docId}/${req.params.uid}`
  }, next);
});

// Stateless microservices
app.use('/', function (req, res, next) {
  proxy.web(req, res, {
    target: `http://localhost:${statelessPort}`
  }, next);
});