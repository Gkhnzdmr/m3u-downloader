# M3U Dosya İndirici

Bu uygulama, M3U veya M3U8 dosyalarını yükleyip içerisindeki stream linklerini indirmenize olanak sağlar. Electron ve React kullanılarak geliştirilmiştir.

## Özellikler

- M3U/M3U8 dosyalarını yükleme ve ayrıştırma
- Stream bağlantılarını tablo halinde görüntüleme
- İstenilen stream'leri seçip indirme
- M3U dosyası ve indirme klasörü yollarını hatırlama

## Kurulum

```bash
# Bağımlılıkları yükleyin
npm install

# Uygulamayı başlatın
npm start
```

## Derleme

Uygulamayı yürütülebilir bir dosya olarak derlemek için:

```bash
npm run build
```

## Kullanım

1. "M3U Dosyası Seç" butonuna tıklayarak bir M3U dosyası seçin
2. "İndirme Klasörü Seç" butonuna tıklayarak dosyaların kaydedileceği klasörü seçin
3. İndirmek istediğiniz stream'leri tablodan seçin
4. "Seçilenleri İndir" butonuna tıklayarak indirme işlemini başlatın

## Teknolojiler

- React
- Electron
- Material UI
- Webpack
