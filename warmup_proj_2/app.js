const express = require('express');
const pug = require('pug');
const bodyParser = require('body-parser');
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
app.use(session({
    secret: 'i-dont-care',
    resave: true,
    saveUninitialized: true,
}));

mongoose.connect(mongoUri, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
});
const conn = mongoose.connection;
conn.once('open', function () {
    console.log('MongoDB database connection established successfully.');
})

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// Routes ====================================================================
app.get('/ttt/', function (req, res) { // Not used for warmup project 2
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

app.post('/ttt/play', async function (req, res) {
    // Session found
    if (req.session.username) {
        let move = Number(req.body.move); // In case move is a string number
        let user = await User.findOne({ username: req.session.username });
        let grid = user.games[user.games.length - 1];
        // Move = null or invalid
        if (move == null || move < 0 || move > 8 || grid[move] !== ' ') { 
            res.json({ grid: grid, winner: ' ', 'X-CSE356': '61f9f57773ba724f297db6bf' });
        } else { // Move is actually made
            User.update(
                { "_id": user._id },
                { $set: { "games.$[move].value": 'X' }},
                function (err, user) {}
            );

            grid[move] = 'X';
            let winner = getWinner(grid);
            let drew = true;
            if (winner === ' ') { // No winner yet
                for (let i = 0; i < 8; i++)
                    if (grid[i] === ' ') // Free spot found
                        drew = false;

                if (!drew) { // Let bot make move
                    let randIdx = getRandomInt(9);
                    while (grid[randIdx] !== ' ')
                        randIdx = getRandomInt(9);

                    User.update(
                        { "_id": user._id },
                        { $set: { "games.$[randIdx].value": 'O' }},
                        function (err, user) {}
                    );

                    grid[randIdx] = 'O';
                    winner = getWinner(grid);
                } else user.ties++;
            }

            if (winner !== ' ' || drew) { // If game is over, save it
                if (winner === 'X') user.wins++;
                else if (winner === 'O') user.losses++;

                User.update

                user.games.push([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);
            }

            User.update(
                { username:  req.session.username },
                {
                    '$push': { games:  }
                }
            ).then(data => {
                console.log(data);
            });

            res.json({ grid: grid, winner: winner, 'X-CSE356': '61f9f57773ba724f297db6bf' });
        }
    } else {
        res.writeHead(403, header); // Forbidden
        res.end("You must be logged in to play.");
    }
});

app.post('/adduser', async function (req, res) {
    let user = new User({
        username: req.body.username,
        password: req.body.password,
        email: req.body.email,
        verified: false,
        key: 'abracadabra',
        games: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
        wins: 0,
        losses: 0,
        ties: 0
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