const express = require('express');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/ttt', function (req, res) {
    res.sendFile(path.join(__dirname, 'routes/index.html'));
});

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

