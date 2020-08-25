const { v4: uuid } = require('uuid');
const { EventEmitter } = require('events');
const { Strategy: LocalStrategy } = require('passport-local');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const socket = require('socket.io');
const ejs = require('ejs');
const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const passport = require('passport');
const bodyParser = require('body-parser');
const LokiStore = require('connect-loki')(session);

require('dotenv').config();

mongoose.connect(`mongodb+srv://coalwork:${process.env.MONGOPASS}@web2-4m1qk.gcp.mongodb.net/database?retryWrites=true&w=majority`, {
  useNewUrlParser: true,
  useFindAndModify: false,
  useCreateIndex: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Connection error:'));

// Once mongoose connects to database the app listens on PORT
let io;
let server;
const ioEventEmitter = new EventEmitter();
db.once('open', async () => {
  console.log('Mongoose has successfully connected');
  server = app.listen(PORT, err => {
    if (err) throw err;
    console.log(`App is listening on port ${PORT}`);
    io = socket(server);
    ioEventEmitter.emit('ready');
  });
});

const app = express();
const PORT = process.env.PORT || 3000;
const PRODUCTION = !process.env.PRODUCTION || false;

const User = require('./models/User');
const Chat = require('./models/Chat');

const urlencodedParser = bodyParser.urlencoded({ extended: false });
const getUsers = async () => await User.find({});
const authValidation = [
  body('username', 'Username may not be shorter than 3 characters').isLength({ min: 3 }),
  body('username', 'Username may not be longer than 16 characters').isLength({ max: 16 }),
  body('password', 'Password is required').exists({ checkFalsy: true }),
  body('password', 'Password may not be longer than 128 characters').isLength({ max: 128 })
];
const public = path.join(__dirname, 'public');
const sessionMiddleware = session({
  genid: () => uuid(),
  secret: process.env.TOKEN || require('crypto').randomBytes(48).toString('hex'),
  store: new LokiStore(),
  resave: false,
  saveUninitialized: true
});

// This is where all the chat stuff happens
ioEventEmitter.on('ready', () => {
  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  io.on('connection', async socket => {
    socket.on('chat', async ({ message, date }) => {
      switch (true) {
        case !message:
        case message.length === 0:
        case message.replace(/\s/g, '').length === 0:
        case !date:
        case new Date(date).toString() === 'Invalid Date':
        case !socket.request.session.passport.user:
          return;
      }

      const user = (await User.findById(socket.request.session.passport.user)).username;
      const chat = new Chat({ user, message, date });

      try {
        await chat.save();
      } catch (error) {
        return console.error(error);
      }

      io.emit('chat', await Chat.find({}));
    });

    socket.on('chats', async () => {
      io.emit('chat', await Chat.find({}));
    });
  });
});

passport.use(new LocalStrategy(async (username, password, done) => {
  let user;
  let match;

  try {
    user = await User.findOne({ username });

    if (!user) return done(null, false, { msg: `Could not find user '${username}'` });

    match = await bcrypt.compare(password, user.password);

    if (!match) return done(null, false, { msg: 'Incorrect password' });

  } catch (err) {
    return done(err, { msg: 'Something unexpected occurred' });
  }

  return done(null, user);
}));

app.set('view engine', 'ejs');

// Production middleware
app.use((req, res, next) => {
  if (!PRODUCTION) return next();
  if (req.hostname !== 'haeh.herokuapp.com') return res.send('Invalid hostname');
  return next();
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

app.use((req, res, next) => {
  if (!res.locals.templateStrings)
    res.locals.templateStrings = {};
  next();
});

app.use((req, res, next) => {
  if (req.path.match(/\.ejs$/)) res.locals.statusCode = 404;
  next();
});

app.use((req, res, next) => {
  if (res.locals.statusCode) return next();
  express.static('public')(req, res, next);
});

app.get('/', (req, res) => res.redirect('/index.html'));

app.get(/\/favicon(\.\w{3})?/, (req, res) => res.sendFile(path.join(public, 'favicon.png')));

app.get('/login.html', async (req, res, next) => {
  res.locals.templateStrings = {
    errors: JSON.parse(req.query.errors || '[]'),
    serverError: req.query.serverError || ''
  };

  next();
});

app.get(/^\/(home|chat).html/, async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.locals.statusCode = 401;
  }
  next();
});

app.get('/logout.html', async (req, res, next) => {
  if (req.isAuthenticated()) {
    res.locals.statusCode = 403;
  }
  next();
});

app.get('/users.html', async (req, res, next) => {
  res.locals.templateStrings = {
    users: await getUsers()
  };
  next();
});

app.use((req, res, next) => {
  if (req.isAuthenticated()) {
    res.locals.templateStrings.user = { username: req.user.username };
  }
  next();
});

app.use(async (req, res, next) => {
  if (res.locals.statusCode) return next();

  const match = req.path.match(/(\w+)\.html$/);

  if (!match) return next();

  const filepath = path.join(public, `${match[1]}.html.ejs`);

  if (!require('fs').existsSync(filepath)) {
    res.locals.statusCode = 404;
    return next();
  }

  if (match) {
    res.send(await ejs.renderFile(
      filepath,
      res.locals.templateStrings || {}
    ));

    return res.locals.templateStrings = {};
  }

  next();
});

app.post('/login',
  urlencodedParser,
  // authValidation,
  (req, res) => {
    passport.authenticate('local', (err, user, info) => {
      if (info) {
        const errorJSON = JSON.stringify([info]);

        return res.redirect(`/login.html?errors=${encodeURIComponent(errorJSON)}`);
      }

      if (err) {
        return res.redirect(`/login.html?serverError=${encodeURIComponent(err.message)}`)
      }

      req.login(user, err => {
        if (err) {
          console.error(err);
          return res.redirect(`/login.html?serverError=${encodeURIComponent(err.message)}`);
        }

        console.log(`User '${user.username}' has successfully logged in`);

        res.redirect('/home.html');
      });
    })(req, res);
  }
);

app.post('/register', urlencodedParser, [
  ...authValidation,
  body('username').custom(async username => {
    const usernames = (await getUsers()).map(user => user.username);

    if (usernames.includes(username)) throw Error('User already exists');

    return true;
  })
], async (req, res) => {
  const redirectUrl = req.query.redirectUrl || `/home.html`;
  const errorRedirectUrl = req.query.errorRedirectUrl || '/login.html';
  const errors = validationResult(req);
  const errorsJSON = JSON.stringify(errors.array().map(error => {
    if (error.param === 'password') delete error.value;
    return error;
  }));
  if (!errors.isEmpty()) return res.status(400).redirect(`${errorRedirectUrl}?errors=${encodeURIComponent(errorsJSON)}`);

  const { username, password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash });

    await user.save();
  } catch (error) {
    return res.status(500).redirect(`${errorRedirectUrl}?serverError=${encodeURIComponent(error.message)}`);
  }

  console.log(`Successfully saved user '${username}' to database`);

  passport.authenticate('local', (err, user, info) => {
    if (info) {
      const error = Object.assign({}, info);
      Object.defineProperty(error, 'msg', Object.getOwnPropertyDescriptor(error, 'message'));
      delete error.message;

      const errorJSON = JSON.stringify([error]);

      return res.redirect(`/login.html?errors=${encodeURIComponent(errorJSON)}`);
    }

    if (err) {
      return res.redirect(`${errorRedirectUrl}?serverError${encodeURIComponent(err.message)}`)
    }

    req.login(user, err => {
      if (err) return res.redirect(`${errorRedirectUrl}?serverError=${err.message}`);
      console.log(`User '${username}' has successfully logged in`);

      res.redirect('/home.html');
    });
  })(req, res);
});

app.get('/logout', (req, res, next) => {
  if (!req.isAuthenticated()) (res.locals.statusCode = 401) && next();
  const { username } = req.user;
  req.logout();
  console.log(`'${username}' has been successfully logged out`);
  res.redirect('/logout.html');
});

app.use((req, res, next) => {
  if (!res.locals.statusCode) res.locals.statusCode = 404;
  next();
});

app.use(async (req, res, next) => {
  if (!res.locals.statusCode) return next();

  res.locals.templateStrings.errorCode = res.locals.statusCode;

  res.send(await ejs.renderFile(path.join(public, 'error.html.ejs'),
    res.locals.templateStrings
  ));
});

process.on('exit', mongoose.disconnect);
