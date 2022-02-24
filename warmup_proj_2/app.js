const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const User = require('./model');

const app = express();
const port = 3000;
const mongoUri = 'mongodb://localhost:27017/tictactoe';
const header = { 'X-CSE356': '61f9f57773ba724f297db6bf' };

app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'i-dont-care',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'strict' },
}));

mongoose.connect(mongoUri, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
});

mongoose.connection.once('open', function () {});
app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// Routes ====================================================================
app.post('/ttt/play', async function (req, res) {
    // Session found
    if (req.session.username) {
        let move = Number(req.body.move); // In case move is a numbered String?
        let user = await User.findOne({ username: req.session.username });
        let grid = user.games[user.games.length - 1];

        // Move is null or invalid
        if (move == null || move < 0 || move > 8 || grid[move] !== ' ') {
            res.json({ 
                grid: grid, 
                winner: ' ', 
                'X-CSE356': '61f9f57773ba724f297db6bf' 
            });
        } else { // Move is actually made
            let gameEnded = false;
            let emptyGrid = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '];

            // User (X) makes move
            grid[move] = 'X';
            let winner = getWinner(grid);
            let update = {}; // Update query for Mongoose
            if (winner === 'X') { // X has won
                gameEnded = true;
                let wins = user.wins;
                user.games.push(emptyGrid);
                update['$set'] = { 
                    wins: wins + 1,
                    games: user.games
                };

                console.log('X has won.');
            } else if (hasTied(grid)) {
                gameEnded = true;
                let ties = user.ties;
                user.games.push(emptyGrid);
                update['$set'] = { 
                    ties: ties + 1,
                    games: user.games
                };
  
                winner = 'Tied';
                console.log('Game tied.');
            }

            if (!gameEnded) { // Bot (O) makes move
                let randIdx = getRandomInt(9);
                while (grid[randIdx] !== ' ')
                    randIdx = getRandomInt(9);

                grid[randIdx] = 'O';
                winner = getWinner(grid);
                if (winner === 'O') { // O has won
                    let losses = user.losses;
                    user.games.push(emptyGrid);
                    update['$set'] = { 
                        losses: losses + 1,
                        games: user.games
                };

                    console.log('O has won.');
                } else if (hasTied(grid)) {
                    let ties = user.ties;
                    user.games.push(emptyGrid);
                    update['$set'] = { 
                        ties: ties + 1,
                        games: user.games
                    };

                    winner = 'Tied';
                    console.log('Game tied.');
                } else {
                    update['$set'] = { games: user.games };
                }
            }

            let query = { '_id': user._id };
            let options = { upsert: true };
            User.updateOne(query, update, options, function(err, user) {
                console.log("Game logged to database.");
            });

            res.json({ 
                grid: grid, 
                winner: winner, 
                'X-CSE356': '61f9f57773ba724f297db6bf' 
            });
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

// Frontend for testing ======================================================
// Requires having manually created account via cURL / Postman
app.get('/login', function (req, res) { 
    res.render('login');
});

app.get('/ttt', async function (req, res) { 
    if (req.session.username) {
        let user = await User.findOne({ username: req.session.username });
        let grid = user.games[user.games.length - 1];
        res.render('tictactoe', {
            grid: grid
        });
    } else {
        res.writeHead(403, header); // Forbidden
        res.end("You must be logged in to play.");
    }
});

// Helper functions ==========================================================
function getWinner(grid) {
    if (grid[0] == grid[1] && grid[1] == grid[2]) // First row
        if (grid[0] != ' ') return grid[0];

    if (grid[3] == grid[4] && grid[4] == grid[5]) // Second row
        if (grid[3] != ' ') return grid[3];

    if (grid[6] == grid[7] && grid[7] == grid[8]) // Third row
        if (grid[6] != ' ') return grid[6];

    if (grid[0] == grid[3] && grid[3] == grid[6]) // First col
        if (grid[0] != ' ') return grid[0];

    if (grid[1] == grid[4] && grid[4] == grid[7]) // Second col
        if (grid[1] != ' ') return grid[1];

    if (grid[2] == grid[5] && grid[5] == grid[8]) // Third col
        if (grid[2] != ' ') return grid[2];

    if (grid[0] == grid[4] && grid[4] == grid[8]) // Diagonal to the right
        if (grid[0] != ' ') return grid[0];

    if (grid[2] == grid[4] && grid[4] == grid[6]) // Diagonal to the left
        if (grid[2] != ' ') return grid[2];

    return ' ';
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

function hasTied(grid) {
    for (let i = 0; i < 9; i++)
        if (grid[i] === ' ') return false;

    return true;
}