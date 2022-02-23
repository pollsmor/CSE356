const express = require('express');

const app = express();
const port = 3000;

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// Routes ====================================================================
app.post('/listen', function (req, res) {
    
});

app.post('/speak', function (req, res) {
    
});