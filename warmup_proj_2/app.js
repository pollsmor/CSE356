process.on('SIGINT', function() {
    process.exit(0);
});

const express = require('express');
const bodyParser = require('body-parser');
const pug = require('pug');
const mongoose = require('mongoose');
const session = require('express-session');
const User = require('./model');

const app = express();
const port = 3000;
const mongoUri = 'mongodb://localhost:27017/tictactoe';
const header = { 'X-CSE356': '61f9f57773ba724f297db6bf' };

app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'pug');
app.set('views', 'views');

mongoose.connect(mongoUri, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
});

const conn = mongoose.connection;
conn.once('open', function () {
    console.log('MongoDB database connection established successfully.');
})

app.use(session({
    secret: 'i-dont-care',
    resave: true,
    saveUninitialized: true,
}));

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
app.post('/adduser', async function (req, res) {
    let user = new User({
        username: req.body.username,
        password: req.body.password,
        email: req.body.email,
        verified: false,
        key: 'abracadabra',
        games: []
    });

    const usernameExists = await User.exists({ username: user.username });
    const emailExists = await User.exists({ email: user.email });
    if (usernameExists || emailExists) {
        res.writeHead(409, header); // Conflict
        res.end("Username or email already exists.");
    }
    else {
        user.save(function (err, user) {
            res.writeHead(201, header); // Resource created
            res.end(user.username + " has been created.");
        });
    }
});

app.get('/verify', function (req, res) {
    if (req.query.key === 'abracadabra') {
        User.updateOne(
            { email: req.query.email }, // filter
            { verified: true }, // update
            function (err, user) {
            if (user.matchedCount === 0) {
                res.writeHead(400, header); // Bad request
                res.end("Email not found.");
            } else {
                res.writeHead(202, header); // Accepted
                res.end(req.query.email + " verified!");
            }
        });
    } else {
        res.writeHead(400, header); // Bad request
        res.end("Wrong key for email verification.");
    }
});

app.post('/login', async function (req, res) {
    // Session found
    if (req.session.username) {
        res.writeHead(200, header); // Success
        res.end(req.session.username + " is logged in.");
    } else { // Try to log in with provided credentials
        let user = await User.findOne({ username: req.body.username });
        if (!user || !user.verified || req.body.password !== user.password) {
            res.writeHead(403, header); // Forbidden b/c not verified or wrong credentials
            res.end("Wrong credentials, or user is not verified.");
        } else {
            req.session.username = req.body.username;
            res.writeHead(200, header); // Success
            res.end(req.session.username + " is logged in.");
        }
    }
});

app.post('/logout', function (req, res) {
    if (req.session.username) {
        req.session.destroy();
        res.writeHead(200, header); // Success
        res.end("Logged out.");
    } else {
        res.writeHead(400, header); // Bad request
        res.end("Already logged out.");
    }
})

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