const express = require('express');
const bodyParser = require('body-parser');
const amqp = require('amqplib/callback_api');

const app = express();
const port = 3000;

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(port, () => {
    console.log('Warmup project 1 listening on port ' + port);
});

// Routes ====================================================================
app.post('/listen', function (req, res) {
    amqp.connect('amqp://localhost', function(error0, connection) {
        if (error0) throw error0;
        connection.createChannel(function(error1, channel) {
            if (error1) throw error1;
            let exchange = 'hw3';
            channel.assertExchange(exchange, 'direct', {
                durable: true
            });

            channel.assertQueue('', {
                exclusive: true
            }, function(error2, q) {
                if (error2) throw error2;

                console.log("Waiting for messages in %s. To exit press CTRL+C", q.queue);
                for (let key of req.body.keys)
                    channel.bindQueue(q.queue, exchange, key);

                channel.consume(q.queue, function(msg) {
                    if (msg.content) {
                        console.log("Message read: %s", msg.content.toString());
                        res.json({ msg: msg.content.toString() });
                    }

                    connection.close(); // Delete old channel/queues
                }, {
                    noAck: true
                });
            });
        });
    });
});

app.post('/speak', function (req, res) {
    amqp.connect('amqp://localhost', function(error0, connection) {
        if (error0) throw error0;
        connection.createChannel(function(error1, channel) {
            if (error1) throw error1;
            let exchange = 'hw3';
            let key = req.body.key;
            let msg = req.body.msg;
            channel.assertExchange(exchange, 'direct', {
                durable: true
            });

            channel.publish(exchange, key, Buffer.from(msg));
            console.log("Sent {%s} to %s with key %s", msg, exchange, key);
        });

        setTimeout(function() {
            connection.close();
            res.end("Message sent.");
        }, 500)
    });
});