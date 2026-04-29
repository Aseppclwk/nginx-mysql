const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ─── Multer ───────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, WEBP allowed'));
  }
});

// ─── S3 Client dengan timeout eksplisit ──────────────────────
// FIX #1: Tambahkan requestHandler dengan timeout
// Tanpa ini, upload ke S3 bisa hang selamanya tanpa error
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && {
      sessionToken: process.env.AWS_SESSION_TOKEN
    }),
  },
  // FIX #1: Timeout 15 detik — kalau S3 tidak respond, langsung throw error
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,   // 5 detik untuk koneksi
    socketTimeout: 15000,      // 15 detik untuk transfer
  }),
  maxAttempts: 2, // Retry 1x sebelum menyerah
});

// ─── MySQL Pool ───────────────────────────────────────────────
const poolNoDB = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 5,
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// ─── Init DB ──────────────────────────────────────────────────
async function initDB() {
  const connNoDB = await poolNoDB.getConnection();
  const dbName = process.env.DB_NAME || 'perpustakaan';
  await connNoDB.execute(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  connNoDB.release();
  console.log(`✅ Database '${dbName}' siap`);

  const conn = await pool.getConnection();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      author VARCHAR(255) NOT NULL,
      isbn VARCHAR(50),
      category VARCHAR(100),
      year INT,
      description TEXT,
      cover_url VARCHAR(500),
      cover_key VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  conn.release();
  console.log('✅ Tabel books siap');
}

// ─── Server Info ──────────────────────────────────────────────
function getServerInfo() {
  const interfaces = os.networkInterfaces();
  let ip = '127.0.0.1';
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        ip = alias.address;
        break;
      }
    }
  }
  return { hostname: os.hostname(), ip };
}

// ─── S3 Helpers ───────────────────────────────────────────────
// FIX #2: uploadToS3 sekarang throw error dengan pesan yang jelas
async function uploadToS3(file) {
  const ext = path.extname(file.originalname) || '.jpg';
  const key = `books/${uuidv4()}${ext}`;

  console.log(`📤 Uploading to S3: bucket=${process.env.S3_BUCKET}, key=${key}`);

  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));
  } catch (err) {
    // Log detail error S3 untuk debugging
    console.error('❌ S3 Upload Error:', {
      message: err.message,
      code: err.Code || err.code,
      statusCode: err.$metadata?.httpStatusCode,
      requestId: err.$metadata?.requestId,
    });
    // Re-throw dengan pesan yang lebih informatif
    throw new Error(`S3 upload gagal: ${err.message}`);
  }

  const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  console.log(`✅ S3 Upload sukses: ${url}`);
  return { key, url };
}

async function deleteFromS3(key) {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key
    }));
    console.log(`🗑️ S3 Delete sukses: ${key}`);
  } catch (err) {
    // Jangan crash app kalau delete gagal — hanya log
    console.error(`⚠️ S3 Delete gagal (key: ${key}):`, err.message);
  }
}

// ─── FIX #3: Global error handler untuk Multer ───────────────
// Multer errors (file terlalu besar, tipe salah) tidak otomatis
// ditangkap oleh try/catch biasa — perlu middleware khusus
function handleUpload(req, res, next) {
  upload.single('cover')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}` // e.g. "File too large"
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message // e.g. "Only JPG, PNG, WEBP allowed"
      });
    }
    next();
  });
}

// ─── API Routes ───────────────────────────────────────────────

app.get('/api/server-info', (req, res) => {
  res.json(getServerInfo());
});

app.get('/api/db-status', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [[row]] = await conn.execute('SELECT VERSION() AS version, NOW() AS now');
    const [[tbl]] = await conn.execute('SELECT COUNT(*) AS total FROM books');
    conn.release();
    res.json({
      status: 'connected',
      version: row.version,
      time: row.now,
      total_books: tbl.total
    });
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

// FIX #4: Endpoint khusus untuk test koneksi S3
// Gunakan ini dulu sebelum test upload file sungguhan
app.get('/api/s3-status', async (req, res) => {
  try {
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    res.json({
      success: true,
      message: 'S3 bucket accessible',
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'S3 tidak bisa diakses',
      error: err.message,
      code: err.Code || err.code,
      statusCode: err.$metadata?.httpStatusCode,
      hint: err.$metadata?.httpStatusCode === 403
        ? 'Credentials expired atau IAM permission kurang'
        : err.$metadata?.httpStatusCode === 404
        ? 'Bucket tidak ditemukan atau region salah'
        : 'Cek NAT instance dan koneksi internet dari private subnet',
    });
  }
});

app.get('/api/books', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = 'SELECT * FROM books WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM books WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Book not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// FIX #3 diterapkan: pakai handleUpload, bukan upload.single() langsung
app.post('/api/books', handleUpload, async (req, res) => {
  try {
    const { title, author, isbn, category, year, description } = req.body;
    if (!title || !author) {
      return res.status(400).json({ success: false, message: 'Title dan author wajib diisi' });
    }

    let cover_url = null, cover_key = null;

    if (req.file) {
      // FIX #2: Error S3 sekarang ter-catch dan dikembalikan sebagai JSON
      const s3Result = await uploadToS3(req.file);
      cover_url = s3Result.url;
      cover_key = s3Result.key;
    }

    const [result] = await pool.execute(
      'INSERT INTO books (title, author, isbn, category, year, description, cover_url, cover_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, author, isbn || null, category || null, year || null, description || null, cover_url, cover_key]
    );
    const [rows] = await pool.execute('SELECT * FROM books WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });

  } catch (err) {
    console.error('❌ POST /api/books error:', err.message);
    // FIX: Selalu kembalikan JSON, bukan HTML error page
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/books/:id', handleUpload, async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT * FROM books WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Book not found' });

    const { title, author, isbn, category, year, description } = req.body;
    let { cover_url, cover_key } = existing[0];

    if (req.file) {
      await deleteFromS3(cover_key);
      const s3Result = await uploadToS3(req.file);
      cover_url = s3Result.url;
      cover_key = s3Result.key;
    }

    await pool.execute(
      'UPDATE books SET title=?, author=?, isbn=?, category=?, year=?, description=?, cover_url=?, cover_key=? WHERE id=?',
      [title, author, isbn || null, category || null, year || null, description || null, cover_url, cover_key, req.params.id]
    );
    const [rows] = await pool.execute('SELECT * FROM books WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });

  } catch (err) {
    console.error('❌ PUT /api/books error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT * FROM books WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Book not found' });
    await deleteFromS3(existing[0].cover_key);
    await pool.execute('DELETE FROM books WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Book deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT DISTINCT category FROM books WHERE category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, data: rows.map(r => r.category) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── FIX #5: Global fallback error handler ───────────────────
// Ini menangkap SEMUA error yang tidak ter-catch di route manapun
// dan memastikan response selalu JSON, bukan HTML
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    const { hostname, ip } = getServerInfo();
    console.log(`🚀 Server running on http://${ip}:${PORT}`);
    console.log(`📦 Hostname: ${hostname}`);
    console.log(`🪣 S3 Bucket: ${process.env.S3_BUCKET} (${process.env.AWS_REGION})`);
  });
}).catch(err => {
  console.error('❌ DB init failed:', err.message);
  process.exit(1);
});
