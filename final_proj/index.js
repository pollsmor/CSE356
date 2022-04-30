require('dotenv').config()
const mongoUri = 'mongodb://localhost:27017/final';
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html');
const { Client } = require('@elastic/elasticsearch');
const { convert } = require('html-to-text');

// Mongoose models
const DocInfo = require('./models/docinfo');

// Session handling
const store = new MongoDBStore({ uri: mongoUri, collection: 'sessions' });
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });

// Setup ShareDB
const app = express();
ShareDB.types.register(require('rich-text').type); // Quill uses Rich Text
const backend = new ShareDB({db});
const connection = backend.connect();

// ElasticSearch stuff
const esClient = new Client({ 
  cloud: { id: process.env.CLOUD_ID },
  auth: {
    username: 'elastic',
    password: process.env.ELASTIC_PWD
  }
});
// Create index if not exists
esClient.indices.create({
  index: 'docs',
  body: { 
    mappings: {
      properties: {
        contents: {
          type: 'text',
        },
        suggest: {
          type: 'completion',
        }
      }
    }
  }
}).catch(err => {
  console.log('Index already exists.');
});
const searchCache = new Map();
const suggestCache = new Map();

// Middleware
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: 'secret',
  store: store,
  resave: false,
  saveUninitialized: false,
}));

const server = app.listen(3002, () => {
  console.log('Index service running on port 3002.');
});
server.keepAliveTimeout = 60 * 1000;
server.headersTimeout = 60 * 1000;


// Milestone 3: Search/Suggest
app.get('/index/search', async function (req, res) {
  if (req.session.name) {
    let phrase = req.query.q;
    if (phrase == null) 
      return res.json({ error: true, message: '[SEARCH] Empty query string.' });

    // Reuse cached results
    if (searchCache.has(phrase))
      return res.json(searchCache.get(phrase));

    let results = await esClient.search({
      index: 'docs',
      query: {
        multi_match: { 
          query: phrase,
          type: 'phrase_prefix',
          fields: ['contents', 'docName']
        }
      },
      fields: ['docName', 'contents'],
      _source: false,
      highlight: {
        fields: { 
          contents: {},
        },
        fragment_size: 400,
        order: 'score',
        max_analyzed_offset: 999999       
      },
      size: 10
    });

    results = results.hits.hits;
    let output = await Promise.all(results.map(async (r) => {
      let docId = r._id;
      let docinfo = await DocInfo.findOne({ docId: docId });
      let snippet = 'highlight' in r ? r.highlight.contents[0] : '';

      return {
        docid: docId,
        name: docinfo.name,
        snippet: snippet
      };
    }));

    searchCache.set(phrase, output);
    res.json(output);
  } else res.json({ error: true, message: '[SEARCH] Session not found.' });
});

app.get('/index/suggest', async function (req, res) {
  if (req.session.name) {
    let phrase = req.query.q;
    if (phrase == null) 
      return res.json({ error: true, message: '[SEARCH] Empty query string.' });

    // Reuse cached results
    if (suggestCache.has(phrase))
      return res.json(suggestCache.get(phrase));

    let results = await esClient.search({
      _source: false,
      suggest: {
        suggestion: {
          prefix: phrase,
          completion: {
            field: 'suggest',
            skip_duplicates: true
          }
        }
      },
      _source: false
    });

    results = results.suggest.suggestion[0].options;

    let output = results.map((r) => {
      return r.text;
    });

    suggestCache.set(phrase, output);
    res.json(output);
  } else res.json({ error: true, message: '[SUGGEST] Session not found.' });
});

app.post('/index/refresh', async function (req, res) {
  let docIds = req.body.docIds;
  let docinfos = await DocInfo.find({ docId: { $in: docIds }}).lean();
  for (let i = 0; i < docIds.length; i++) {
    let doc = connection.get('docs', docIds[i]);
    doc.fetch(async (err) => {
      if (err) throw err;
      else if (doc.type == null) return; // Not necessarily an error

      let converter = new QuillDeltaToHtmlConverter(doc.data.ops, {});
      let html = convert(converter.convert()); // Convert converted HTML to text
      let words = html.split(/\s+/); // Delimit by "spacey" characters
      await esClient.index({
        index: 'docs',
        id: docIds[i],
        body: {
          docName: docinfos[i].name,
          contents: html,
          suggest: words
        }
      });
    });
  }

  res.json({ status: 'success '});
});