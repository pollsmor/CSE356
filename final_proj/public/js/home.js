let docs = document.getElementById('docs');

axios.get('/collection/list')
  .then((res) => {
    for (let doc of res.data) {
      let docId = doc._id;
      let docBox = document.createElement('div');
      docBox.className = 'docBox';
      docBox.id = docId;

      let date = new Date(doc._m.mtime);
      docBox.innerHTML = `
        <a href="/doc/edit/${docId}">
          <p>${docId}</p>
        </a>
        <button type="button" onclick="deleteDoc('${docId}')">Delete</button>
        <p>Last modified ${date}</p>
      `;

      docs.append(docBox);
    }
  });

function deleteDoc(docId) {
  axios.post('/collection/delete', {
    docid: docId
  }).then((res) => {
    document.getElementById(docId).remove();
  });
}