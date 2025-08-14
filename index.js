// server.mjs
import express from 'express';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Buffer } from 'buffer';
import getRawBody from 'raw-body'; // npm i raw-body
// note: Node 18+ punya fetch global; jika pakai Node <18, install node-fetch and import it.

const app = express();

// ===== basic middlewares =====
app.use(compression({
  level: 5,
  threshold: 0,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url} - incoming`);
  next();
});

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, headers: true }));

// ===== capture raw body first, then parse lightly =====
app.use(async (req, res, next) => {
  try {
    // capture raw body (works for any content-type)
    req.rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      limit: '10mb'
    });
  } catch (err) {
    // kalau error (mis. no body) -> kosongkan
    req.rawBody = Buffer.alloc(0);
  }

  // basic parsing so req.body ada (JSON / urlencoded / fallback string)
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      req.body = JSON.parse(req.rawBody.toString('utf8') || '{}');
    } catch (e) {
      req.body = {};
    }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const str = req.rawBody.toString('utf8');
    const params = new URLSearchParams(str);
    req.body = Object.fromEntries(params.entries());
  } else if (req.rawBody.length > 0) {
    // fallback: keep as string
    req.body = req.rawBody.toString('utf8');
  } else {
    req.body = {};
  }

  next();
});

// ===== helper: safe log =====
function shortBodyLog(buf) {
  try {
    const s = buf.toString('utf8');
    if (s.length > 1000) return s.slice(0, 1000) + '... (truncated)';
    return s;
  } catch {
    return buf.toString('hex').slice(0, 200) + '...';
  }
}

function filterForwardHeaders(inHeaders) {
  // copy headers but remove hop-by-hop headers and host (we set host to target)
  const hopByHop = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
  ]);
  const out = {};
  for (const [k, v] of Object.entries(inHeaders)) {
    if (hopByHop.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

// ===== proxy handler for specific paths =====
const PROXY_TARGET_HOST = 'login.growtopia.com';
const PROXY_TARGET_BASE = `https://${PROXY_TARGET_HOST}`;

async function proxyAndLog(req, res) {
  try {
    console.log('--- INCOMING REQUEST ---');
    console.log('Method:', req.method);
    console.log('Path  :', req.originalUrl);
    console.log('Headers:', req.headers);
    console.log('Body (parsed):', req.body);
    console.log('Body (raw preview):', shortBodyLog(req.rawBody));

    // build headers to forward
    const forwardHeaders = filterForwardHeaders(req.headers);
    forwardHeaders['host'] = PROXY_TARGET_HOST;
    // if we have a body, ensure content-length is correct
    if (req.rawBody && req.rawBody.length) {
      forwardHeaders['content-length'] = String(req.rawBody.length);
    } else {
      delete forwardHeaders['content-length'];
    }

    const targetUrl = PROXY_TARGET_BASE + req.originalUrl;

    // fetch (forward)
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'manual'
    };

    if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
      fetchOptions.body = req.rawBody.length ? req.rawBody : undefined;
    }

    const response = await fetch(targetUrl, fetchOptions);

    // read response body as buffer
    const respArrayBuffer = await response.arrayBuffer();
    const respBuf = Buffer.from(respArrayBuffer);

    // log response
    console.log('--- REMOTE RESPONSE ---');
    console.log('Status:', response.status);
    // normalize headers into object
    const respHeaders = {};
    for (const [k, v] of response.headers.entries()) respHeaders[k] = v;
    console.log('Headers:', respHeaders);
    console.log('Body (preview):', shortBodyLog(respBuf));

    // forward status + headers (but remove hop-by-hop)
    res.status(response.status);
    for (const [k, v] of Object.entries(respHeaders)) {
      const lk = k.toLowerCase();
      if (['transfer-encoding', 'connection'].includes(lk)) continue;
      // do not overwrite content-length if using express send with buffer (but it's fine to set)
      res.setHeader(k, v);
    }

    // send raw buffer back to client
    res.send(respBuf);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).send('Bad Gateway');
  }
}

// mount proxy for the paths you specified
app.all('/player/login/dashboard', proxyAndLog);
app.all('/player/growid/login/validate', proxyAndLog);
app.all('/player/growid/checkToken', proxyAndLog);

// you can also support lowercase/other-casing variants if needed:
app.all('/player/growid/checktoken', proxyAndLog); // optional

// ===== fallback endpoints (kept simple) =====
app.get('/', (req, res) => res.send('Hello World!'));

// start
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
