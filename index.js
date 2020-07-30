const fs = require('fs');
const ejs = require('ejs');
const path = require('path');
const bcrypt = require('bcrypt');
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');

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

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.get('/login.html', (req, res) => {
  const file = fs.readFileSync(path.join(__dirname, 'public', '.login.html.ejs')).toString();
  res.send(ejs.render(file, { errors: JSON.parse(req.query.errors || '[]'), serverError: req.query.serverError || '' }));
});

app.post('/register', urlencodedParser, [
  ...authValidation,
  body('username').custom(async username => {
    const usernames = (await getUsers()).map(user => user.username);

    if (usernames.includes(username)) throw Error('User already exists');

    return true;
  })
], async (req, res) => {
  const redirectUrl = req.query.redirectUrl || `/profile/${req.body.username}`;
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
