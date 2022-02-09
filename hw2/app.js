const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/ttt', function (req, res) {
    res.sendFile(path.join(__dirname, 'routes/index.html'));
});

app.post('/', function(req, res) {
    let name = req.body.name;
    let date = new Date().toISOString().slice(0, 10);
    res.send("Hello " + name + ", " + date);
});

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});
