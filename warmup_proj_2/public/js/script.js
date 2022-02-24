for (let i = 0; i < 9; i++)
    document.getElementById('cell_' + i).addEventListener('click', function() {
        makeMove(i);
    })

function makeMove(move) {
    $.ajax({
        type: "POST",
        url: "/ttt/play",
        dataType: "json",
        data: { move: move },
        success: function (data) {
            // Bot makes (random) move
            let grid = data.grid;
            for (let i = 0; i < grid.length; i++)
                document.getElementById('cell_' + i).innerText = grid[i];

            document.getElementById("winner").innerText = data.winner;
        },
    });
}