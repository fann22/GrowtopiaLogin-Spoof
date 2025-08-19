// multi-server.js (ESM)
import express from "express";
import bodyParser from "body-parser";
import compression from 'compression';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Express app
const app = express();

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
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(express.json());

async function forward(req, res, targetUrl) {
  try {
    const url = targetUrl + req.url; // jaga query string ikut
    const response = await fetch(url, {
      method: req.method,
      headers: { ...req.headers, host: new URL(targetUrl).host },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body)
    });

    // copy headers dari response asli
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));

    // kirim body response asli
    const buf = await response.buffer();
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy error");
  }
}

function log(type, ...args) {
    const color = {
        INFO: '\x1b[33m',
        EXCEPTION: '\x1b[31m'
    } [type] || '\x1b[0m';
    console.log(color, `[${type}]`, '\x1b[0m', ...args);
}

app.all('/player/growid/login/validate', (req, res) => {
    console.dir(req)
    forward(req, res, "https://login.growtopiagame.com")
})

app.all('/player/login/dashboard', (req, res) => {
    console.dir(req)
    forward(req, res, "https://login.growtopiagame.com")
})

app.post("/player/growid/checkToken", async (req, res) => {
    const valKey = req.query.valKey;
    const refreshToken = req.body.refreshToken;
    const clientData = req.body.clientData;

    const url = `https://login.growtopiagame.com/player/growid/checktoken?valKey=${valKey}`;

    const headers = {
        "host": "login.growtopiagame.com",
        "user-agent": "UbiServices_SDK_2022.Release.9_ANDROID64_static",
        "accept": "*/*",
        "content-type": "application/x-www-form-urlencoded"
    };

    // Version soofer yes ah ah crot
    let newClient = clientData.replace("game_version|5.25", "game_version|5.26");

    const body = new URLSearchParams({
        refreshToken,
        clientData: newClient
    });

    const response = await fetch(url, {
        method: "POST",
        headers,
        body
    });

    const data = await response.json()
    res.send(data);
});

app.get('/', function (req, res) {
    res.send('Hello World!');
});

const PORT = 5000;
app.listen(PORT, "127.0.0.1", () => {
    console.log(`Mock HTTPS server running on port ${PORT}`);
});