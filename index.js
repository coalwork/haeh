const { v4: uuid } = require('uuid');
const { Strategy: LocalStrategy } = require('passport-local');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
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
db.once('open', () => console.log('Mongoose has successfully connected'));

const app = express();
const PORT = process.env.PORT || 3000;

const User = require('./models/User');

const urlencodedParser = bodyParser.urlencoded({ extended: false });
const getUsers = async () => await User.find({});
const authValidation = [
  body('username', 'Username may not be shorter than 3 characters').isLength({ min: 3 }),
  body('username', 'Username may not be longer than 16 characters').isLength({ max: 16 }),
  body('password', 'Password is required').exists({ checkFalsy: true }),
  body('password', 'Password may not be longer than 128 characters').isLength({ max: 128 })
];

passport.use(new LocalStrategy(async (username, password, done) => {
  let user;
  let match;

  try {
    user = await User.findOne({ username });

    if (!user) return done(null, false);

    match = await bcrypt.compare(password, user.password);

    if (!match) return done(null, false);

  } catch (err) {
    return done(err);
  }

  return done(null, user);
}));

app.set('view engine', 'ejs');

app.use(session({
  genid: () => uuid(),
  secret: process.env.TOKEN || require('crypto').randomBytes(48).toString('hex'),
  store: new LokiStore(),
  resave: false,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

app.use(express.static('public'));

app.get('/test', (req, res) => {
  console.log(req.sessionID);
  res.send('debugging\n');
});

app.get('/login.html', (req, res) => {
  const file = fs.readFileSync(path.join(__dirname, 'public', '.login.html.ejs')).toString();
  res.send(ejs.render(file, { errors: JSON.parse(req.query.errors || '[]'), serverError: req.query.serverError || '' }));
});

app.get('/home.html', (req, res) => {
  
});

app.post('/login', urlencodedParser, [
  ...authValidation
], passport.authenticate('local', { successRedirect: '/', failureRedirect: '/login.html' })
);

app.post('/register', urlencodedParser, [
  ...authValidation,
  body('username').custom(async username => {
    const usernames = (await getUsers()).map(user => user.username);

    if (usernames.includes(username)) throw Error('User already exists');

    return true;
  })
], async (req, res) => {
  const redirectUrl = req.query.redirectUrl || `/home`;
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
  res.status(201).redirect(redirectUrl);
});

app.listen(PORT, err => {
  if (err) throw err;
  console.log(`App is listening on port ${PORT}`);
});

process.on('exit', mongoose.disconnect);
