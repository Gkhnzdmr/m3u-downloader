# M3U Dosya İndirici

Bu uygulama, M3U veya M3U8 dosyalarını yükleyip içerisindeki stream linklerini indirmenize olanak sağlar. Electron ve React kullanılarak geliştirilmiştir.

## Özellikler

- M3U/M3U8 dosyalarını yükleme ve ayrıştırma
- Stream bağlantılarını tablo halinde görüntüleme
- İstenilen stream'leri seçip indirme
- İndirilen videoları doğrudan izleme
- Farklı video oynatıcı seçenekleri (Sistem, VLC, MPV)
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
npm i -g electron-builder
npm run build
```

## Kullanım

1. "M3U Dosyası Seç" butonuna tıklayarak bir M3U dosyası seçin
2. "İndirme Klasörü Seç" butonuna tıklayarak dosyaların kaydedileceği klasörü seçin
3. İndirmek istediğiniz stream'leri tablodan seçin
4. "Seçilenleri İndir" butonuna tıklayarak indirme işlemini başlatın
5. İndirilen videoları "İzle" butonuna tıklayarak açabilirsiniz

## Video Oynatma

İndirilen videoları izlemek için birkaç farklı seçenek sunulmaktadır:

- **Sistem Varsayılan Oynatıcısı**: İşletim sisteminizin varsayılan video oynatıcısını kullanır
- **VLC Player**: Eğer kuruluysa, VLC player ile videoları açabilirsiniz
- **MPV Player**: Ses ve video kalitesi için önerilen oynatıcı, kurulu değilse kurulum yönergeleri gösterilir
- **Dahili Oynatıcı**: Uygulama içi basit oynatıcı (ses sorunu olabilir)

### MPV Player Kurulumu

En iyi kullanıcı deneyimi için MPV Player kurmanızı öneririz:

**macOS**:

```bash
# Homebrew ile kurulum (önerilen)
brew install mpv

# Homebrew kurulu değilse, önce bunu kurun:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Windows**:

- [mpv.io/installation](https://mpv.io/installation/) adresinden MPV Player'ı indirip kurun

**Linux**:

```bash
# Ubuntu/Debian
sudo apt install mpv

# Fedora
sudo dnf install mpv

# Arch Linux
sudo pacman -S mpv
```

## Teknolojiler

- React
- Electron
- Material UI
- Webpack
