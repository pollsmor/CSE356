let uid = document.getElementById('email').innerText;
let docId = document.getElementById('docid').innerText;
let isFirstMessage = true;
let docVersion;
let retry = false;

// Initialize Quill editor
const quill = new Quill('#editor', {
  modules: { 
    toolbar: [ ['bold', 'italic'], ['image'] ],
    imageUpload: {
      url: '/media/upload',
      // First callback obtains a media ID
      callbackOK: (res, next) => {
        axios.get(`/media/access/${res.mediaid}`)
          .then((res2) => { // Second callback retrives image location
            next(res2.data);
          });
      }
    }
  },
  theme: 'snow',
});

// Connect to server
axios.get(`/doc/connect/${docId}/${uid}`)
  .catch((err) => {
    // Don't want to keep showing an error on refresh.
  });

// POST ops to server
quill.on('text-change', (delta, oldDelta, source) => {
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

// POST presence to server
quill.on('selection-change', (range, oldRange, source) => {
  if (source === 'user') {
    if (range != null) { // Cursor is in the editor
      axios.post(`/doc/presence/${docId}/${uid}`, {
        index: range.index,
        length: range.length
      });
    }
  }
});

const stream = new EventSource(`/doc/connect/${docId}/${uid}`);
stream.addEventListener('message', message => {
  console.log(message);
  message = JSON.parse(message.data);
  if (isFirstMessage) {
    isFirstMessage = false;
    quill.setContents(message.content);
    docVersion = message.version;
  } else {
    if (!message.ack) { // Ignore 'ack' messages
      if ('cursor' in message) { // Receive presence data
        let selection = message.cursor;
        quill.setSelection(selection.index, selection.length);
      } else { // Receive op
        quill.updateContents(message);
        docVersion++;
      }
    }
  }
})

// Don't want stream to persist after refreshing.
addEventListener('beforeunload', () => {
  stream.close();
});