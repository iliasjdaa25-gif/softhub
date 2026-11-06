const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { initDatabase, queryAll, queryOne, runSql, runSqlNoReturn } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'software-hub-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// Auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ============ PAGES ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/program', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'program.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ============ API: PROGRAMS ============
app.get('/api/programs', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 12 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM programs';
    let countQuery = 'SELECT COUNT(*) as total FROM programs';
    const params = [];
    const countParams = [];
    const conditions = [];

    if (category && category !== 'All') {
      conditions.push('category = ?');
      params.push(category);
      countParams.push(category);
    }
    if (search) {
      conditions.push("(title LIKE ? OR description LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
      countParams.push(`%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      const where = ' WHERE ' + conditions.join(' AND ');
      query += where;
      countQuery += where;
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const countResult = await queryOne(countQuery, countParams);
    const programs = await queryAll(query, params);

    res.json({
      programs,
      total: countResult ? countResult.total : 0,
      page: parseInt(page),
      totalPages: Math.ceil((countResult ? countResult.total : 0) / parseInt(limit))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/programs/:id', async (req, res) => {
  try {
    const program = await queryOne('SELECT * FROM programs WHERE id = ?', [parseInt(req.params.id)]);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await queryAll('SELECT * FROM categories ORDER BY name');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ AUTH ============
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await queryOne('SELECT * FROM admin WHERE username = ?', [username]);

    if (!admin || !bcrypt.compareSync(password, admin.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ============ ADMIN CRUD ============
app.post('/api/programs', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, description, download_link, category } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;

    const result = await runSql(
      'INSERT INTO programs (title, description, image, download_link, category) VALUES (?, ?, ?, ?, ?)',
      [title, description || '', image, download_link, category || 'General']
    );

    const program = await queryOne('SELECT * FROM programs WHERE id = ?', [result.lastId]);
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/programs/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, description, download_link, category } = req.body;
    const existing = await queryOne('SELECT * FROM programs WHERE id = ?', [parseInt(req.params.id)]);

    if (!existing) return res.status(404).json({ error: 'Program not found' });

    let image = existing.image;
    if (req.file) {
      if (existing.image) {
        const oldPath = path.join(__dirname, 'public', existing.image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      image = '/uploads/' + req.file.filename;
    }

    await runSqlNoReturn(
      'UPDATE programs SET title = ?, description = ?, image = ?, download_link = ?, category = ? WHERE id = ?',
      [title, description || '', image, download_link, category || 'General', parseInt(req.params.id)]
    );

    const updated = await queryOne('SELECT * FROM programs WHERE id = ?', [parseInt(req.params.id)]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/programs/:id', requireAdmin, async (req, res) => {
  try {
    const program = await queryOne('SELECT * FROM programs WHERE id = ?', [parseInt(req.params.id)]);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    if (program.image) {
      const imgPath = path.join(__dirname, 'public', program.image);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await runSqlNoReturn('DELETE FROM programs WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    await runSqlNoReturn('INSERT INTO categories (name) VALUES (?)', [name]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
  try {
    await runSqlNoReturn('DELETE FROM categories WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await queryOne('SELECT * FROM admin WHERE id = ?', [req.session.adminId]);

    if (!bcrypt.compareSync(currentPassword, admin.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    await runSqlNoReturn('UPDATE admin SET password = ? WHERE id = ?', [hashed, admin.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const totalPrograms = await queryOne('SELECT COUNT(*) as total FROM programs');
    const totalCategories = await queryOne('SELECT COUNT(*) as total FROM categories');
    const recentPrograms = await queryAll('SELECT * FROM programs ORDER BY created_at DESC LIMIT 5');
    const categoryStats = await queryAll('SELECT category, COUNT(*) as count FROM programs GROUP BY category ORDER BY count DESC');

    res.json({
      totalPrograms: totalPrograms ? totalPrograms.total : 0,
      totalCategories: totalCategories ? totalCategories.total : 0,
      recentPrograms,
      categoryStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ START ============
async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('  🚀 SoftHub is running!');
    console.log('='.repeat(50));
    console.log(`  📌 Website:  http://localhost:${PORT}`);
    console.log(`  🔐 Admin:    http://localhost:${PORT}/login`);
    console.log('');
    console.log('  Admin Login:');
    console.log('  Username: Ilias');
    console.log('  Password: Ilias1998');
    console.log('='.repeat(50));
    console.log('');
  });
}

start().catch(console.error);
