const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const User = require('./model');

const app = express();
const port = 3000;
const mongoUri = 'mongodb://localhost:27017/tictactoe';
const id = '61f9f57773ba724f297db6bf';

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
    console.log('Warmup project 2 listening on port ' + port);
});

// Routes ====================================================================
app.post('/ttt/play', async function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        let move = req.body.move;
        let user = await User.findOne({ username: req.session.username });

        let emptyGame = {
            id: 'g' + user.games.length,
            grid: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
            start_date: new Date().toISOString().slice(0, 10)
        };

        if (user.games.length === 0) user.games.push(emptyGame);
        let grid = user.games[user.games.length - 1].grid;

        // Move is null or invalid
        if (move === 'null' || move < 0 || move > 8 || grid[move] !== ' ') {
            return res.json({ 
                status: 'OK',
                grid: grid, 
                winner: ' ', 
            });
        } else { // Move is actually made
            let gameEnded = false;

            // User (X) makes move
            grid[move] = 'X';
            let winner = getWinner(grid);
            let update = {}; // Update query for Mongoose
            if (winner === 'X') { // X has won
                gameEnded = true;
                user.games.push(emptyGame);
                let wins = user.wins;
                update['$set'] = { 
                    wins: wins + 1,
                    games: user.games
                };

                console.log('X has won.');
            } else if (hasTied(grid)) {
                gameEnded = true;
                user.games.push(emptyGame);
                let ties = user.ties;
                update['$set'] = { 
                    ties: ties + 1,
                    games: user.games
                };
  
                winner = ' ';
                console.log('Game tied.');
            }

            if (!gameEnded) { // Bot (O) makes move
                let randIdx = getRandomInt(9);
                while (grid[randIdx] !== ' ')
                    randIdx = getRandomInt(9);

                grid[randIdx] = 'O';
                winner = getWinner(grid);
                if (winner === 'O') { // O has won
                    user.games.push(emptyGame);
                    let losses = user.losses;
                    update['$set'] = { 
                        losses: losses + 1,
                        games: user.games
                };

                    console.log('O has won.');
                } else if (hasTied(grid)) {
                    user.games.push(emptyGame);
                    let ties = user.ties;
                    update['$set'] = { 
                        ties: ties + 1,
                        games: user.games
                    };

                    winner = ' ';
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

            return res.json({ 
                status: 'OK',
                grid: grid, 
                winner: winner, 
            });
        }   
    } else {
        return res.json({
            status: 'ERROR',
            grid: [],
            winner: ' ',
        });
    }
});

app.post('/listgames', async function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        let user = await User.findOne({ username: req.session.username });
        return res.json({ 
            status: 'OK',
            games: user.games, 
            
        });
    } else {
        return res.json({
            status: 'ERROR',
            games: [],
        });
    }
});

app.post('/getgame', async function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        let user = await User.findOne({ username: req.session.username });
        let grid = null;
        let winner = ' ';
        let status = 'ERROR';

        for (let game of user.games) {
            if (game.id === req.body.id) {
                grid = game.grid;
                winner = getWinner(grid);
                status = 'OK';
                break;
            }
        }

        return res.json({ 
            status: status,
            grid: grid, 
            winner: winner, 
        });
    } else {
        return res.json({
            status: 'ERROR',
            grid: [],
            winner: ' ',
        });
    }
});

app.post('/getscore', async function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        let user = await User.findOne({ username: req.session.username });
        return res.json({ 
            status: 'OK',
            human: user.wins, 
            wopr: user.losses, 
            tie: user.ties,
        });
    } else {
        return res.json({
            status: 'ERROR',
            human: 0,
            wopr: 0,
            tie: 0,
        });
    }
});

app.post('/adduser', async function (req, res) {
    res.setHeader('X-CSE356', id);
    let user = new User({
        username: req.body.username,
        password: req.body.password,
        email: req.body.email,
        verified: false,
        key: 'abracadabra',
        games: [],
        wins: 0,
        losses: 0,
        ties: 0
    });

    const usernameExists = await User.exists({ username: user.username });
    const emailExists = await User.exists({ email: user.email });
    if (usernameExists || emailExists) {
        return res.json({
            status: 'ERROR',
        });
    }
    else {
        user.save(function (err, user) {
            return res.json({
                status: 'OK',
            });
        });
    }
});

app.post('/verify', function (req, res) {
    res.setHeader('X-CSE356', id);
    if (req.body.key === 'abracadabra') {
        User.updateOne(
            { email: req.body.email }, // filter
            { verified: true }, // update
            function (err, user) {
            if (user.matchedCount === 0) {
                return res.json({
                    status: 'ERROR',
                });
            } else {
                return res.json({
                    status: 'OK',
                });
            }
        });
    } else {
        return res.json({
            status: 'ERROR',
        });
    }
});

app.get('/verify', function (req, res) {
    res.setHeader('X-CSE356', id);
    if (req.query.key === 'abracadabra') {
        User.updateOne(
            { email: req.query.email }, // filter
            { verified: true }, // update
            function (err, user) {
            if (user.matchedCount === 0) {
                return res.json({
                    status: 'ERROR',
                });
            } else {
                return res.json({
                    status: 'OK',
                });
            }
        });
    } else {
        return res.json({
            status: 'ERROR',
        });
    }
});

app.post('/login', async function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        return res.json({
            status: 'OK',
        });
    } else { // Try to log in with provided credentials
        let user = await User.findOne({ username: req.body.username });
        if (!user || !user.verified || req.body.password !== user.password) {
            return res.json({
                status: 'ERROR',
            });
        } else {
            req.session.username = req.body.username;
            return res.json({
                status: 'OK',
            });
        }
    }
});

app.post('/logout', function (req, res) {
    res.setHeader('X-CSE356', id);

    // Session found
    if (req.session.username) {
        req.session.destroy();
        return res.json({
            status: 'OK',
        });
    } else {
        return res.json({
            status: 'ERROR',
        });
    }
})

// Frontend for testing ======================================================
// Requires having manually created account via cURL / Postman
app.get('/login', function (req, res) { 
    res.render('login');
});

app.get('/ttt', async function (req, res) { 
    // Session found
    if (req.session.username) {
        let user = await User.findOne({ username: req.session.username });
        let grid = user.games[user.games.length - 1].grid;
        res.render('tictactoe', {
            grid: grid
        });
    } else {
        return res.json({
            status: 'ERROR',
        });
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

function gridFilled(grid) {
    for (let i = 0; i < 9; i++)
        if (grid[i] === ' ') return false;

    return true;
}