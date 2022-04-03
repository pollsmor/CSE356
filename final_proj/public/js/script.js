const randString = 'abcdefghijklmnopqrstuvwxyz';
const ops = []; // Array of oplists
let timer = 1;
let isFirstMessage = true;

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
  if (source === 'user') {
    ops.push(delta.ops);
  }
});

// Only send ops every second
setInterval(function() {
  if (timer <= 0 && ops.length > 0) {
    let opsCopy = Array.from(ops);
    ops.length = 0;
    axios.post(`/op/${id}`, opsCopy)
      .then(function () {
      timer = 1;
    });
  }

  timer--; // Decrement timer every second
}, 1000);

const stream = new EventSource(`/connect/${id}`);
stream.addEventListener('message', message => {
  const oplists = JSON.parse(message.data);
  if (isFirstMessage) {
    const oplist = oplists.content;
    isFirstMessage = false;
    quill.setContents(oplist);
  } else {
    for (let oplist of oplists) {
      quill.updateContents(oplist);
    }
  }
})

addEventListener('beforeunload', () => {
  stream.close();
})