# ORBIT — İletişim ve Topluluk Platformu

ORBIT; gerçek zamanlı metin kanalları, özel mesajlar, sesli/görüntülü WebRTC odaları, forum kanalları, rol ve izin hiyerarşisi ile moderasyon araçları sunan full-stack iletişim platformudur.

## Mimari

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router
- **Backend**: Node.js, Express, WebSocket (`ws`), Zod, Multer
- **Veritabanı**: SQLite (`better-sqlite3`, sürüm takipli SQL migration: `src/db/migrations/001_initial_schema.sql`)
- **Ses ve Görüntü**: WebRTC + WebSocket sinyalleşme (`/ws`)

## Kurulum ve Çalıştırma

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. Ortam değişkenlerini ayarlayın (`.env.example` dosyasını referans alın):
   ```bash
   cp .env.example .env
   ```

3. Geliştirme sunucusunu başlatın (port 3000):
   ```bash
   npm run dev
   ```

4. Otomatik testleri çalıştırın:
   ```bash
   npm test
   ```

5. Üretim derlemesi ve başlatma:
   ```bash
   npm run build
   npm start
   ```

## Opsiyonel Dış Servisler

- **TURN Sunucusu**: Kısıtlı NAT/kurumsal ağlarda WebRTC ses ve video bağlantısı için `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` değişkenlerini tanımlayın.
- **GIF Arama**: GIF sekmesi için `TENOR_API_KEY` tanımlayın.
- **Web Push**: Arka plan bildirimleri için `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY` tanımlayın.
