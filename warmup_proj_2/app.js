const express = require('express');
const bodyParser = require('body-parser');
const pug = require('pug');
const mongoose = require('mongoose');

const app = express();
const port = 3000;
const mongoUri = 'mongodb://localhost:27017/users';

app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'pug');
app.set('views', 'views');

mongoose.connect(mongoUri, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
});

mongoose.connection.once('open', function () {
    console.log('MongoDB database connection established successfully.');
})

app.get('/ttt/', function (req, res) {
    let locals = {
        pageTitle: 'Warmup Project 1',
    }

    res.render('form', locals);
});

app.post('/ttt/', function (req, res) {
    let locals = {
        pageTitle: 'Tic-Tac-Toe!',
        name: req.body.name,
        date: new Date().toISOString().slice(0, 10)
    };

    res.render('tictactoe', locals);
});

app.post('/ttt/play', function (req, res) {
    let grid = req.body.grid;
    req.body.winner = getWinner(grid); 

    // Make move
    let randIdx = getRandomInt(9);
    for (let i = 0; i < 8; i++) {
        if (grid[i] == ' ') { // Free spot found
            while (grid[randIdx] != ' ')
                randIdx = getRandomInt(9);

            grid[randIdx] = 'O';
            req.body.grid = grid;
            break;
        }
    }

    if (req.body.winner === ' ')
        req.body.winner = getWinner(grid);

    res.json(req.body);
});

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// User creation system ======================================================
app.post('/adduser', function (req, res) {

});

// Helper functions ==========================================================
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

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}