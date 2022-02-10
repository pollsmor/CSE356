const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const pug = require('pug');

const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'pug');
app.set('views', 'views');

app.get('/ttt/', function (req, res) {
    let locals = {
        pageTitle: 'Warmup Project 1',
    }

    res.render('form', locals);
});

app.post('/ttt/', function(req, res) {
    let locals = {
        pageTitle: 'Tic-Tac-Toe!',
        name: req.body.name,
        date: new Date().toISOString().slice(0, 10)
    };

    res.render('tictactoe', locals);
});

app.post('/ttt/play', function (req, res) {
    req.body.winner = getWinner(req.body.grid);
    res.json(req.body);
});

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// =======================================================
function getWinner(board) {
    if (board[0] == board[1] && board[1] == board[2])
        return board[0] == 'X' || board[0] == 'O' ? board[0] : ' '; // First row

    else if (board[3] == board[4] && board[4] == board[5])
        return board[3] == 'X' || board[3] == 'O' ? board[3] : ' '; // Second row

    else if (board[6] == board[7] && board[7] == board[8])
        return board[6] == 'X' || board[6] == 'O' ? board[6] : ' '; // Third row

    else if (board[0] == board[3] && board[3] == board[6])
        return board[0] == 'X' || board[0] == 'O' ? board[0] : ' '; // First col

    else if (board[1] == board[4] && board[4] == board[7])
        return board[1] == 'X' || board[1] == 'O' ? board[1] : ' '; // Second col

    else if (board[2] == board[5] && board[5] == board[8])
        return board[2] == 'X' || board[2] == 'O' ? board[2] : ' '; // Third col

    else if (board[0] == board[4] && board[4] == board[8])
        return board[0] == 'X' || board[0] == 'O' ? board[0] : ' '; // Diagonal to the right

    else if (board[2] == board[4] && board[4] == board[6])
        return board[2] == 'X' || board[2] == 'O' ? board[2] : ' '; // Diagonal to the left

    else return ' ';
}
