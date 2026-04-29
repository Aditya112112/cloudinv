const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
app.use(express.json());

// ================== MongoDB Connection ==================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smartinv';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected ✅'))
  .catch(err => console.log('MongoDB Error:', err));

// ================== Session (cookie-based) ==================
// billing.html & khata.html use credentials:'include' — needs cookie sessions
// Run: npm install express-session connect-mongo
app.use(session({
  secret: 'smartinv-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }  // 7 days
}));

// ================== Schemas & Models ==================

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const ShopSchema = new mongoose.Schema({
  owner:       { type: String, required: true, unique: true },
  shopName:    { type: String, default: 'My Shop' },
  shopPhone:   { type: String, default: '' },
  shopAddress: { type: String, default: '' },
  shopGst:     { type: String, default: '' },
});

const ProductSchema = new mongoose.Schema({
  owner:   { type: String, required: true },
  name:    { type: String, required: true },
  price:   { type: Number, default: 0 },
  stock:   { type: Number, default: 0 },
  gst:     { type: Number, default: 0 },
  unit:    { type: String, default: '' },
  barcode: { type: String, default: '' },
}, { timestamps: true });

const InvoiceSchema = new mongoose.Schema({
  owner:         { type: String, required: true },
  invoiceNum:    Number,
  customer:      String,
  phone:         String,
  items:         Array,
  subtotal:      Number,
  cgstTotal:     Number,
  sgstTotal:     Number,
  gstTotal:      Number,
  discount:      Number,
  grand:         Number,
  paymentMethod: String,
  date:          String,
  time:          String,
}, { timestamps: true });

const KhataEntrySchema = new mongoose.Schema({
  type:   { type: String, enum: ['debit', 'credit'] },
  amount: Number,
  note:   String,
  date:   String,
});

const KhataSchema = new mongoose.Schema({
  owner:   { type: String, required: true },
  name:    { type: String, required: true },
  phone:   { type: String, default: '' },
  entries: [KhataEntrySchema],
}, { timestamps: true });

const User    = mongoose.model('User',    UserSchema);
const Shop    = mongoose.model('Shop',    ShopSchema);
const Product = mongoose.model('Product', ProductSchema);
const Invoice = mongoose.model('Invoice', InvoiceSchema);
const Khata   = mongoose.model('Khata',   KhataSchema);

// ================== Auth Middleware ==================
function requireAuth(req, res, next) {
  if (req.session && req.session.username) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ================== Static Frontend ==================
// Serve CSS, JS, images — but NOT .html files directly (auth protection)
const FRONTEND = path.join(__dirname, '../frontend');
app.use(express.static(FRONTEND, { index: false, extensions: [] }));

// Public pages
app.get('/login.html',  (req, res) => res.sendFile(path.join(FRONTEND, 'login.html')));
app.get('/signup.html', (req, res) => res.sendFile(path.join(FRONTEND, 'signup.html')));

// Protected pages — redirect to login if session missing
function serveProtected(page) {
  return (req, res) => {
    if (req.session && req.session.username)
      return res.sendFile(path.join(FRONTEND, page));
    res.redirect('/login.html');
  };
}
app.get('/dashboard.html', serveProtected('dashboard.html'));
app.get('/billing.html',   serveProtected('billing.html'));
app.get('/inventory.html', serveProtected('inventory.html'));
app.get('/khata.html',     serveProtected('khata.html'));

// ================== Auth Routes ==================

// POST /api/signup  ← signup.html
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, shopName, shopPhone, shopAddress, shopGst } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password required' });

    const existing = await User.findOne({ username });
    if (existing)
      return res.status(409).json({ success: false, message: 'Username already taken' });

    await User.create({ username, password });
    await Shop.create({ owner: username, shopName, shopPhone, shopAddress, shopGst });

    req.session.username = username;
    res.json({ success: true, username });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/login  ← login.html
// Returns shopName/Phone/Address/Gst so login.html can store in localStorage
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password required' });

    const user = await User.findOne({ username });
    if (!user || user.password !== password)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const shop = await Shop.findOne({ owner: username });
    req.session.username = username;

    res.json({
      success:     true,
      username,
      shopName:    shop?.shopName    || '',
      shopPhone:   shop?.shopPhone   || '',
      shopAddress: shop?.shopAddress || '',
      shopGst:     shop?.shopGst     || '',
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/auth/me  ← billing.html, khata.html (credentials:'include')
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

// POST /api/auth/logout  ← billing.html, khata.html, dashboard.html, inventory.html
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ================== Shop Routes ==================

// GET /api/shop  ← billing.html
app.get('/api/shop', requireAuth, async (req, res) => {
  try {
    let shop = await Shop.findOne({ owner: req.session.username });
    if (!shop) shop = await Shop.create({ owner: req.session.username });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/shop  ← future settings page
app.put('/api/shop', requireAuth, async (req, res) => {
  try {
    const shop = await Shop.findOneAndUpdate(
      { owner: req.session.username },
      req.body,
      { new: true, upsert: true }
    );
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================== Product Routes ==================
// Note: dashboard.html & inventory.html don't send credentials:'include'
// so no requireAuth on product routes — add it if you update those files

// GET /api/products  ← dashboard.html, billing.html, inventory.html
app.get('/api/products', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    res.json(await Product.find({ owner }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/products  ← inventory.html
app.post('/api/products', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    const p = await Product.create({ ...req.body, owner });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/products/:id  ← billing.html (stock deduction after invoice)
app.put('/api/products/:id', async (req, res) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/products/:id  ← inventory.html
app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================== Invoice Routes ==================

// GET /api/invoices  ← dashboard.html, billing.html
app.get('/api/invoices', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    const invoices = await Invoice.find({ owner }).sort({ invoiceNum: 1 });
    res.json(invoices.map(inv => ({ ...inv.toObject(), id: inv.invoiceNum })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices  ← billing.html
app.post('/api/invoices', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    const count = await Invoice.countDocuments({ owner });
    const inv   = await Invoice.create({ ...req.body, owner, invoiceNum: count + 1 });
    res.json({ ...inv.toObject(), id: inv.invoiceNum });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================== Khata Routes ==================

// GET /api/khata  ← dashboard.html, billing.html, khata.html
app.get('/api/khata', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    res.json(await Khata.find({ owner }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/khata  ← billing.html (new udhar customer), khata.html (add customer)
app.post('/api/khata', async (req, res) => {
  try {
    const owner = req.session?.username || 'default';
    const cust = await Khata.create({ ...req.body, owner });
    res.json(cust);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/khata/:id/entry  ← billing.html (udhar entry), khata.html (add entry / settle)
app.post('/api/khata/:id/entry', async (req, res) => {
  try {
    const cust = await Khata.findByIdAndUpdate(
      req.params.id,
      { $push: { entries: req.body } },
      { new: true }
    );
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    res.json(cust);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/khata/:id  ← khata.html
app.delete('/api/khata/:id', async (req, res) => {
  try {
    await Khata.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================== Home ==================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// ================== Start Server ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SmartInv running at http://localhost:${PORT}`);
});