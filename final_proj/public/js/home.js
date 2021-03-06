let docs = document.getElementById('docs');
let uid = document.getElementById('email').innerText;

axios.get('/collection/list')
  .then((res) => {
    for (let doc of res.data) {
      let docId = doc.id;
      let docBox = document.createElement('div');
      docBox.className = 'docBox';
      docBox.id = docId;

      docBox.innerHTML = `
        <a href="/doc/edit/${docId}">
          <p>${doc.name}</p>
        </a>
        <a href="/doc/get/${docId}/${uid}">
          <button type="button">View HTML</button>
        </a>
        <button type="button" onclick="deleteDoc('${docId}')">Delete</button>
        <br><br>
      `;

      docs.append(docBox);
    }
  });

// Need JS to POST data without a form
function deleteDoc(docId) {
  axios.post('/collection/delete', {
    docid: docId
  }).then((res) => {
    document.getElementById(docId).remove();
  });
}