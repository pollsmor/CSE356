let docs = document.getElementById('docs');

axios.get('/collection/list')
  .then((res) => {
    for (let doc of res.data) {
      let docId = doc._id;
      let docBox = document.createElement('div');
      docBox.className = 'docBox';

      let date = new Date(doc._m.mtime);
      docBox.innerHTML = `
        <a href="/doc/edit/${docId}">
          <p>${docId}</p>
        </a>
        <form action="/collection/delete/${docId}" method='post'>
          <button type="submit">Delete</button>
        </form>
        <p>Last modified ${date}</p>
      `;

      docs.append(docBox);
    }
  });