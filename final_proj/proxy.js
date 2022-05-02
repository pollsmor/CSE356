require('dotenv').config();
const express = require('express');

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

// Assign new documents to machines equally
const machineAssignedToDocs = {};
let machineIpIdx = 0;

app.listen(proxyPort, () => {
  console.log(`Google Docs Clone is now running on port ${proxyPort}.`);
});

// Proxy requests, distribute load by doc ID
app.use('/doc/*/:docid', function (req, res, next) {
  let docId = req.params.docid;
  if (!(docId in machineAssignedToDocs)) {
    machineAssignedToDocs[docId] = machineIps[machineIpIdx++];
    if (machineIpIdx == machineIps.length) machineIpIdx = 0;
  }

  proxy.web(req, res, {
    target: `http://${machineAssignedToDocs[docId]}${req.originalUrl}`
  }, next);
});