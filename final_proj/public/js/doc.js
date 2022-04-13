let uid = document.getElementById('email').innerText;
let docId = document.getElementById('docid').innerText;
let isFirstMessage = true;
let docVersion;
let retry = false;

// Initialize Quill editor
const quill = new Quill('#editor', {
  modules: { toolbar: '#toolbar' },
  theme: 'snow'
});

// Connect to server
axios.get(`/doc/connect/${docId}/${uid}`)
  .catch((err) => {
    // Don't want to keep showing an error on refresh.
  });

// POST changes to server
quill.on('text-change', async (delta, oldDelta, source) => {
  if (source === 'user') {
    retry = true;
    while (retry) {
      retry = false;
      docVersion++;
      axios.post(`/doc/op/${docId}/${uid}`, {
        version: docVersion,
        op: delta.ops
      }).then((res) => {
        if (res.data.status === 'retry')
          retry = true;
      });
    }
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
    if (!message.ack) {
      quill.updateContents(message);
      docVersion++;
    }
  }
})

// Don't want stream to persist after refreshing.
addEventListener('beforeunload', () => {
  stream.close();
});