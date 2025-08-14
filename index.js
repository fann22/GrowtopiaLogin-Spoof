const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const rateLimiter = require('express-rate-limit');
const compression = require('compression');
const getRawBody = require('raw-body');

app.use(compression({
    level: 5,
    threshold: 0,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept',
    );
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url} - ${res.statusCode}`);
    next();
});
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(rateLimiter({ windowMs: 15 * 60 * 1000, max: 100, headers: true }));

app.use(async (req, res) => {
  try {
    // Ambil body mentah
    const bodyBuffer = await getRawBody(req);
    const bodyString = bodyBuffer.toString();

    console.log(`\n===== REQUEST =====`);
    console.log(`[${req.method}] ${req.originalUrl}`);
    console.log('Headers:', req.headers);
    console.log('Body:', bodyString);

    // Forward ke server asli
    const targetUrl = `https://login.growtopiagame.com${req.originalUrl}`;
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'login.growtopia.com', // paksa host asli
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuffer
    });

    const respBuffer = await response.arrayBuffer();
    const respString = Buffer.from(respBuffer).toString();

    console.log(`\n===== RESPONSE =====`);
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    console.log('Body:', respString);

    // Kirim balik ke client
    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }
    res.send(Buffer.from(respBuffer));

  } catch (err) {
    console.error('Error in MITM handler:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/', function (req, res) {
    res.send('Hello World!');
});

app.listen(5000, function () {
    console.log('Listening on port 5000');
});
