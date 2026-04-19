# nginx loadbalancer dengan database mysql dan s3
## 📚 Perpustakaan Digital - CRUD App

Aplikasi manajemen perpustakaan berbasis Node.js + MySQL + AWS S3.

---
![Infra](/image/nginx_loadbalancer_mysql_s3-libraryapp.drawio-dark.png)

---

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
DB_USER=admin
DB_PASSWORD=admin123
DB_NAME=perpustakaan
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=your-bucket-name
```

### 4. Buat server Database MySQL

UserData untuk membuat server mysql

username : admin / password : admin123

```sql
#!/bin/bash

# Update package list
apt-get update -y

# Install MySQL Server
apt-get install mysql-server -y

# Start dan enable MySQL
systemctl start mysql
systemctl enable mysql

# Set root password dan konfigurasi keamanan
mysql -u root <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'P4ssw0rd';
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
EOF

# Ganti '@localhost' jadi '@%' agar bisa remote
mysql -u root -p'P4ssw0rd' <<EOF
CREATE USER 'admin'@'%' IDENTIFIED BY 'admin123';
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
EOF

# Ubah bind-address ke 0.0.0.0
sed -i 's/^bind-address\s*=.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
grep -q "^bind-address" /etc/mysql/mysql.conf.d/mysqld.cnf || \
  echo "bind-address = 0.0.0.0" >> /etc/mysql/mysql.conf.d/mysqld.cnf

# Restart MySQL agar config berlaku
systemctl restart mysql

# Log selesai
echo "MySQL installation completed" >> /var/log/user-data.log
```

> Database `perpustakaan` dan Tabel `books` akan dibuat otomatis saat server pertama kali dijalankan.

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

git clone https://github.com/paknux/nginx_loadbalancer_mysql_s3-libraryapp.git /app
cd /app
npm install

cat > .env <<EOF
PORT=3000
DB_HOST=YOUR_DB_HOST
DB_USER=admin
DB_PASSWORD=admin123
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
