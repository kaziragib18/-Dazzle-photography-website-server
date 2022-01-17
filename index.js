const express = require('express')
const cors = require('cors');
const admin = require("firebase-admin");
require('dotenv').config();
const { MongoClient } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const ObjectId = require('mongodb').ObjectId;
const fileUpload = require('express-fileupload')

const app = express();
const port = process.env.PORT || 5000;
app.use(fileUpload());

//replaced \\n with \n in service key after stringify the key
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

//middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.txagv.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

// console.log(uri)

async function verifyToken(req, res, next) {
  if (req.headers?.authorization?.startsWith('Bearer ')) {
    const token = req.headers.authorization.split(' ')[1];
    try {
      const decodedUser = await admin.auth().verifyIdToken(token);
      req.decodedEmail = decodedUser.email;
    }
    catch {

    }
  }
  next();
}

async function run() {
  try {
    await client.connect();
    // console.log('database connected successfully');

    const database = client.db('dazzle_database');
    const packagesCollection = database.collection('packages');
    const bookingsCollection = database.collection('bookings');
    const usersCollection = database.collection('users');
    const reviewsCollection = database.collection('reviews');

    //get package api
    app.get('/packages', async (req, res) => {
      const cursor = packagesCollection.find({});
      const packages = await cursor.toArray();
      res.send(packages);

    })

    //post package api
    app.post('/packages', async (req, res) => {
      const package = req.body;
      // console.log('hit the post api', package);

      const result = await packagesCollection.insertOne(package)
      // console.log(result);
      res.json(result)

    })

    //get bookings api
    app.get('/bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      const date = req.query.date;
      // console.log(date);
      const query = { email: email, date: date };
      // console.log(query);
      const cursor = bookingsCollection.find(query);
      const bookings = await cursor.toArray();
      res.json(bookings);

    })

    //post bookings api
    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      // console.log('hit the post api', booking);

      const result = await bookingsCollection.insertOne(booking)
      // console.log(result);
      res.json(result)
    })

    //get single booking id
    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      // console.log(result);
      res.json(result);
    })

    //update booking for payment
    app.put('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          payment: payment
        }
      };
      const result = await bookingsCollection.updateOne(filter, updateDoc);
      res.json(result);
    })


    //delete product api
    app.delete('/packages/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await packagesCollection.deleteOne(query);
      // console.log(result);
      res.json(result);
    })

    //delete booking api
    app.delete('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      // console.log(result);
      res.json(result);
    })

    //post review api
    app.post('/reviews', async (req, res) => {
      const name = req.body.name;
      const email = req.body.email;
      const rating = req.body.rating;
      const desc = req.body.desc;
      const pic = req.files.image;
      const picData = pic.data;
      const encodedPic = picData.toString('base64');
      const imageBuffer = Buffer.from(encodedPic, 'base64');
      const review = {
        img: imageBuffer,
        name,
        email,
        rating,
        desc,
      }
      // console.log('body', req.body);
      // console.log('files', req.files);
      // res.json({ success: true });
      // const review = req.body;
      // console.log('hit the post api', review);
      const result = await reviewsCollection.insertOne(review);
      // console.log(result);
      res.json(result);
    });

    //get review api
    app.get('/reviews', async (req, res) => {
      const cursor = reviewsCollection.find({});
      const reviews = await cursor.toArray();
      res.json(reviews);
    })

    //post user api 
    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      console.log(result);
      res.json(result);
    })


    //get admin api verify email
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let isAdmin = false;
      if (user?.role === 'admin') {
        isAdmin = true;
      }
      res.json({ admin: isAdmin });
    })

    //UPSERT user api
    app.put('/users', async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const options = { upsert: true };
      const updateDoc = { $set: user };
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.json(result);
    })

    //put admin api
    app.put('/users/admin', verifyToken, async (req, res) => {
      const user = req.body;
      const requester = req.decodedEmail;
      if (requester) {
        const requesterAccount = await usersCollection.findOne({ email: requester });
        if (requesterAccount.role === 'admin') {
          const filter = { email: user.email };
          const updateDoc = { $set: { role: 'admin' } };
          const result = await usersCollection.updateOne(filter, updateDoc);
          res.json(result);
        }
      }
      else {
        res.status(403).json({ message: 'You do not have access to create new admin' })
      }
    })

    //PAYMENT
    app.post('/create-payment-intent', async (req, res) => {
      const paymentInfo = req.body;
      const amount = paymentInfo.price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        payment_method_types: ['card']
      })
      res.json({ clientSecret: paymentIntent.client_secret })
    })



  }
  finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.use(cors());
app.use(express.json());


app.get('/', (req, res) => {
  res.send('Dazzle website server')
})

app.listen(port, () => {
  console.log(`Dazzle server is listening at port ${port}`)
})