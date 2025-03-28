const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const storage = require("electron-json-storage");
const https = require("https");
const http = require("http");
const fsPromises = require("fs/promises");

// Debug modunu kontrol et (--debug argümanı ile başlatılmışsa)
const isDebugMode = process.argv.includes("--debug");

// Aktif indirme işlemlerini takip etmek için global değişken
global.activeDownloads = new Map();

let mainWindow;

function createWindow() {
  // Uygulama veri dizinini ayarla - kalıcı ve cihaza özgü olması için userDataPath kullan
  const userDataPath = app.getPath("userData");
  storage.setDataPath(userDataPath);

  // Cihaz kimliği oluştur/kontrol et
  const deviceIdFile = path.join(userDataPath, "device-id.json");
  let deviceId;

  try {
    if (fs.existsSync(deviceIdFile)) {
      // Var olan cihaz kimliğini oku
      const deviceData = JSON.parse(fs.readFileSync(deviceIdFile, "utf8"));
      deviceId = deviceData.deviceId;
      console.log("Mevcut cihaz kimliği kullanılıyor:", deviceId);
    } else {
      // Yeni bir cihaz kimliği oluştur
      deviceId = `device_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 11)}`;
      fs.writeFileSync(
        deviceIdFile,
        JSON.stringify({ deviceId, createdAt: new Date().toISOString() })
      );
      console.log("Yeni cihaz kimliği oluşturuldu:", deviceId);
    }
  } catch (error) {
    console.error("Cihaz kimliği işlemi hatası:", error);
    // Hata durumunda varsayılan bir kimlik kullan
    deviceId = `device_fallback_${Date.now()}`;
  }

  // Global değişken olarak cihaz kimliğini kaydet
  global.deviceId = deviceId;

  // Log bilgileri
  console.log("Uygulama veri dizini:", userDataPath);
  console.log("Cihaz kimliği:", deviceId);
  console.log("Preload path:", path.join(__dirname, "preload.js"));
  console.log("HTML path:", path.join(__dirname, "../dist/index.html"));
  console.log("Debug mode:", isDebugMode);

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Derlenmiş HTML dosyasını yükle
  try {
    // Debug modunda debug.html yükle, normal modda index.html yükle
    const htmlFileName = isDebugMode ? "debug.html" : "index.html";

    // Paketlenmiş uygulama tespiti
    const isPackaged = app.isPackaged;
    let htmlPath;

    if (isPackaged) {
      // Paketlenmiş uygulamada
      htmlPath = path.join(
        process.resourcesPath,
        "app.asar",
        "dist",
        htmlFileName
      );
      console.log("Paketlenmiş uygulama, HTML path:", htmlPath);
    } else {
      // Geliştirme modunda
      htmlPath = path.join(__dirname, "../dist", htmlFileName);
      console.log("Geliştirme modu, HTML path:", htmlPath);
    }

    if (fs.existsSync(htmlPath)) {
      console.log(`HTML dosyası bulundu (${htmlFileName}):`, htmlPath);
      // HTML dosyasını yükle
      mainWindow.loadFile(htmlPath);
    } else {
      console.error(`HTML dosyası bulunamadı (${htmlFileName}):`, htmlPath);
      // Hata durumunda basit bir HTML göster
      mainWindow.loadURL(
        `data:text/html,<h1>Hata: ${htmlFileName} bulunamadı!</h1><p>Aranan konum: ${htmlPath}</p>`
      );
    }
  } catch (error) {
    console.error("HTML yükleme hatası:", error);
    mainWindow.loadURL(`data:text/html,<h1>Hata oluştu: ${error.message}</h1>`);
  }

  // Geliştirme araçlarını her zaman aç
  //mainWindow.webContents.openDevTools();

  // Hataları yakala
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      console.error("Sayfa yükleme hatası:", errorCode, errorDescription);
    }
  );

  // Hata ayıklama mesajlarını göster
  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      console.log(`Renderer: [${level}] ${message}`);
    }
  );
}

// Uygulama kapanmadan önce yarım kalan indirmeleri temizleyen fonksiyon
function cleanupDownloads() {
  try {
    console.log("Yarım kalan indirmeler temizleniyor...");
    if (global.activeDownloads.size === 0) {
      console.log("Aktif indirme bulunmuyor.");
      // GUI'ye bilgi gönder
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("downloads-cleanup", {
          status: "success",
          message: "Temizlenecek aktif indirme bulunmuyor.",
          count: 0,
        });
      }
      return;
    }

    console.log(
      `${global.activeDownloads.size} adet yarım kalan indirme temizlenecek.`
    );

    // Silinen dosyaların listesi
    const cleanedFiles = [];

    // Tüm aktif indirmelerin dosyalarını silme
    for (const [filePath, fileInfo] of global.activeDownloads.entries()) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          cleanedFiles.push({
            path: filePath,
            fileName: fileInfo.fileName,
            success: true,
          });
          console.log(`Yarım kalan dosya silindi: ${filePath}`);
        } else {
          cleanedFiles.push({
            path: filePath,
            fileName: fileInfo.fileName,
            success: false,
            reason: "not_found",
          });
          console.log(`Dosya zaten silinmiş: ${filePath}`);
        }
      } catch (error) {
        cleanedFiles.push({
          path: filePath,
          fileName: fileInfo.fileName,
          success: false,
          reason: "error",
          error: error.message,
        });
        console.error(`Dosya silme hatası (${filePath}):`, error.message);
      }
    }

    // GUI'ye temizleme sonuçlarını bildir
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("downloads-cleanup", {
        status: "success",
        message: `${global.activeDownloads.size} adet yarım kalan indirme temizlendi.`,
        count: global.activeDownloads.size,
        files: cleanedFiles,
      });
    }

    // Listeyi temizle
    global.activeDownloads.clear();
  } catch (error) {
    console.error("Temizleme hatası:", error);
    // GUI'ye hata bildir
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("downloads-cleanup", {
        status: "error",
        message: "Temizleme sırasında hata oluştu: " + error.message,
        error: error.message,
      });
    }
  }
}

// Uygulama kapanmadan önce yarım kalan indirmeleri temizle
app.on("before-quit", () => {
  console.log("Uygulama kapanıyor, temizlik yapılıyor...");
  cleanupDownloads();
});

// Uygulama hazır olduğunda penceremizi oluşturalım
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// M3U dosyası seçme işlemi
ipcMain.handle("select-m3u-file", async () => {
  try {
    console.log("select-m3u-file isteği alındı");
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "M3U Dosyaları", extensions: ["m3u", "m3u8"] },
        { name: "Tüm Dosyalar", extensions: ["*"] },
      ],
    });

    if (canceled) {
      console.log("Dosya seçimi iptal edildi");
      return null;
    }

    const selectedFilePath = filePaths[0];
    console.log("Seçilen dosya:", selectedFilePath);

    // Seçilen dosyayı saklama
    storage.set("lastM3uPath", selectedFilePath, (error) => {
      if (error) console.error("Dosya yolu kaydedilemedi", error);
    });

    // Dosya içeriğini okuma
    const content = fs.readFileSync(selectedFilePath, "utf8");
    return { path: selectedFilePath, content };
  } catch (error) {
    console.error("Dosya seçme hatası:", error);
    throw error;
  }
});

// Kayıt klasörü seçme işlemi
ipcMain.handle("select-download-folder", async () => {
  try {
    console.log("select-download-folder isteği alındı");
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });

    if (canceled) {
      console.log("Klasör seçimi iptal edildi");
      return null;
    }

    console.log("Seçilen klasör:", filePaths[0]);

    // Seçilen klasörü saklama
    storage.set("lastDownloadDir", filePaths[0], (error) => {
      if (error) console.error("Klasör yolu kaydedilemedi", error);
    });

    return filePaths[0];
  } catch (error) {
    console.error("Klasör seçme hatası:", error);
    throw error;
  }
});

// Kaydedilmiş ayarları alma
ipcMain.handle("get-saved-paths", async () => {
  console.log("get-saved-paths isteği alındı");
  return new Promise((resolve) => {
    storage.getMany(["lastM3uPath", "lastDownloadDir"], (error, data) => {
      if (error) {
        console.error("Kaydedilmiş yollar alınamadı", error);
        resolve({ lastM3uPath: null, lastDownloadDir: null });
      } else {
        console.log("Kaydedilmiş yollar alındı:", data);
        resolve(data);
      }
    });
  });
});

// İndirilen dosyaları kaydetme
ipcMain.handle("save-downloaded-files", async (event, downloadedFiles) => {
  console.log("save-downloaded-files isteği alındı");
  return new Promise((resolve) => {
    // Cihaz kimliğini içeren benzersiz bir depolama anahtarı kullan
    const storageKey = `downloadedFiles_${global.deviceId}`;

    storage.set(storageKey, downloadedFiles, (error) => {
      if (error) {
        console.error("İndirilen dosyalar kaydedilemedi", error);
        resolve({ success: false, error: error.message });
      } else {
        console.log("İndirilen dosyalar kaydedildi:", downloadedFiles);
        console.log("Depolama anahtarı:", storageKey);
        resolve({ success: true });
      }
    });
  });
});

// İndirilen dosyaları alma
ipcMain.handle("get-downloaded-files", async () => {
  console.log("get-downloaded-files isteği alındı");
  return new Promise((resolve) => {
    // Cihaz kimliğini içeren benzersiz bir depolama anahtarı kullan
    const storageKey = `downloadedFiles_${global.deviceId}`;

    storage.get(storageKey, (error, data) => {
      if (error) {
        console.error("İndirilen dosyalar alınamadı", error);
        resolve([]);
      } else {
        console.log("İndirilen dosyalar alındı:", data);
        console.log("Depolama anahtarı:", storageKey);
        // data boş veya null ise boş dizi döndür
        resolve(data || []);
      }
    });
  });
});

// İndirme işlemi
ipcMain.handle(
  "download-stream",
  async (
    event,
    { url, fileName, downloadDir, createFolders, streamInfo, forceOverwrite }
  ) => {
    console.log(`İndirme isteği: ${fileName}`);
    console.log(`URL: ${url}`);
    console.log(`İndirme klasörü: ${downloadDir}`);
    console.log(`Zorla üzerine yazma: ${forceOverwrite ? "Evet" : "Hayır"}`);

    return await downloadSingleStream(
      url,
      fileName,
      downloadDir,
      createFolders,
      streamInfo,
      forceOverwrite
    );
  }
);

// Tekli stream indirme fonksiyonu
async function downloadSingleStream(
  url,
  fileName,
  downloadDir,
  createFolders = false,
  streamInfo = null,
  forceOverwrite = false
) {
  console.log(`İndirme başlatılıyor - ${url}`);
  // Dosya yolu değişkenini fonksiyon seviyesinde tanımla
  let filePath = null;

  try {
    // URL'nin geçerli olduğundan emin ol
    try {
      // Boşlukları ve sorunlu karakterleri düzelt
      if (url.includes(" ")) {
        const originalUrl = url;
        url = url.replace(/ /g, "%20");
        console.log(`URL'deki boşluklar düzeltildi: ${originalUrl} -> ${url}`);
      }

      // URL'yi kontrol et
      new URL(url);
    } catch (urlError) {
      console.error("Geçersiz URL formatı:", urlError.message);
      // URL'yi encode etmeyi dene
      try {
        url = encodeURI(url);
        console.log(`URL encode edildi: ${url}`);
      } catch (encodeError) {
        console.error("URL encode hatası:", encodeError.message);
        throw new Error(`Geçersiz URL formatı: ${urlError.message}`);
      }
    }

    // Klasörleri oluştur
    if (createFolders) {
      await fsPromises.mkdir(downloadDir, { recursive: true });
    }

    // Dosya yolu
    filePath = path.join(downloadDir, fileName);
    console.log(`Hedef dosya: ${filePath}`);

    // Eğer forceOverwrite aktifse ve dosya zaten varsa, dosyayı sil
    if (forceOverwrite && fs.existsSync(filePath)) {
      console.log(
        `Dosya zaten var ve zorla üzerine yazma aktif. Siliniyor: ${filePath}`
      );
      try {
        fs.unlinkSync(filePath);
        console.log(`Mevcut dosya silindi: ${filePath}`);
      } catch (deleteError) {
        console.error(`Dosya silinirken hata oluştu: ${deleteError.message}`);
        // Bu hatayı tolere edebiliriz, bu nedenle devam ediyoruz
      }
    }

    // Aktif indirmeyi listeye ekle
    global.activeDownloads.set(filePath, {
      url,
      fileName,
      downloadDir,
      streamInfo,
      startTime: Date.now(),
    });

    // URL protokolünü kontrol et
    let currentUrl = url;
    const maxRedirects = 5; // Maksimum yönlendirme sayısı
    let redirectCount = 0;

    // Akış başlatma
    console.log(`${currentUrl} indirme başlatılıyor...`);

    // HTTP isteği için daha güçlü timeout ve yeniden deneme mantığı ekleyelim
    const maxRetries = 3;
    let retryCount = 0;
    let success = false;
    let responseError = null;
    let fileSize = 0;

    // İlerleme takibi için değişkenler
    let lastProgressUpdateTime = Date.now();
    let lastReceivedBytes = 0;
    let receivedBytes = 0;
    let totalBytes = 0;
    let lastProgressValue = 0;

    // Zorlu güncelleme zamanlayıcısı
    let forceUpdateTimer = null;

    // Sık aralıklarla ilerleme güncellemesi göndermek için timer
    const startForceProgressUpdates = () => {
      // Önceki timer varsa temizle
      if (forceUpdateTimer) {
        clearInterval(forceUpdateTimer);
      }

      // Her 1 saniyede bir ilerleme güncellemesi gönder
      forceUpdateTimer = setInterval(() => {
        // Son güncellemeden bu yana geçen süre
        const timeSinceLastUpdate = Date.now() - lastProgressUpdateTime;

        // Eğer 1 saniyeden fazla süre geçtiyse ve indirme devam ediyorsa zorla güncelleme gönder
        if (timeSinceLastUpdate > 1000 && receivedBytes > 0) {
          console.log("Zorla ilerleme güncellemesi gönderiliyor...");
          const progress = totalBytes ? receivedBytes / totalBytes : 0;

          // İlerleme durumunu sadece bir kez gönder
          if (progress !== lastProgressValue || timeSinceLastUpdate > 3000) {
            lastProgressValue = progress;
            // İlerleme bilgisini güncelle
            try {
              mainWindow.webContents.send("download-progress", {
                id: fileName,
                progress: progress,
                received: receivedBytes,
                total: totalBytes,
                forced: true, // Zorla gönderildiğini belirt
              });
            } catch (sendError) {
              console.error(
                "İlerleme bilgisi gönderme hatası:",
                sendError.message
              );
            }

            // Son güncelleme zamanını güncelle
            lastProgressUpdateTime = Date.now();
          }
        }
      }, 1000); // 1 saniye
    };

    // İndirme bittiğinde timer'ı temizle
    const stopForceProgressUpdates = () => {
      if (forceUpdateTimer) {
        clearInterval(forceUpdateTimer);
        forceUpdateTimer = null;
      }
    };

    while (retryCount < maxRetries && !success) {
      try {
        if (retryCount > 0) {
          console.log(`Yeniden deneme ${retryCount}/${maxRetries}...`);
          // Yeniden denemeler arasında kısa bir bekleme yapalım
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // Yönlendirme işlemini burada gerçekleştireceğiz
        let finalResponse = null;
        let currentRedirectUrl = currentUrl;
        redirectCount = 0;

        while (redirectCount < maxRedirects && !finalResponse) {
          try {
            // URL protokolünü her yönlendirmede kontrol et
            let urlObj;
            try {
              urlObj = new URL(currentRedirectUrl);
            } catch (urlError) {
              console.error("Geçersiz URL:", urlError.message);
              currentRedirectUrl = encodeURI(currentRedirectUrl);
              urlObj = new URL(currentRedirectUrl);
            }

            const isHttps = urlObj.protocol === "https:";
            const httpModule = isHttps ? https : http;
            console.log(
              `Protokol: ${urlObj.protocol} (${
                isHttps ? "HTTPS" : "HTTP"
              } kullanılacak)`
            );

            // HTTP isteğini oluştur
            const response = await new Promise((resolve, reject) => {
              console.log(
                `HTTP isteği (${
                  redirectCount > 0
                    ? "yönlendirme #" + redirectCount
                    : "ilk istek"
                }): ${currentRedirectUrl}`
              );

              // Node.js HTTP isteği için URL değil tam URL objesi kullan
              const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: "GET",
                timeout: 30000, // 30 saniye timeout
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
              };

              const request = httpModule.request(options, (response) => {
                resolve(response);
              });

              request.on("error", (err) => {
                console.error(
                  `İndirme isteği hatası (${retryCount + 1}. deneme):`,
                  err.message
                );
                reject(err);
              });

              request.on("timeout", () => {
                request.destroy();
                reject(new Error("İstek zaman aşımına uğradı"));
              });

              // İsteği sonlandır
              request.end();
            });

            // Yönlendirme kontrolü (3xx yanıt kodları)
            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              const location = response.headers.location;
              console.log(
                `Yönlendirme alındı: ${response.statusCode}, yeni URL: ${location}`
              );

              // Mutlak veya göreli URL kontrolü
              let redirectUrl = location;
              if (location.startsWith("/")) {
                // Göreli yol, mevcut host ile birleştir
                const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                redirectUrl = baseUrl + location;
              } else if (
                !location.startsWith("http://") &&
                !location.startsWith("https://")
              ) {
                // Base URL olmadan göreli path
                const basePath = urlObj.pathname.substring(
                  0,
                  urlObj.pathname.lastIndexOf("/") + 1
                );
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${basePath}${location}`;
              }

              console.log(`Yönlendirme URL'si: ${redirectUrl}`);

              // Yeni URL ile devam et
              currentRedirectUrl = redirectUrl;
              redirectCount++;

              // İsteği temizle
              response.destroy();

              // Maximum yönlendirme sayısı kontrolü
              if (redirectCount >= maxRedirects) {
                throw new Error(
                  `Çok fazla yönlendirme (maksimum ${maxRedirects})`
                );
              }

              continue;
            }

            // Başarısız durum kodu kontrolü
            if (response.statusCode !== 200) {
              throw new Error(`HTTP Hata Kodu: ${response.statusCode}`);
            }

            // Başarılı yanıt
            finalResponse = response;
          } catch (redirectError) {
            console.error("Yönlendirme hatası:", redirectError.message);
            throw redirectError;
          }
        }

        if (!finalResponse) {
          throw new Error("Geçerli bir HTTP yanıtı alınamadı");
        }

        // Dosya akışını oluşturalım
        const fileStream = fs.createWriteStream(filePath);

        // İlerleme takibi için değişkenler
        receivedBytes = 0;
        totalBytes = parseInt(finalResponse.headers["content-length"] || "0");
        lastProgressUpdateTime = Date.now();

        // Zorunlu ilerleme güncellemelerini başlat
        startForceProgressUpdates();

        // İlerleme olayını dinle
        finalResponse.on("data", (chunk) => {
          // Veri alındıkça ilerleme bilgisini güncelle
          receivedBytes += chunk.length;
          const now = Date.now();
          const progress = totalBytes ? receivedBytes / totalBytes : 0;
          const timeDiff = now - lastProgressUpdateTime;
          const byteDiff = receivedBytes - lastReceivedBytes;

          // İlerleme bilgisini düzenli aralıklarla güncelle
          // 200 ms veya 51200 bayt (50 KB) değişim olduğunda
          if (timeDiff > 200 || byteDiff > 51200) {
            // İlerleme bilgisini güncelle
            try {
              mainWindow.webContents.send("download-progress", {
                id: fileName,
                progress: progress,
                received: receivedBytes,
                total: totalBytes,
              });

              // Log dosya bilgileri ve ilerleme
              console.log(
                `İlerleme: ${fileName}, ${Math.round(
                  progress * 100
                )}%, ${receivedBytes}/${totalBytes} bayt`
              );

              // Son güncelleme zamanı ve bayt sayısını güncelle
              lastProgressUpdateTime = now;
              lastReceivedBytes = receivedBytes;
              lastProgressValue = progress;
            } catch (sendError) {
              console.error(
                "İlerleme bilgisi gönderme hatası:",
                sendError.message
              );
            }
          }
        });

        // Dosya akışı için hata ve sonlandırma olaylarını dinle
        fileStream.on("error", (err) => {
          console.error("Dosya yazma hatası:", err.message);
          stopForceProgressUpdates();
          throw err;
        });

        await new Promise((resolve, reject) => {
          finalResponse.pipe(fileStream);

          // Dosya akışı sonlandığında
          fileStream.on("finish", () => {
            stopForceProgressUpdates();
            fileSize = fs.statSync(filePath).size;
            console.log(`İndirme tamamlandı: ${filePath} (${fileSize} bytes)`);

            // Son bir ilerleme güncellemesi gönder (%100)
            try {
              mainWindow.webContents.send("download-progress", {
                id: fileName,
                progress: 1, // %100
                received: fileSize,
                total: fileSize,
                completed: true,
              });
            } catch (sendError) {
              console.error(
                "Son ilerleme bilgisi gönderme hatası:",
                sendError.message
              );
            }

            success = true;
            resolve();
          });

          // Hata olayını dinle
          fileStream.on("error", (err) => {
            stopForceProgressUpdates();
            reject(err);
          });

          finalResponse.on("error", (err) => {
            stopForceProgressUpdates();
            reject(err);
          });
        });

        // İndirme başarılı - döngüden çık
        break;
      } catch (error) {
        console.error(
          `İndirme hatası (deneme ${retryCount + 1}/${maxRetries}):`,
          error.message
        );
        stopForceProgressUpdates();
        responseError = error;
        retryCount++;

        // Eğer dosya varsa ve hata olmuşsa, tamamlanmamış dosyayı silelim
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Tamamlanmamış dosya silindi: ${filePath}`);
          }
        } catch (unlinkError) {
          console.error("Dosya silme hatası:", unlinkError.message);
        }

        // Son deneme değilse, yeniden deneyelim
        if (retryCount < maxRetries) {
          console.log(`Tekrar deneniyor (${retryCount}/${maxRetries})...`);
        }
      }
    }

    // İndirme sonucu
    if (success) {
      // İndirilen dosyaları kaydet
      if (streamInfo) {
        logDownloadedStream({
          ...streamInfo,
          filePath,
          fileSize,
          timestamp: Date.now(),
        });
      }

      // İndirme başarılı olduğu için aktif indirmelerden çıkar
      global.activeDownloads.delete(filePath);

      return { success: true, filePath, fileSize };
    } else {
      // Başarısız indirmeyi de listeden çıkar
      global.activeDownloads.delete(filePath);
      throw responseError || new Error("İndirme başarısız oldu");
    }
  } catch (error) {
    // Hata durumunda da listeden çıkar
    if (filePath) {
      global.activeDownloads.delete(filePath);
    }

    console.error(`İndirme hatası (${fileName}):`, error);
    return {
      success: false,
      error: error.message || "Bilinmeyen indirme hatası",
    };
  }
}

// İndirilen stream'leri loglama
function logDownloadedStream(streamInfo) {
  try {
    const userDataPath = app.getPath("userData");
    const logDir = path.join(userDataPath, "logs");

    // Log dizini yoksa oluştur
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Tarih bazlı log dosyası adı oluştur (YYYY-MM.log formatında)
    const now = new Date();
    const logFileName = `downloads_${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}.log`;
    const logFilePath = path.join(logDir, logFileName);

    // Log kaydını oluştur
    const logEntry = {
      streamId: streamInfo.id,
      title: streamInfo.title,
      url: streamInfo.url,
      filePath: streamInfo.filePath,
      fileSize: streamInfo.fileSize,
      downloadedAt: new Date().toISOString(),
      deviceId: global.deviceId,
    };

    // Log dosyasına ekle (her satır bir JSON objesi)
    fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + "\n", "utf8");

    console.log(`Log kaydı oluşturuldu: ${logFilePath}`);

    // Toplam indirme sayısını da güncelle
    updateDownloadStats(streamInfo);

    return true;
  } catch (error) {
    console.error("Log oluşturma hatası:", error);
    return false;
  }
}

// İndirme istatistiklerini güncelle
function updateDownloadStats(streamInfo) {
  try {
    const userDataPath = app.getPath("userData");
    const statsFilePath = path.join(userDataPath, "download_stats.json");

    // Mevcut istatistikleri oku veya yeni oluştur
    let stats = {};
    if (fs.existsSync(statsFilePath)) {
      stats = JSON.parse(fs.readFileSync(statsFilePath, "utf8"));
    }

    // İstatistikleri güncelle
    stats.deviceId = global.deviceId;
    stats.totalDownloads = (stats.totalDownloads || 0) + 1;
    stats.totalBytes = (stats.totalBytes || 0) + (streamInfo.fileSize || 0);
    stats.lastDownloadDate = new Date().toISOString();

    // Aylık istatistikler
    const yearMonth = `${new Date().getFullYear()}-${String(
      new Date().getMonth() + 1
    ).padStart(2, "0")}`;
    if (!stats.monthly) stats.monthly = {};
    if (!stats.monthly[yearMonth])
      stats.monthly[yearMonth] = { count: 0, bytes: 0 };

    stats.monthly[yearMonth].count += 1;
    stats.monthly[yearMonth].bytes += streamInfo.fileSize || 0;

    // İstatistikleri kaydet
    fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), "utf8");

    console.log("İndirme istatistikleri güncellendi");
  } catch (error) {
    console.error("İstatistik güncelleme hatası:", error);
  }
}

// İndirme loglarını alma (son 50 indirme)
ipcMain.handle("get-download-logs", async () => {
  console.log("get-download-logs isteği alındı");
  try {
    const userDataPath = app.getPath("userData");
    const logDir = path.join(userDataPath, "logs");

    if (!fs.existsSync(logDir)) {
      return [];
    }

    // Tüm log dosyalarını bul ve en yeniden eskiye sırala
    const logFiles = fs
      .readdirSync(logDir)
      .filter((file) => file.startsWith("downloads_") && file.endsWith(".log"))
      .sort()
      .reverse();

    const logs = [];

    // En son 50 kaydı almak için dosyaları oku
    for (const logFile of logFiles) {
      const filePath = path.join(logDir, logFile);
      const content = fs.readFileSync(filePath, "utf8");

      const entries = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            console.error("Log satırı ayrıştırılamadı:", line);
            return null;
          }
        })
        .filter((entry) => entry !== null);

      logs.push(...entries);

      // En son 50 log kaydıyla sınırla
      if (logs.length >= 50) {
        break;
      }
    }

    // Son 50 kayıt ile sınırla ve tarihe göre sırala
    return logs.slice(0, 50).sort((a, b) => {
      const dateA = new Date(a.downloadedAt);
      const dateB = new Date(b.downloadedAt);
      return dateB - dateA; // Yeniden eskiye sırala
    });
  } catch (error) {
    console.error("İndirme logları alınırken hata:", error);
    return [];
  }
});

// İndirme istatistiklerini alma
ipcMain.handle("get-download-stats", async () => {
  console.log("get-download-stats isteği alındı");
  try {
    const userDataPath = app.getPath("userData");
    const statsFilePath = path.join(userDataPath, "download_stats.json");

    if (!fs.existsSync(statsFilePath)) {
      return {
        deviceId: global.deviceId,
        totalDownloads: 0,
        totalBytes: 0,
        monthly: {},
      };
    }

    const stats = JSON.parse(fs.readFileSync(statsFilePath, "utf8"));
    return stats;
  } catch (error) {
    console.error("İndirme istatistikleri alınırken hata:", error);
    return {
      deviceId: global.deviceId,
      totalDownloads: 0,
      totalBytes: 0,
      monthly: {},
      error: error.message,
    };
  }
});

// Dosya varlığını ve boyutunu kontrol et
ipcMain.handle(
  "check-file-exists",
  async (event, { filePath, expectedSize }) => {
    try {
      console.log(`check-file-exists isteği alındı: ${filePath}`);
      console.log(`Beklenen boyut: ${expectedSize || "belirsiz"}`);

      if (!filePath || typeof filePath !== "string") {
        return { exists: false, reason: "Geçersiz dosya yolu" };
      }

      // Dosya var mı kontrol et
      if (!fs.existsSync(filePath)) {
        return { exists: false, reason: "Dosya bulunamadı" };
      }

      // Dosya stat bilgilerini al
      const stats = fs.statSync(filePath);

      // Eğer beklenen boyut belirtilmişse ve dosya boyutu eşleşmiyorsa
      if (expectedSize && stats.size !== expectedSize) {
        return {
          exists: true,
          match: false,
          fileSize: stats.size,
          reason: `Dosya boyutu eşleşmiyor (Mevcut: ${stats.size}, Beklenen: ${expectedSize})`,
        };
      }

      // Dosya var ve boyut kontrolü başarılı
      return {
        exists: true,
        match: true,
        fileSize: stats.size,
        lastModified: stats.mtime.toISOString(),
        reason: "Dosya mevcut ve boyut uyumlu",
      };
    } catch (error) {
      console.error("Dosya kontrolü hatası:", error);
      return {
        exists: false,
        error: error.message,
        reason: "Dosya kontrolü sırasında hata oluştu",
      };
    }
  }
);

// Log oluşturma API'si (React tarafından çağrılabilir)
ipcMain.handle("log-downloaded-stream", async (event, streamInfo) => {
  try {
    console.log(`log-downloaded-stream isteği alındı:`, streamInfo);

    if (!streamInfo || typeof streamInfo !== "object") {
      console.error("Geçersiz stream bilgisi:", streamInfo);
      return { success: false, error: "Geçersiz stream bilgisi" };
    }

    // Log oluştur
    const result = logDownloadedStream(streamInfo);

    return { success: result };
  } catch (error) {
    console.error("Log oluşturma hatası:", error);
    return { success: false, error: error.message };
  }
});
