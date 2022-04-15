const Delta = Quill.import('delta');

const uid = Math.random().toString(36).slice(2);
const docId = document.getElementById('docid').innerText;
const queue = [];
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
  if (source === 'user') {
    queue.push(delta);
    axios.post(`/doc/op/${docId}/${uid}`, {
      op: queue[0], 
      version: docVersion
    });
  }
});

// POST presence to server
quill.on('selection-change', (range, oldRange, source) => {
  if (source === 'user') {
    if (range != null) { // Cursor is in the editor
      axios.post(`/doc/presence/${docId}/${uid}`, range);
    }
  }
});

const stream = new EventSource(`/doc/connect/${docId}/${uid}`);
stream.addEventListener('message', message => {
  message = JSON.parse(message.data);

  if ('content' in message) { // Set initial editor contents
    quill.setContents(message.content);
    docVersion = message.version;
  } 
  
  else if ('presence' in message) { // Presence change
    let selection = message.presence.cursor;
    quill.setSelection(selection.index, selection.length);
  } 
  
  else if ('ack' in message) { // Acknowledge this client's change
    docVersion++;
    queue.shift(); // Pop client's acknowledged op

    // Work on the queue
    if (queue.length > 0) {
      axios.post(`/doc/op/${docId}/${uid}`, {
        op: queue[0], 
        version: docVersion
      });
    }
  } 
  
  else { // Received op from server
    docVersion++;
    let incomingDelta = new Delta(message);
    if (queue.length === 0) {
      quill.updateContents(incomingDelta);
    } else {
      // Merge incoming delta with each op in client queue
      queue.map((delta) => {
        let newDelta = incomingDelta.concat(delta);
        console.log(newDelta);
        quill.updateContents(newDelta);
        return newDelta;
      });

      // Work on the queue
      axios.post(`/doc/op/${docId}/${uid}`, {
        op: queue[0], 
        version: docVersion
      });
    }
  }
});

// Don't want stream to persist after refreshing.
addEventListener('beforeunload', () => {
  stream.close();
});