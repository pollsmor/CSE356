const express = require('express');

/*
Port 3000: This proxy server
Port 3001: Contains stateless services (i.e. login)
Port 3002-whatever: Proxies for every core
*/
const app = express();
const coreCount = 2; // Modify this when needed
const proxyPort = 3000;
const statelessPort = 3001;
const proxy = require('http-proxy').createProxyServer({ 
  host: 'http://teamsolokid.cse356.compas.cs.stonybrook.edu',
  port: proxyPort
});


app.listen(proxyPort, () => {
  console.log(`Google Docs Clone is now running on port ${proxyPort}.`);
});

// Routes ===============================================================
// Route just for convenience
app.use('/', function (req, res, next) {
  proxy.web(req, res, {
    target: `http://localhost:${statelessPort}`
  }, next);
});