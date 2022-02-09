const express = require('express');
const app = express();
const port = 3000;

app.get('/ttt', function (req, res) {
    res.send('GET request to this page');
});

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

