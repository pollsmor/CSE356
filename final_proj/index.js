require('dotenv').config()
const mongoUri = process.env.MONGO_URI;
const express = require('express');
const mongoose = require('mongoose');
const ShareDB = require('sharedb');
const db = require('sharedb-mongo')(mongoUri);
const { QuillDeltaToHtmlConverter } = require('quill-delta-to-html');
const { Client } = require('@elastic/elasticsearch');
const { convert } = require('html-to-text');

// Connect to Mongoose + models
mongoose.connect(mongoUri, { useUnifiedTopology: true, useNewUrlParser: true });
const DocInfo = require('./models/docinfo');

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
    settings: {
      refresh_interval: '10s',
      analysis: {
        analyzer: {
          my_analyzer: {
            type: 'custom',
            tokenizer: 'whitespace',
            filter: ['stop']
          }
        },
      },
    },
    mappings: {
      properties: {
        contents: {
          type: 'text',
          term_vector: 'with_positions_offsets',
          analyzer: 'my_analyzer'
        },
        suggest: {
          type: 'completion',
          analyzer: 'standard'
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
app.use(express.json());
const server = app.listen(3002, () => {
  console.log('Index service running on port 3002.');
});

// Milestone 3: Search/Suggest
app.get('/index/search', async function (req, res) {
  let phrase = req.query.q;
  if (phrase == null) 
    return res.json({ error: true, message: '[SEARCH] Empty query string.' });
  else if (searchCache.has(phrase)) // Reuse cached results
    return res.json(searchCache.get(phrase));

  let results = await esClient.search({
    index: 'docs',
    query: {
      match_phrase_prefix: {
        contents: {
          query: phrase
        }
      }
    },
    fields: ['docName', 'contents'],
    _source: false,
    highlight: {
      fields: { 
        contents: {},
      },
      order: 'score',
      type: 'fvh'   
    },
    size: 10
  });

  results = results.hits.hits;
  let docIds = results.map(r => r._id);

  let docinfos = await DocInfo.find({ docId: { $in: docIds }}).lean();
  let output = [];
  for (let i = 0; i < docIds.length; i++) {
    let result = results[i];
    let snippet = 'highlight' in result ? result.highlight.contents[0] : '';

    output.push({
      docid: result._id,
      name: docinfos[i].name,
      snippet: snippet
    });
  }

  searchCache.set(phrase, output);
  res.json(output);
});

app.get('/index/suggest', async function (req, res) {
  let phrase = req.query.q;
  if (phrase == null) 
    return res.json({ error: true, message: '[SUGGEST] Empty query string.' });
  else if (suggestCache.has(phrase)) // Reuse cached results
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

  results = results.suggest.suggestion[0].options; // Parse returned JSON
  let output = results.map(r => r.text);
  suggestCache.set(phrase, output);
  res.json(output);
});

app.post('/index/refresh', function (req, res) {
  // Fetch all relevant docs at once rather than one by one and using doc.fetch()
  connection.createFetchQuery('docs', {
    _id: { $in: req.body.docIds }
  }, {}, async (err, results) => {
    if (err) throw err;

    let relevantDocIDs = [];
    let relevantDocData = [];
    for (let result of results) {
      relevantDocIDs.push(result.id);
      relevantDocData.push(result.data.ops);
    }

    let docinfos = await DocInfo.find({ docId: { $in: relevantDocIDs }}).lean();
    for (let i = 0; i < relevantDocIDs.length; i++) {
      let converter = new QuillDeltaToHtmlConverter(relevantDocData[i], {});
      let html = convert(converter.convert()); // Convert converted HTML to text
      await esClient.index({
        index: 'docs',
        id: relevantDocIDs[i],
        body: {
          docName: docinfos[i].name,
          contents: html,
          suggest: html.split(/\s+/) // Delimit by "spacey" characters
        }
      });
    }

    res.json({ status: 'success '});
  });
});