const randString = 'abcdefghijklmnopqrstuvwxyz';

function getRandomId() {
  let randLetter = randString.charAt(Math.floor(Math.random() * 26));
  let randLetter2 = randString.charAt(Math.floor(Math.random() * 26));
  return randLetter + Date.now() + randLetter2;
}

// Initialize Quill editor
const editor = new Quill('#editor', {
  modules: { toolbar: '#toolbar' },
  theme: 'snow'
});

axios.get(`/connect/${getRandomId()}`)
  .then(function (res) {
    console.log(res.data);
  });