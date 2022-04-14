const Delta = Quill.import('delta');

const uid = document.getElementById('email').innerText;
const docId = document.getElementById('docid').innerText;
const deltaQueue = [];
let isFirstMessage = true;
let docVersion;

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

quill.on('text-change', (delta, oldDelta, source) => {
  if (source === 'user')
    deltaQueue.push(delta);
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
        // Merge client delta with incoming delta
        docVersion++;
        if (deltaQueue.length == 0) { // Merely update client side
          quill.updateContents(message); 
        } else { // Merge pending client ops w/ incoming one
          let finalDelta = new Delta();
          while (deltaQueue.length > 0)
            finalDelta.concat(deltaQueue.shift());

          finalDelta.concat(new Delta(message)); // Append incoming delta
          quill.updateContents(finalDelta.ops);

          // POST final delta to server
          let retry = true;
          while (retry) {
            retry = false;
            axios.post(`/doc/op/${docId}/${uid}`, {
              version: ++docVersion,
              op: finalDelta.ops
            }).then((res) => {
              if (res.data.status === 'retry')
                retry = true;
            });
          }
        }
      }
    }
  }
})

// Occasionally check delta queue for ops to push
setInterval(function () {
  if (deltaQueue.length > 0) {
    // POST delta to server
    let retry = true;
    while (retry) {
      retry = false;
      axios.post(`/doc/op/${docId}/${uid}`, {
        version: ++docVersion,
        op: deltaQueue.shift().ops
      }).then((res) => {
        if (res.data.status === 'retry')
          retry = true;
      });
    }
  }
}, 5);

// Don't want stream to persist after refreshing.
addEventListener('beforeunload', () => {
  stream.close();
});