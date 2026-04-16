# MC Panel — Minecraft Server Management

Panel manajemen Minecraft server berbasis Next.js. Fitur: Start/Stop/Restart, Live Console, Editor Konfigurasi, Manajemen Plugin, Whitelist & Ban.

---

## Prasyarat

| Kebutuhan | Versi minimum |
|---|---|
| Node.js | 18+ |
| Java | 17+ (untuk Minecraft server) |
| OS VPS | Ubuntu 20.04+ / Debian 11+ |

---

## Development (lokal)

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

---

## Deploy ke VPS — Step by Step

### Langkah 1 — Siapkan VPS

SSH ke VPS kamu:

```bash
ssh user@ip-vps
```

Install Node.js (jika belum ada):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # pastikan v18+
```

Install Java (untuk Minecraft):

```bash
sudo apt install -y openjdk-21-jre-headless
java -version
```

Install PM2 untuk menjalankan panel sebagai service:

```bash
sudo npm install -g pm2
```

---

### Langkah 2 — Upload project ke VPS

**Pilihan A — via rsync (dari komputer lokal):**

```bash
# Jalankan di komputer lokal (bukan VPS)
rsync -avz \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  ./ user@ip-vps:/opt/mc-panel/
```

**Pilihan B — via Git:**

```bash
# Di VPS
git clone https://github.com/username/minecraft-servers /opt/mc-panel
```

**Pilihan C — via SCP (zip dulu):**

```bash
# Di komputer lokal
zip -r mc-panel.zip . -x "node_modules/*" ".next/*" ".git/*"
scp mc-panel.zip user@ip-vps:/opt/mc-panel.zip

# Di VPS
mkdir /opt/mc-panel
unzip /opt/mc-panel.zip -d /opt/mc-panel
```

---

### Langkah 3 — Setting Minecraft server

Pastikan folder Minecraft server sudah ada di VPS, misalnya di `/opt/minecraft`:

```bash
ls /opt/minecraft
# Harus ada: server.jar, eula.txt (isi eula=true)
```

Jika belum ada, buat dulu:

```bash
mkdir -p /opt/minecraft
cd /opt/minecraft
# Download server.jar dari https://www.minecraft.net/en-us/download/server
wget -O server.jar https://...url-server-jar...
echo "eula=true" > eula.txt
```

---

### Langkah 4 — Konfigurasi environment

```bash
cd /opt/mc-panel
nano .env.local
```

Isi sesuai setup kamu:

```env
MINECRAFT_DIR=/opt/minecraft
MINECRAFT_JAR=server.jar
MINECRAFT_MAX_MEMORY=2G
MINECRAFT_MIN_MEMORY=512M
MINECRAFT_JAVA_PATH=java
```

Simpan dengan `Ctrl+O` → `Enter` → `Ctrl+X`.

---

### Langkah 5 — Install dependencies & build

```bash
cd /opt/mc-panel
npm install
npm run build
```

---

### Langkah 6 — Jalankan panel dengan PM2

```bash
cd /opt/mc-panel
pm2 start "npm start" --name mc-panel
pm2 save
pm2 startup   # ikuti perintah yang muncul di output
```

Cek status:

```bash
pm2 status
pm2 logs mc-panel --lines 50
```

Panel berjalan di `http://ip-vps:3000`.

---

### Langkah 7 — Buka port firewall

```bash
# Izinkan semua akses ke port 3000
sudo ufw allow 3000/tcp

# ATAU hanya dari IP kamu (lebih aman)
sudo ufw allow from YOUR_IP to any port 3000

sudo ufw status
```

---

### Langkah 8 (opsional) — Nginx reverse proxy

Agar panel bisa diakses via port 80 atau domain:

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/mc-panel
```

Isi file konfigurasi Nginx:

```nginx
server {
    listen 80;
    server_name panel.domain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;

        # Wajib untuk live console (SSE)
        proxy_buffering    off;
        proxy_read_timeout 86400s;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/mc-panel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Akses panel di `http://panel.domain.com`.

---

### Langkah 9 (opsional) — HTTPS dengan Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.domain.com
```

---

## Perintah berguna

```bash
pm2 status              # cek status panel
pm2 restart mc-panel    # restart panel
pm2 stop mc-panel       # stop panel
pm2 logs mc-panel       # lihat log real-time

# Update panel setelah ada perubahan code
cd /opt/mc-panel
git pull                # jika pakai Git
npm install
npm run build
pm2 restart mc-panel
```

---

## Variabel environment

| Variabel | Default | Keterangan |
|---|---|---|
| `MINECRAFT_DIR` | `/opt/minecraft` | Path folder server Minecraft |
| `MINECRAFT_JAR` | `server.jar` | Nama file JAR server |
| `MINECRAFT_MAX_MEMORY` | `2G` | Maksimum RAM untuk server |
| `MINECRAFT_MIN_MEMORY` | `512M` | Minimum RAM untuk server |
| `MINECRAFT_JAVA_PATH` | `java` | Path binary Java |

---

## Troubleshooting

**Panel tidak bisa Start server:**
- Pastikan `MINECRAFT_DIR` dan `MINECRAFT_JAR` di `.env.local` sudah benar
- Pastikan user yang menjalankan PM2 punya akses baca/tulis ke folder Minecraft
- Cek log: `pm2 logs mc-panel`

**Live console tidak update:**
- Pastikan Nginx menggunakan `proxy_buffering off`
- Pastikan `proxy_read_timeout` cukup besar

**Port 3000 tidak bisa diakses:**
- Cek firewall: `sudo ufw status`
- Cek apakah panel berjalan: `pm2 status`

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
