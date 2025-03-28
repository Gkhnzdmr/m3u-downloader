const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

console.log("Preload script çalıştırılıyor...");

// İlerleme olayı için dinleyiciler
let progressListeners = {};
// İndirme temizleme olayları için dinleyiciler
let cleanupListeners = [];

// İndirme ilerleme durumunu dinle
ipcRenderer.on("download-progress", (event, data) => {
  // Debug: Konsola ilerleme
  console.log(`
    ==== PRELOAD: İLERLEME ALINDI ====
    ID: ${data.id}
    Progress: %${data.progress || 0}
    Received: ${data.received || 0} bayt
    Total: ${data.total || 0} bayt
    ================================
    `);
  // Kayıtlı tüm dinleyicileri çağır
  if (progressListeners[data.id]) {
    console.log(
      `${progressListeners[data.id].length} adet "${
        data.id
      }" dinleyicisine bilgi gönderiliyor`
    );
    progressListeners[data.id].forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.error(`İlerleme dinleyici hatası (${data.id}):`, err);
      }
    });
  } else {
    console.log(`"${data.id}" için kayıtlı dinleyici yok`);
  }

  // Genel dinleyicileri çağır
  if (progressListeners["all"]) {
    console.log(
      `${progressListeners["all"].length} adet "all" dinleyicisine bilgi gönderiliyor`
    );
    progressListeners["all"].forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.error(`Genel ilerleme dinleyici hatası:`, err);
      }
    });
  } else {
    console.log(`"all" için kayıtlı dinleyici yok`);
  }
});

// İndirme temizleme olayını dinle
ipcRenderer.on("downloads-cleanup", (event, data) => {
  console.log("İndirme temizleme olayı alındı:", data);

  // Kayıtlı tüm dinleyicileri çağır
  if (cleanupListeners.length > 0) {
    console.log(
      `${cleanupListeners.length} adet temizleme dinleyicisine bilgi gönderiliyor`
    );
    cleanupListeners.forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.error(`Temizleme dinleyici hatası:`, err);
      }
    });
  } else {
    console.log(`Temizleme için kayıtlı dinleyici yok`);
  }
});

// Electron API'lerini tarayıcı penceresine açıyoruz
contextBridge.exposeInMainWorld("electronAPI", {
  selectM3uFile: async () => {
    console.log("electronAPI.selectM3uFile çağrıldı");
    try {
      return await ipcRenderer.invoke("select-m3u-file");
    } catch (error) {
      console.error("select-m3u-file hatası:", error);
      throw error;
    }
  },
  selectDownloadFolder: async () => {
    console.log("electronAPI.selectDownloadFolder çağrıldı");
    try {
      return await ipcRenderer.invoke("select-download-folder");
    } catch (error) {
      console.error("select-download-folder hatası:", error);
      throw error;
    }
  },
  getSavedPaths: async () => {
    console.log("electronAPI.getSavedPaths çağrıldı");
    try {
      return await ipcRenderer.invoke("get-saved-paths");
    } catch (error) {
      console.error("get-saved-paths hatası:", error);
      throw error;
    }
  },
  downloadStream: async (params) => {
    console.log("electronAPI.downloadStream çağrıldı", params);
    try {
      // Parametre kontrolü
      if (!params || typeof params !== "object") {
        throw new Error(`Geçersiz parametreler: ${typeof params}`);
      }

      // Gerekli alanları kontrol et
      if (!params.url) {
        throw new Error("URL parametresi eksik");
      }

      if (!params.fileName) {
        throw new Error("Dosya adı parametresi eksik");
      }

      if (!params.downloadDir) {
        throw new Error("İndirme dizini parametresi eksik");
      }

      // İsteği gönder
      const result = await ipcRenderer.invoke("download-stream", params);

      // Sonuç kontrolü
      if (!result) {
        throw new Error("İndirme sonucu alınamadı");
      }

      return result;
    } catch (error) {
      console.error("download-stream hatası:", error);

      // Hatayı daha anlaşılır hale getir
      if (error instanceof Error) {
        throw error; // Zaten Error nesnesi ise doğrudan ilet
      } else if (typeof error === "object") {
        // Object.toString() kullanışlı olmadığından JSON'a çevir
        throw new Error(`İndirme hatası: ${JSON.stringify(error)}`);
      } else {
        throw new Error(`İndirme hatası: ${String(error)}`);
      }
    }
  },
  onDownloadProgress: (id, listener) => {
    console.log(`İndirme ilerleme dinleyicisi eklendi: ${id}`);
    if (!progressListeners[id]) {
      progressListeners[id] = [];
    }
    progressListeners[id].push(listener);

    // Temizleme fonksiyonu döndür
    return () => {
      console.log(`İndirme ilerleme dinleyicisi kaldırıldı: ${id}`);
      if (progressListeners[id]) {
        progressListeners[id] = progressListeners[id].filter(
          (l) => l !== listener
        );
      }
    };
  },
  readFile: (filePath) => {
    console.log("electronAPI.readFile çağrıldı", filePath);
    try {
      // Tip kontrolü yap
      if (typeof filePath !== "string") {
        console.error(
          "electronAPI.readFile: Dosya yolu string değil:",
          filePath
        );

        // Eğer bir obje ise, path özelliğini kullan
        if (filePath && typeof filePath === "object" && filePath.path) {
          filePath = filePath.path;
          console.log(
            "electronAPI.readFile: Düzeltilmiş dosya yolu:",
            filePath
          );
        } else {
          throw new TypeError('The "path" argument must be of type string');
        }
      }

      return fs.readFileSync(filePath, "utf8");
    } catch (error) {
      console.error("Dosya okuma hatası:", error);
      throw error;
    }
  },
  // Path yardımcıları
  pathUtils: {
    join: (...paths) => path.join(...paths),
    basename: (filePath, ext) => path.basename(filePath, ext),
    extname: (filePath) => path.extname(filePath),
    dirname: (filePath) => path.dirname(filePath),
  },
  saveDownloadedFiles: (downloadedFiles) =>
    ipcRenderer.invoke("save-downloaded-files", downloadedFiles),
  getDownloadedFiles: () => ipcRenderer.invoke("get-downloaded-files"),

  // İndirme loglarını alma (son 50 indirme)
  getDownloadLogs: () => ipcRenderer.invoke("get-download-logs"),

  // İndirme istatistiklerini alma
  getDownloadStats: () => ipcRenderer.invoke("get-download-stats"),

  // Dosya varlığını ve boyutunu kontrol et
  checkFileExists: (params) => ipcRenderer.invoke("check-file-exists", params),

  // İndirme loglarını oluştur
  logDownloadedStream: (streamInfo) =>
    ipcRenderer.invoke("log-downloaded-stream", streamInfo),

  // İndirme temizleme olayını dinle
  onDownloadsCleanup: (listener) => {
    console.log("İndirme temizleme dinleyicisi eklendi");
    cleanupListeners.push(listener);

    // Temizleme fonksiyonu döndür
    return () => {
      console.log("İndirme temizleme dinleyicisi kaldırıldı");
      cleanupListeners = cleanupListeners.filter((l) => l !== listener);
    };
  },

  // Video oynatma fonksiyonu
  playVideo: async (filePathOrUrl, isUrl = false) => {
    console.log(
      `electronAPI.playVideo çağrıldı: ${filePathOrUrl}, URL: ${isUrl}`
    );
    try {
      if (!filePathOrUrl) {
        throw new Error("Geçersiz dosya yolu veya URL");
      }

      return await ipcRenderer.invoke("play-video", filePathOrUrl, isUrl);
    } catch (error) {
      console.error("Video oynatma hatası:", error);
      throw error;
    }
  },
});

// Node.js API'lerini direkt olarak erişilebilir yap
contextBridge.exposeInMainWorld("nodeBridge", {
  fs: {
    readFileSync: (filePath, encoding) => {
      try {
        // Tip kontrolü yap
        if (typeof filePath !== "string") {
          console.error("fs.readFileSync: Dosya yolu string değil:", filePath);

          // Eğer bir obje ise, path özelliğini kullan
          if (filePath && typeof filePath === "object" && filePath.path) {
            filePath = filePath.path;
            console.log("fs.readFileSync: Düzeltilmiş dosya yolu:", filePath);
          } else {
            throw new TypeError('The "path" argument must be of type string');
          }
        }

        return fs.readFileSync(filePath, encoding);
      } catch (error) {
        console.error("fs.readFileSync hatası:", error);
        throw error;
      }
    },
  },
  path: {
    join: (...args) => path.join(...args),
  },
  process: {
    platform: process.platform,
  },
});

console.log("Preload script tamamlandı");
