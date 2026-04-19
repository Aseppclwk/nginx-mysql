# 📚 Perpustakaan Digital - CRUD App

Aplikasi manajemen perpustakaan berbasis Node.js + MySQL + AWS S3.

## Fitur
- ✅ CRUD buku (Create, Read, Update, Delete)
- ✅ Upload cover buku ke AWS S3
- ✅ Tampil hostname & IP server di header
- ✅ Search & filter berdasarkan kategori
- ✅ Responsive UI

## Struktur File
```
library-app/
├── server.js          # Backend Express API
├── package.json
├── .env.example       # Template environment variables
└── public/
    └── index.html     # Frontend SPA
```

## Cara Install & Jalankan

### 1. Install dependencies
```bash
npm install
```

### 2. Buat file .env
```bash
cp .env.example .env
# Edit .env sesuaikan dengan konfigurasi kamu
```

### 3. Isi .env
```env
PORT=3000
DB_HOST=your-mysql-host
DB_USER=appuser
DB_PASSWORD=AppPassword123!
DB_NAME=perpustakaan
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=your-bucket-name
```

### 4. Buat database MySQL
```sql
CREATE DATABASE perpustakaan;
```
> Tabel `books` akan dibuat otomatis saat server pertama kali dijalankan.

### 5. Konfigurasi S3 Bucket
- Buat S3 bucket di AWS Console
- Nonaktifkan "Block all public access" agar gambar bisa diakses publik
- Tambahkan bucket policy berikut:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::your-bucket-name/*"
  }]
}
```

### 6. Jalankan server
```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

Buka browser: `http://localhost:3000`

## API Endpoints

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| GET | /api/server-info | Info hostname & IP |
| GET | /api/books | Ambil semua buku |
| GET | /api/books/:id | Ambil satu buku |
| POST | /api/books | Tambah buku baru |
| PUT | /api/books/:id | Edit buku |
| DELETE | /api/books/:id | Hapus buku |
| GET | /api/categories | List kategori |

## User Data AWS (EC2)

Untuk deploy otomatis di EC2, tambahkan ke User Data:

```bash
#!/bin/bash
apt-get update -y
apt-get install -y nodejs npm git

git clone https://github.com/username/library-app.git /app
cd /app
npm install

cat > .env <<EOF
PORT=3000
DB_HOST=YOUR_DB_HOST
DB_USER=appuser
DB_PASSWORD=AppPassword123!
DB_NAME=perpustakaan
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=YOUR_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET
S3_BUCKET=YOUR_BUCKET
EOF

npm install -g pm2
pm2 start server.js --name library-app
pm2 startup
pm2 save
```
