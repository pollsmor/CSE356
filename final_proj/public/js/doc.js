let uid = document.getElementById('email').innerText;
let docId = document.getElementById('docid').innerText;
let isFirstMessage = true;
let docVersion;

// Initialize Quill editor
const quill = new Quill('#editor', {
  modules: { toolbar: '#toolbar' },
  theme: 'snow'
});

// Connect to server
axios.get(`/doc/connect/${docId}/${uid}`)
  .catch((err) => {
    
  });

// POST changes to server
quill.on('text-change', (delta, oldDelta, source) => {
  if (source === 'user') {
    let retry = true;
    //while (retry) {
      docVersion++;
      axios.post(`/doc/op/${docId}/${uid}`, {
        version: docVersion,
        op: delta.ops
      }).then((res) => {
        if (res.status === 'ok') retry = false;
      });
    //}
  }
});

const stream = new EventSource(`/doc/connect/${docId}/${uid}`);
stream.addEventListener('message', message => {
  message = JSON.parse(message.data);
  if (isFirstMessage) {
    isFirstMessage = false;
    quill.setContents(message.content);
    docVersion = message.version;
  } else {
    if (!message.ack)
      quill.updateContents(message);
  }
})

addEventListener('beforeunload', () => {
  stream.close();
});