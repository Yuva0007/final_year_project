const express = require("express");

const { spawn } = require('child_process');
const crypto = require('crypto');
const { Console } = require("console");
const app = express();
const path = require('path');
let ejs = require('ejs');
var bodyParser = require('body-parser');
const fs = require("fs");
app.use(express.urlencoded());
app.use(express.json());
app.set('view engine', 'ejs');

const port = process.env.PORT || 3000
const usersFile = path.join(__dirname, 'data', 'users.json');
const sessions = new Map();
let inputLine = ""
let done = false
let dataString = ""
let requiredData = ""
var python = null

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(usersFile), { recursive: true });
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, storedPassword) {
  const [salt, storedHash] = storedPassword.split(':');
  if (!salt || !storedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function parseCookies(request) {
  return (request.headers.cookie || '').split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator === -1) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getCurrentUser(request) {
  const sessionId = parseCookies(request).voiceIslSession;
  const email = sessionId ? sessions.get(sessionId) : null;
  if (!email) return null;
  return readUsers().find((user) => user.email === email) || null;
}

function setSessionCookie(response, email) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, email);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `voiceIslSession=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax${secure}`);
}

function clearSessionCookie(request, response) {
  const sessionId = parseCookies(request).voiceIslSession;
  if (sessionId) sessions.delete(sessionId);
  response.setHeader('Set-Cookie', 'voiceIslSession=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function requireAuth(request, response, next) {
  const user = getCurrentUser(request);
  if (!user) {
    if (request.accepts('html')) return response.redirect('/login');
    return response.status(401).json({ error: 'Authentication required.' });
  }
  request.user = user;
  next();
}

app.post('/api/signup', function (req, res) {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !email || password.length < 6) {
    return res.status(400).json({ error: 'Username, email, and a password of at least 6 characters are required.' });
  }

  const users = readUsers();
  if (users.some((user) => user.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  users.push({ username, email, password: hashPassword(password) });
  writeUsers(users);
  setSessionCookie(res, email);
  res.status(201).json({ username, email });
});

app.post('/api/login', function (req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = readUsers().find((candidate) => candidate.email === email);
  if (!user || !passwordMatches(password, user.password)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  setSessionCookie(res, email);
  res.json({ username: user.username, email: user.email });
});

app.post('/api/logout', function (req, res) {
  clearSessionCookie(req, res);
  res.status(204).end();
});

app.get('/api/me', function (req, res) {
  const user = getCurrentUser(req);
  if (!user) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: user.username, email: user.email });
});

app.post('/api/change-password', requireAuth, function (req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const newPassword = String(req.body.password || '');
  if (email && email !== req.user.email) {
    return res.status(400).json({ error: 'Email does not match the signed-in account.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const users = readUsers();
  const user = users.find((candidate) => candidate.email === req.user.email);
  user.password = hashPassword(newPassword);
  writeUsers(users);
  res.status(204).end();
});

app.post('/api/profile', requireAuth, function (req, res) {
  const username = String(req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Display name is required.' });
  const users = readUsers();
  const user = users.find((candidate) => candidate.email === req.user.email);
  user.username = username;
  writeUsers(users);
  res.json({ username, email: user.email });
});

//static images file
app.use(express.static('public'));
app.use('/img', express.static('images'));

// Speech generation page
app.get('/speech', requireAuth, function (req, res) {
  res.sendFile(path.join(__dirname + '/s2t.html'));
});

// Home page landing page
app.get("/", function (req, res) {
  inputLine = ""
  done = false
  dataString = ""
  requiredData = ""
  if (python != null)
    python.kill('SIGINT');
  res.sendFile(path.join(__dirname + "/index.html"));
});

// Signup page
app.get("/signup", function (req, res) {
  res.sendFile(path.join(__dirname + "/signup.html"));
});

// Login page
app.get("/login", function (req, res) {
  res.sendFile(path.join(__dirname + "/login.html"));
});

// Change password page
app.get("/change-password", requireAuth, function (req, res) {
  res.sendFile(path.join(__dirname + "/change-password.html"));
});

// Auth landing route for generation page
app.get("/generate", function (req, res) {
  res.sendFile(path.join(__dirname + "/generate.html"));
});

// User profile page
app.get("/profile", requireAuth, function (req, res) {
  res.sendFile(path.join(__dirname + "/profile.html"));
});

//Final speach file done.html
app.post("/speach", requireAuth, function (req, res) {
  inputLine = req.body.textbox;
  dataString = "";
  requiredData = "";
  done = false;
  let requestAborted = false;

  req.on('aborted', function () {
    requestAborted = true;
    if (python != null) {
      python.kill('SIGINT');
      python = null;
    }
  });

  if (python != null) {
    python.kill('SIGINT');
    python = null;
  }

  isItDoneYet().then((msg) => {
    if (requestAborted) return;
    console.log(msg);
    console.log(inputLine);
    console.log("data->\n" + dataString);
    const startIndex = dataString.indexOf("ISL:{");
    const endIndex = dataString.indexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      requiredData = dataString.substring(startIndex + 5, endIndex);
    } else {
      requiredData = dataString.trim();
    }
    done = true;
    res.render('result', { done: done, islSyntax: requiredData, normalSyntax: inputLine });
  }).catch((msg) => {
    if (requestAborted) return;
    console.log(msg);
    res.status(500).send('Video generation failed. Please try again.');
  });
});
//done request video 
app.get("/video", requireAuth, function (req, res) {
  
  //res.sendFile('/data/samples/output/clipg.mp4', { root: __dirname });  
  const range = req.headers.range;
  if (!range) {
    return res.status(400).send("Requires Range header");
  }

  // get video stats (about 61MB)
  const videoPath = path.resolve(__dirname + "/data/samples/output/clipg.mp4");
  const videoSize = fs.statSync(videoPath).size;

  // Parse Range
  // Example: "bytes=32324-"
  const CHUNK_SIZE = 10 ** 6; // 1MB
  const start = Number(range.replace(/\D/g, ""));
  const end = Math.min(start + CHUNK_SIZE, videoSize - 1);

  // Create headers
  const contentLength = end - start + 1;
  const headers = {
    "Content-Range": `bytes ${start}-${end}/${videoSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": contentLength,
    "Content-Type": "video/mp4",
  };

  // create video read stream for this particular chunk
  var videoStream = fs.createReadStream(videoPath, { start, end });

  // HTTP Status 206 for Partial Content
  res.writeHead(206, headers);


  // Stream the video chunk to the client
  videoStream.pipe(res);
})

//this the python promise 
const isItDoneYet = () => new Promise((resolve, reject) => {
  const pythonCommand = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  python = spawn(pythonCommand, ['speech_recog.py', inputLine])
  let c = false
  python.on('error', (error) => {
    reject(new Error(`Unable to start Python (${pythonCommand}): ${error.message}`));
  });
  python.stdout.on('data', function (data) {
    dataString += data.toString();
  })
  python.stderr.on('data', function (data) {
    console.error('PY STDERR:', data.toString());
    dataString += data.toString();
  })
  python.on('exit', (code) => {
    console.log(`child process close all stdio with code ${code}`);
    if (code == 0)
      c = true;
    if (c) {
      const workDone = 'Here is the thing I built'
      resolve(workDone)
    } else {
      const why = 'Sorry I failed to built it'
      reject(why)
    }
  });

})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
