const express = require('express');

// Constants
const port = 3003;

const app = express();
app.listen(port, () => {
  console.log(`Proxy running on port ${port}.`);
});

app.get('/', function (req, res) {
  res.end('Port ' + port);
});