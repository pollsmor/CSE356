const randString = 'abcdefghijklmnopqrstuvwxyz';
const ops = []; // Array of oplists
let opsChanged = false; // If true and timer <= 0, POST changes
let timer = 3;

// Initialize Quill editor
const quill = new Quill('#editor', {
  modules: { toolbar: '#toolbar' },
  theme: 'snow'
});

function getRandomId() {
  let randLetter = randString.charAt(Math.floor(Math.random() * 26));
  let randLetter2 = randString.charAt(Math.floor(Math.random() * 26));
  return randLetter + Date.now() + randLetter2;
}

// Open connection to server
const id = getRandomId();
axios.get(`/connect/${id}`)
  .catch(function (err) {});

// Queue up changes to ops array
quill.on('text-change', function(delta, oldDelta, source) {
  ops.push(delta.ops);
  opsChanged = true;
});

// Only send ops every 3 seconds
setInterval(function() {
  if (timer <= 0 && opsChanged) {
    axios.post(`/op/${id}`, {
      'content': ops
    });

    ops.length = 0;
    opsChanged = false;
    timer = 3;
  }

  timer--; // Decrement timer every second
}, 1000);

const stream = new EventSource(`/connect/${id}`);
stream.addEventListener('message', message => {
  const oplist = JSON.parse(message.data);
  console.log(oplist);
})

addEventListener('beforeunload', () => {
  stream.close();
})