function makeMove(e) {
    let str = e.innerText;
    if (str == String.fromCharCode(160)) { // &nbsp char code
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
                document.getElementById("winner").innerText = data.winner;
                turn.innerText = "X";
            },
            error: function () {
                alert("Error.");
            }
        });
    }
}