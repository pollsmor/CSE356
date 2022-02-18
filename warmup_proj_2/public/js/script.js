function makeMove(e) {
    let str = e.innerText;
    if (isSpace(str)) { // &nbsp char code
        let turn = document.getElementById("turn");
        if (turn.innerText != "X") return;
        e.innerHTML = "<h1 class=\"symbol\">X</h1>"
        turn.innerText = "O";

        // Send JSON payload
        let board = [" ", " ", " ", " ", " ", " ", " ", " ", " "];
        let grid = document.getElementById("grid").children;
        for (var i = 0; i < 9; i++) {
            if (grid[i].innerText == "X") board[i] = "X";
            else if (grid[i].innerText == "O") board[i] = "O";
            else board[i] = " ";
        }

        $.ajax({
            type: "POST",
            url: "/ttt/play",
            dataType: "json",
            data: {
                grid: board
            },
            success: function (data) {
                // Bot makes (random) move
                for (var i = 0; i < 9; i++) {
                    grid[i].innerHTML = "<h1 class=\"symbol\">" + data.grid[i] + "</h1>";
                }

                document.getElementById("winner").innerText = data.winner;
                turn.innerText = "X";
            },
        });
    }
}

function isSpace(str) {
    return str === null || str.match(/^ *$/) !== null;
}