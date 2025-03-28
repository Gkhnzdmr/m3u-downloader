const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const storage = require("electron-json-storage");

// Debug modunu kontrol et (--debug argümanı ile başlatılmışsa)
const isDebugMode = process.argv.includes("--debug");

let mainWindow;

function createWindow() {
  // Uygulama veri dizinini ayarla
  storage.setDataPath(app.getPath("userData"));

  // Log bilgileri
  console.log("Uygulama veri dizini:", app.getPath("userData"));
  console.log("Preload path:", path.join(__dirname, "preload.js"));
  console.log("HTML path:", path.join(__dirname, "../dist/index.html"));
  console.log("Debug mode:", isDebugMode);

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
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
    const htmlPath = path.join(__dirname, `../dist/${htmlFileName}`);

    if (fs.existsSync(htmlPath)) {
      console.log(`HTML dosyası bulundu (${htmlFileName}):`, htmlPath);
      // HTML dosyasını yükle
      mainWindow.loadFile(htmlPath);
    } else {
      console.error(`HTML dosyası bulunamadı (${htmlFileName}):`, htmlPath);
      // Hata durumunda basit bir HTML göster
      mainWindow.loadURL(
        `data:text/html,<h1>Hata: ${htmlFileName} bulunamadı!</h1>`
      );
    }
  } catch (error) {
    console.error("HTML yükleme hatası:", error);
    mainWindow.loadURL(`data:text/html,<h1>Hata oluştu: ${error.message}</h1>`);
  }

  // Geliştirme araçlarını her zaman aç
  mainWindow.webContents.openDevTools();

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

// Dosya indirme işlemi
ipcMain.handle(
  "download-stream",
  async (event, { url, fileName, downloadDir, createFolders }) => {
    try {
      console.log(`download-stream isteği alındı: ${fileName}`);
      console.log(`URL: ${url}`);
      console.log(`İndirme dizini: ${downloadDir}`);
      console.log(`Klasör oluştur: ${createFolders}`);

      // URL kontrolü
      if (!url || typeof url !== "string") {
        console.error("Geçersiz URL:", url);
        return {
          success: false,
          error: `Geçersiz URL: ${url ? JSON.stringify(url) : "URL boş"}`,
        };
      }

      // URL protokol kontrolü
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        console.error("Desteklenmeyen URL protokolü:", url);
        return {
          success: false,
          error: `Desteklenmeyen URL protokolü. URL http:// veya https:// ile başlamalıdır`,
        };
      }

      // Dosya yolu kontrolü
      if (!downloadDir || typeof downloadDir !== "string") {
        console.error("Geçersiz indirme dizini:", downloadDir);
        return {
          success: false,
          error: `Geçersiz indirme dizini: ${
            downloadDir ? JSON.stringify(downloadDir) : "Dizin boş"
          }`,
        };
      }

      // Dosya adı kontrolü
      if (!fileName || typeof fileName !== "string") {
        console.error("Geçersiz dosya adı:", fileName);
        return {
          success: false,
          error: `Geçersiz dosya adı: ${
            fileName ? JSON.stringify(fileName) : "Dosya adı boş"
          }`,
        };
      }

      // Klasör yolunu oluştur (eğer yoksa)
      try {
        if (createFolders && !fs.existsSync(downloadDir)) {
          console.log(`Klasör oluşturuluyor: ${downloadDir}`);

          // Dizin yolunun her seviyesini oluştur (recursive)
          fs.mkdirSync(downloadDir, { recursive: true });
          console.log(`Klasör başarıyla oluşturuldu: ${downloadDir}`);
        }
      } catch (err) {
        console.error(`Klasör oluşturma hatası: ${err.message}`);
        return {
          success: false,
          error: `Klasör oluşturulamadı: ${err.message}`,
        };
      }

      const filePath = path.join(downloadDir, fileName);

      // Dizin var mı kontrol et
      try {
        if (!fs.existsSync(downloadDir)) {
          console.error(`İndirme dizini bulunamadı: ${downloadDir}`);
          return {
            success: false,
            error: `İndirme dizini bulunamadı: ${downloadDir}`,
          };
        }

        // Dizine yazma izni var mı kontrol et
        fs.accessSync(downloadDir, fs.constants.W_OK);
      } catch (err) {
        console.error(`Dizin erişim hatası: ${err.message}`);
        return {
          success: false,
          error: `İndirme dizinine yazma erişimi yok: ${err.message}`,
        };
      }

      // Mevcut dosyayı kontrol et ve varsa sil
      if (fs.existsSync(filePath)) {
        console.log(`Dosya zaten var, siliniyor: ${filePath}`);
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(`Mevcut dosya silinemedi: ${err.message}`);
          return {
            success: false,
            error: `Mevcut dosya silinemedi: ${err.message}`,
          };
        }
      }

      return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);

        let receivedBytes = 0;
        let totalBytes = 0;

        // Yönlendirmeleri yönetmek için fonksiyon
        const handleRequest = (currentUrl, redirectCount = 0) => {
          // Maximum yönlendirme sayısı kontrolü
          if (redirectCount > 5) {
            const error = "Çok fazla yönlendirme (maksimum 5)";
            console.error(error);
            file.close();
            fs.unlinkSync(filePath);
            reject({ success: false, error });
            return;
          }

          console.log(
            `HTTP istek başlatılıyor (${
              redirectCount > 0 ? "yönlendirme #" + redirectCount : "ilk istek"
            }): ${currentUrl}`
          );

          const proto = currentUrl.startsWith("https") ? "https" : "http";
          const http = proto === "https" ? require("https") : require("http");

          const urlObj = new URL(currentUrl);

          const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
              Accept: "*/*",
            },
          };

          const request = http.request(options, (response) => {
            // Yönlendirme kontrolü (3xx yanıt kodları)
            if (
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              console.log(
                `Yönlendirme alındı: ${response.statusCode}, yeni URL: ${response.headers.location}`
              );

              // Yönlendirme URL'sini al
              let redirectUrl = response.headers.location;

              // Göreli URL'yi mutlak URL'ye dönüştür
              if (redirectUrl.startsWith("/")) {
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
              } else if (!redirectUrl.startsWith("http")) {
                // Base URL olmadan göreli path
                const basePath = urlObj.pathname.substring(
                  0,
                  urlObj.pathname.lastIndexOf("/") + 1
                );
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${basePath}${redirectUrl}`;
              }

              // İsteği temizle
              response.destroy();

              // Yeni URL'ye istek yap
              handleRequest(redirectUrl, redirectCount + 1);
              return;
            }

            // Hata yanıtı kontrolü
            if (response.statusCode !== 200) {
              const error = `Sunucu hatası: ${response.statusCode} ${response.statusMessage}`;
              console.error(error);
              file.close();
              fs.unlinkSync(filePath);
              reject({ success: false, error });
              return;
            }

            // Toplam dosya boyutunu al
            totalBytes = parseInt(response.headers["content-length"] || 0, 10);

            // Content-Type başlığından MIME türünü kontrol et
            const contentType = response.headers["content-type"] || "";
            console.log(`İçerik türü: ${contentType}`);

            // MIME türü doğru uzantı eşleşmesi
            const mimeToExtensionMap = {
              "video/mp4": ".mp4",
              "video/mpeg": ".mpg",
              "video/x-msvideo": ".avi",
              "video/quicktime": ".mov",
              "video/x-matroska": ".mkv",
              "application/octet-stream": "", // Özel uzantı gerektirmez, orijinal uzantıyı koru
              "video/x-flv": ".flv",
              "video/webm": ".webm",
              "video/x-ms-wmv": ".wmv",
              "video/ts": ".ts",
              "video/MP2T": ".ts",
              "application/x-mpegurl": ".m3u8",
              "video/3gpp": ".3gp",
              "audio/mpeg": ".mp3",
              "audio/mp4": ".m4a",
              "audio/aac": ".aac",
              "audio/ogg": ".ogg",
              "audio/wav": ".wav",
              "audio/webm": ".weba",
              "image/jpeg": ".jpg",
              "image/png": ".png",
              "image/gif": ".gif",
            };

            // Dosya uzantısını kontrol et
            const baseFileName = path.basename(
              fileName,
              path.extname(fileName)
            );
            let suggestedExtension = "";

            // MIME türünden uzantı öner
            for (const [mimeType, ext] of Object.entries(mimeToExtensionMap)) {
              if (contentType.toLowerCase().includes(mimeType.toLowerCase())) {
                suggestedExtension = ext;
                break;
              }
            }

            console.log(
              `İndirme başladı: ${fileName}, Toplam boyut: ${totalBytes} bayt`
            );

            // İlerlemeyi izle
            response.on("data", (chunk) => {
              receivedBytes += chunk.length;

              if (totalBytes > 0) {
                const progress = Math.round((receivedBytes / totalBytes) * 100);

                // Detaylı debug log'ları
                console.log(`
------ İLERLEME BİLGİSİ ------
Dosya: ${fileName}
Alınan: ${receivedBytes} bayt
Toplam: ${totalBytes} bayt
İlerleme: %${progress}
------------------------------
`);

                // İlerleme bilgisini gönder
                try {
                  // Her veri parçası alındığında ilerleme bilgisini gönder
                  const progressData = {
                    id: fileName,
                    progress,
                    received: receivedBytes,
                    total: totalBytes,
                  };

                  console.log(
                    `Progress gönderiliyor:`,
                    JSON.stringify(progressData)
                  );
                  mainWindow.webContents.send(
                    "download-progress",
                    progressData
                  );

                  // Debug: Konsola ilerleme bilgisini yazdır
                  if (progress % 10 === 0 || progress === 100) {
                    console.log(
                      `İndirme ilerleme: ${fileName}, %${progress} (${receivedBytes}/${totalBytes} bayt)`
                    );
                  }
                } catch (err) {
                  console.error("İlerleme gönderme hatası:", err);
                }
              } else {
                // Toplam boyut bilinmiyorsa sadece alınan bayt sayısını gönder
                try {
                  console.log(
                    `Belirsiz ilerleme. Alınan: ${receivedBytes} bayt`
                  );
                  mainWindow.webContents.send("download-progress", {
                    id: fileName,
                    progress: 0, // Belirsiz ilerleme
                    received: receivedBytes,
                    total: 0,
                  });
                } catch (err) {
                  console.error("İlerleme gönderme hatası:", err);
                }
              }
            });

            // Yanıtı dosyaya yaz
            response.pipe(file);

            // İndirme tamamlandığında işlenecek kod
            let isFinishHandled = false; // Finish olayının sadece bir kez işlenmesini sağlamak için

            // Önerilen bir uzantı varsa ve mevcut uzantıdan farklıysa
            if (
              suggestedExtension &&
              suggestedExtension !== path.extname(fileName)
            ) {
              console.log(
                `MIME türüne göre önerilen uzantı: ${suggestedExtension}, mevcut uzantı: ${path.extname(
                  fileName
                )}`
              );

              // Mevcut uzantı yoksa veya "bilinmeyen" bir uzantıysa veya .ts ise ve MIME türünden bir uzantı önerildiyse
              const currentExt = path.extname(fileName);
              if (
                !currentExt ||
                currentExt === ".bin" ||
                currentExt === ".dat" ||
                currentExt === ".ts"
              ) {
                // Dosyayı doğru uzantıyla yeniden adlandır
                const newFileName = baseFileName + suggestedExtension;
                const newFilePath = path.join(downloadDir, newFileName);

                // Dosya yazma işlemi devam ettiği için, mevcut dosya yolunu devam ettir
                // ama işlem bitince yeniden adlandır
                console.log(
                  `Dosya uzantısı değiştirilecek: ${fileName} -> ${newFileName}`
                );

                // İşlem sonunda yeniden adlandırmak için bilgiyi sakla
                const originalFilePath = filePath;
                const newFilePathFinal = newFilePath;

                // Dosya bitince yeniden adlandır
                file.on("finish", () => {
                  if (isFinishHandled) return;
                  isFinishHandled = true;

                  file.close();

                  try {
                    // Dosyayı yeni uzantıyla yeniden adlandır
                    fs.renameSync(originalFilePath, newFilePathFinal);
                    console.log(
                      `Dosya yeniden adlandırıldı: ${originalFilePath} -> ${newFilePathFinal}`
                    );

                    // Başarılı indirme sonucu döndür
                    if (
                      fs.existsSync(newFilePathFinal) &&
                      fs.statSync(newFilePathFinal).size > 0
                    ) {
                      resolve({
                        success: true,
                        filePath: newFilePathFinal,
                        fileSize: receivedBytes,
                      });
                    } else {
                      const error = "Dosya oluşturulamadı veya boş";
                      console.error(error);
                      try {
                        fs.unlinkSync(newFilePathFinal);
                      } catch {}
                      reject({ success: false, error });
                    }
                  } catch (renameErr) {
                    console.error(
                      `Dosya yeniden adlandırma hatası: ${renameErr.message}`
                    );

                    // Hata durumunda da orijinal dosyayı kontrol et
                    if (
                      fs.existsSync(originalFilePath) &&
                      fs.statSync(originalFilePath).size > 0
                    ) {
                      resolve({
                        success: true,
                        filePath: originalFilePath,
                        fileSize: receivedBytes,
                      });
                    } else {
                      const error = `Dosya işleme hatası: ${renameErr.message}`;
                      console.error(error);
                      try {
                        fs.unlinkSync(originalFilePath);
                      } catch {}
                      reject({ success: false, error });
                    }
                  }
                });
              }
            }

            // Standart finish olayı (eğer özel bir durum belirtilmediyse)
            file.on("finish", () => {
              if (isFinishHandled) return;
              isFinishHandled = true;

              file.close();
              console.log(
                `İndirme tamamlandı: ${fileName}, Boyut: ${receivedBytes} bayt`
              );

              // Dosyanın gerçekten oluşturulduğunu doğrula
              if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                resolve({
                  success: true,
                  filePath,
                  fileSize: receivedBytes,
                });
              } else {
                const error = "Dosya oluşturulamadı veya boş";
                console.error(error);
                try {
                  fs.unlinkSync(filePath);
                } catch {}
                reject({ success: false, error });
              }
            });

            response.on("error", (err) => {
              const error = `Veri alımı hatası: ${err.message}`;
              console.error(error);
              file.close();
              try {
                fs.unlinkSync(filePath);
              } catch {}
              reject({ success: false, error });
            });
          });

          request.on("error", (err) => {
            const error = `İndirme isteği hatası: ${err.message}`;
            console.error(error);
            file.close();
            try {
              fs.unlinkSync(filePath);
            } catch {}
            reject({ success: false, error });
          });

          // 30 saniye zaman aşımı
          request.setTimeout(30000, () => {
            const error = "İndirme zaman aşımına uğradı";
            console.error(error);
            request.abort();
            file.close();
            try {
              fs.unlinkSync(filePath);
            } catch {}
            reject({ success: false, error });
          });

          request.end();
        };

        // İlk isteği başlat
        handleRequest(url);

        // Dosya hatası dinleyicisi
        file.on("error", (err) => {
          const error = `Dosya yazma hatası: ${err.message}`;
          console.error(error);
          try {
            fs.unlinkSync(filePath);
          } catch {}
          reject({ success: false, error });
        });
      }).catch((error) => {
        console.error("İndirme promise hatası:", error);
        // Hata nesnesi mi yoksa string mi kontrolü
        if (typeof error === "object") {
          return error; // Zaten uygun formatta ise
        }
        return { success: false, error: String(error) };
      });
    } catch (error) {
      console.error(`İndirme genel hatası:`, error);
      return {
        success: false,
        error:
          typeof error === "string"
            ? error
            : error.message || JSON.stringify(error),
      };
    }
  }
);
