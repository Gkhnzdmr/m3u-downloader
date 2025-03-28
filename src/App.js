import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import FileOpenIcon from "@mui/icons-material/FileOpen";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useEffect, useReducer, useRef, useState } from "react";
import M3uParser from "./utils/m3uParser";

// Global değişkenleri konsola yazdır
console.log("Uygulama başlatılıyor...");
console.log("window.electronAPI:", !!window.electronAPI);
console.log("window.nodeBridge:", !!window.nodeBridge);

// Electron API'sine kolay erişim
const electronAPI = window.electronAPI;
const nodeBridge = window.nodeBridge;

// API yüklenmediyse hata mesajı ver
if (!electronAPI) {
  console.error("UYARI: ElectronAPI bulunamadı!");
}

// Path modülü yerine kullanılacak yardımcı fonksiyonlar
const pathUtils = electronAPI?.pathUtils || {
  join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
  basename: (filePath, ext) => {
    const base = filePath.split("/").pop();
    if (!ext) return base;
    return base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (filePath) => {
    const lastDotIndex = filePath.lastIndexOf(".");
    return lastDotIndex !== -1 ? filePath.slice(lastDotIndex) : "";
  },
};

function App() {
  const [m3uFilePath, setM3uFilePath] = useState("");
  const [downloadDir, setDownloadDir] = useState("");
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [currentDownloadingId, setCurrentDownloadingId] = useState(null);
  // İndirme kuyruğu
  const [downloadQueue, setDownloadQueue] = useState([]);
  // Toplu indirme işlemi sürüyor mu?
  const [batchDownloading, setBatchDownloading] = useState(false);

  // İndirme ilerleme durumu için state
  const [downloadProgress, setDownloadProgress] = useState({});

  // Zamanlayıcı için değer - her değiştiğinde otomatik render tetikler
  const [timerTick, setTimerTick] = useState(0);

  // İndirme başlangıç zamanları
  const [downloadStartTimes, setDownloadStartTimes] = useState({});

  // Debug info için ref
  const debugInfoRef = useRef({
    lastProgressTime: 0,
    receivedUpdates: 0,
    lastProgress: {},
  });

  // İndirme başarılı (tamamlanan) dosyalar
  const [downloadedFiles, setDownloadedFiles] = useState([]);

  // İndirme ilerleme dinleyici temizleme fonksiyonu ref'i
  const progressCleanupRef = useRef(null);

  // Sayfa değeri için ref (render'ı tetiklemek için)
  const renderTriggerRef = useRef(0);
  const [_, forceRender] = useReducer((x) => x + 1, 0);

  const forceUpdate = () => {
    renderTriggerRef.current = Date.now();
    // Reducer'ı tetikleyerek yeniden render yapılmasını sağla
    forceRender();
    // Ayrıca state güncelleme fonksiyonunu da çağır
    setDownloadProgress((prevState) => ({ ...prevState }));
  };

  // Sayfalama için state değişkenleri
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Arama için state
  const [searchQuery, setSearchQuery] = useState("");

  const [notification, setNotification] = useState({
    open: false,
    message: "",
    severity: "info",
  });

  useEffect(() => {
    // Kaydedilmiş ayarları al
    const loadSavedPaths = async () => {
      try {
        if (!electronAPI || !electronAPI.getSavedPaths) {
          throw new Error("getSavedPaths API bulunamadı");
        }

        const paths = await electronAPI.getSavedPaths();
        console.log("Kaydedilmiş yollar:", paths);

        const { lastM3uPath, lastDownloadDir } = paths || {};

        if (lastM3uPath) {
          console.log("Son kullanılan M3U dosya yolu:", lastM3uPath);
          // Önce state'i güncelle
          setM3uFilePath(lastM3uPath);

          // String kontrolü yap
          if (typeof lastM3uPath === "string") {
            // Dosyayı oku
            loadM3uFile(lastM3uPath);
          } else {
            console.error("lastM3uPath string formatında değil:", lastM3uPath);
          }
        }

        if (lastDownloadDir) {
          setDownloadDir(lastDownloadDir);
        }
      } catch (error) {
        console.error("Kaydedilmiş yollar yüklenirken hata:", error);
        setNotification({
          open: true,
          message: "Ayarlar yüklenemedi: " + error.message,
          severity: "error",
        });
      }
    };

    loadSavedPaths();
  }, []);

  const loadM3uFile = async (filePath) => {
    try {
      setLoading(true);

      let fileContent;
      if (filePath) {
        // Eğer filePath doğrudan sağlanmışsa, içeriği disk'ten oku
        try {
          // Tip kontrolü yap - filePath bir string olmalı
          if (typeof filePath !== "string") {
            console.error("Dosya yolu string değil:", filePath);

            // Eğer bir obje ise, path özelliğini kullan
            if (filePath && typeof filePath === "object" && filePath.path) {
              filePath = filePath.path;
              console.log("Düzeltilmiş dosya yolu:", filePath);
            } else {
              throw new Error("Geçersiz dosya yolu formatı");
            }
          }

          if (nodeBridge && nodeBridge.fs) {
            // nodeBridge üzerinden oku
            fileContent = nodeBridge.fs.readFileSync(filePath, "utf8");
          } else if (electronAPI && electronAPI.readFile) {
            // electronAPI üzerinden oku
            fileContent = await electronAPI.readFile(filePath);
          } else {
            throw new Error("Dosya okuma API bulunamadı");
          }
        } catch (error) {
          console.error("Dosya okuma hatası:", error);
          throw error;
        }
      } else {
        // Yeni dosya seç
        if (!electronAPI || !electronAPI.selectM3uFile) {
          throw new Error("Dosya seçme API bulunamadı");
        }

        const result = await electronAPI.selectM3uFile();
        if (!result) return;

        setM3uFilePath(result.path);
        fileContent = result.content;
      }

      if (!fileContent) {
        throw new Error("Dosya içeriği okunamadı");
      }

      // M3U dosyasını ayrıştır
      const parsedStreams = M3uParser.parse(fileContent);
      // Her stream için selected özelliğini ekle
      const streamsWithSelection = parsedStreams.map((stream) => ({
        ...stream,
        selected: false,
      }));

      // Streams durumunu güncelle
      setStreams(streamsWithSelection);

      setNotification({
        open: true,
        message: `${parsedStreams.length} adet stream yüklendi.`,
        severity: "success",
      });

      // Eğer indirme klasörü seçildiyse, var olan dosyaları kontrol et
      if (downloadDir) {
        setTimeout(() => checkExistingFiles(downloadDir), 0);
      }
    } catch (error) {
      console.error("M3U dosyası yüklenemedi:", error);
      setNotification({
        open: true,
        message: "M3U dosyası yüklenemedi: " + error.message,
        severity: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectDownloadFolder = async () => {
    try {
      if (!electronAPI || !electronAPI.selectDownloadFolder) {
        throw new Error("Klasör seçme API bulunamadı");
      }

      const folderPath = await electronAPI.selectDownloadFolder();
      if (folderPath) {
        setDownloadDir(folderPath);

        // Eğer stream'ler yüklenmişse, klasör değişikliğinde de kontrol et
        if (streams.length > 0) {
          setTimeout(() => checkExistingFiles(folderPath), 0);
        }
      }
    } catch (error) {
      console.error("Klasör seçilemedi:", error);
      setNotification({
        open: true,
        message: "Klasör seçilemedi: " + error.message,
        severity: "error",
      });
    }
  };

  // İndirme klasöründe var olan dosyaları kontrol et
  const checkExistingFiles = async (targetDir) => {
    if (
      !targetDir ||
      !electronAPI ||
      !electronAPI.checkFileExists ||
      streams.length === 0
    ) {
      return;
    }

    console.log("İndirme klasöründe var olan dosyaları kontrol ediyorum...");
    setLoading(true);

    try {
      // Var olan indirilen dosyalar listesini koru
      const existingDownloadedFiles = [...downloadedFiles];
      let newDownloadedFiles = [...existingDownloadedFiles];
      let autoMarkedFiles = 0;

      // Her stream için dosya kontrolü yap
      const checkPromises = streams.map(async (stream) => {
        try {
          // URL kontrolü
          if (!stream.url) return;

          // Dosya adını ve klasörü belirle
          const safeTitle = (stream.title || `stream_${stream.id}`).replace(
            /[\\/:*?"<>|]/g,
            "_"
          );

          // Uzantıyı belirle
          let fileExtension = ".ts"; // Varsayılan
          try {
            const urlObj = new URL(stream.url);
            const pathname = urlObj.pathname;
            if (pathname && pathname.includes(".")) {
              const lastPartOfPath = pathname.split("/").pop();
              if (lastPartOfPath && lastPartOfPath.includes(".")) {
                const ext = "." + lastPartOfPath.split(".").pop();
                if (/^\.\w{1,5}$/.test(ext)) {
                  fileExtension = ext;
                }
              }
            }
          } catch (e) {
            // URL'den uzantı çıkarılamadı, varsayılanı kullan
          }

          // Dizi/Film adını ve klasörü belirle
          let seriesName = "";
          let seasonFolder = "";
          let originalFileName = safeTitle;

          const seasonEpisodeRegex =
            /^(.*?)(?:\s+|_+)(S|Sezon\s*)(\d+)[\s_-]*(E|Bölüm\s*)(\d+)/i;
          const match = safeTitle.match(seasonEpisodeRegex);

          if (match) {
            seriesName = match[1].trim();
            const seasonNumber = parseInt(match[3], 10);
            seasonFolder = `S${seasonNumber.toString().padStart(2, "0")}`;
          } else {
            const nameParts = safeTitle.split(/\s+/);
            seriesName = nameParts.length > 0 ? nameParts[0] : "Bilinmeyen";
          }

          seriesName = seriesName.replace(/[\\/:*?"<>|]/g, "_").trim();
          if (!seriesName) seriesName = "Bilinmeyen";

          // Klasör yolları oluştur
          const seriesFolderPath = pathUtils.join(targetDir, seriesName);
          let targetFolderPath;
          if (seasonFolder) {
            targetFolderPath = pathUtils.join(seriesFolderPath, seasonFolder);
          } else {
            targetFolderPath = seriesFolderPath;
          }

          const fileName = `${originalFileName}${fileExtension}`;
          const fullFilePath = pathUtils.join(targetFolderPath, fileName);

          // Dosya kontrolü yap
          const fileCheck = await electronAPI.checkFileExists({
            filePath: fullFilePath,
            expectedSize: null, // Boyut kontrolünü atla
          });

          // Eğer dosya varsa ve boyut uyumluysa
          if (fileCheck.exists && fileCheck.match) {
            // Henüz indirildi olarak işaretlenmediyse ekle
            if (!existingDownloadedFiles.includes(stream.id)) {
              newDownloadedFiles.push(stream.id);
              autoMarkedFiles++;

              // Log'a kaydedebiliriz (opsiyonel)
              if (electronAPI.logDownloadedStream) {
                await electronAPI.logDownloadedStream({
                  id: stream.id,
                  title: stream.title || fileName,
                  url: stream.url,
                  filePath: fullFilePath,
                  fileSize: fileCheck.fileSize,
                  downloadedAt: new Date().toISOString(),
                  autoDetected: true,
                });
              }
            }
          }
        } catch (error) {
          console.error(`Stream kontrol hatası (${stream.id}):`, error);
        }
      });

      // Tüm kontroller tamamlandığında
      await Promise.all(checkPromises);

      // Yeni dosya listesini güncelle
      if (newDownloadedFiles.length > existingDownloadedFiles.length) {
        setDownloadedFiles(newDownloadedFiles);
        console.log(
          `${autoMarkedFiles} adet dosya otomatik olarak indirildi olarak işaretlendi.`
        );

        // Kullanıcıya bildirelim
        if (autoMarkedFiles > 0) {
          setNotification({
            open: true,
            message: `${autoMarkedFiles} adet dosya zaten indirme klasöründe mevcut olduğu için otomatik olarak işaretlendi.`,
            severity: "info",
          });
        }
      }
    } catch (error) {
      console.error("Dosya kontrolü sırasında hata:", error);
    } finally {
      setLoading(false);
    }
  };

  // İndirme işlemi başladığında ilerleme dinleyicisini kaydet
  useEffect(() => {
    if (electronAPI && electronAPI.onDownloadProgress && downloading) {
      // Önceki dinleyici temizleme işlevi varsa çalıştır
      if (progressCleanupRef.current) {
        progressCleanupRef.current();
      }

      console.log("İndirme ilerleme dinleyicisi kaydediliyor...");

      // İlerleme state'i sıfırla
      setDownloadProgress({});
      debugInfoRef.current = {
        lastProgressTime: Date.now(),
        receivedUpdates: 0,
        lastProgress: {},
      };

      // Yeni bir dinleyici ekle
      progressCleanupRef.current = electronAPI.onDownloadProgress(
        "all",
        (data) => {
          const now = Date.now();
          debugInfoRef.current.receivedUpdates++;
          debugInfoRef.current.lastProgressTime = now;
          // State güncelleme - doğrudan ve senkron olarak
          console.log(`
            ----- REACT: İLERLEME BİLGİSİ ALINDI -----
            ID: ${data.id}
            Progress: %${Math.round((data.progress || 0) * 100)}
            Received: ${data.received || 0} bayt
            Total: ${data.total || 0} bayt
            Toplam alınan güncelleme: ${debugInfoRef.current.receivedUpdates}
            ----------------------------------------
            `);

          // Stream ID ve dosya adı arasındaki eşleştirme problemi çözümü
          const streamId =
            streams.find((s) => s.id === currentDownloadingId)?.id || data.id;

          // Şu anki indirmeye ait ilerleme ise güncelle
          if (streamId === currentDownloadingId) {
            setDownloadProgress((prev) => {
              const newState = { ...prev };
              // Mevcut indirmenin ilerleme bilgisini güncelle
              newState[streamId] = {
                progress: data.progress || 0,
                received: data.received || 0,
                total: data.total || 0,
                timestamp: now,
              };

              return newState;
            });

            // UI'nin güncellenmesini zorla
            forceUpdate();
          }
        }
      );

      // Her 1 saniyede bir güncelleme durumunu kontrol et
      const intervalId = setInterval(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - debugInfoRef.current.lastProgressTime;

        // Son güncelleme üzerinden 5 saniyeden fazla geçtiyse log
        if (timeSinceLastUpdate > 5000) {
          console.log(
            `Son güncelleme üzerinden geçen süre: ${timeSinceLastUpdate}ms`
          );
        }
      }, 1000);

      return () => {
        // Bileşen çözüldüğünde dinleyiciyi ve interval'i temizle
        if (progressCleanupRef.current) {
          console.log("İndirme ilerleme dinleyicisi temizleniyor...");
          progressCleanupRef.current();
          progressCleanupRef.current = null;
        }
        clearInterval(intervalId);
      };
    }
  }, [downloading, electronAPI, currentDownloadingId, streams]);

  // İndirilen dosyalar değiştiğinde, bu bilgiyi kalıcı olarak kaydet
  useEffect(() => {
    const saveDownloadedFilesData = async () => {
      if (
        !downloadedFiles.length ||
        !electronAPI ||
        !electronAPI.saveDownloadedFiles
      )
        return;

      console.log("İndirilen dosyalar kaydediliyor:", downloadedFiles);
      try {
        await electronAPI.saveDownloadedFiles(downloadedFiles);
      } catch (error) {
        console.error("İndirilen dosyaları kaydetme hatası:", error);
      }
    };

    saveDownloadedFilesData();
  }, [downloadedFiles]);

  // Uygulama başlangıcında kaydedilmiş indirilen dosyaları yükle
  useEffect(() => {
    const loadDownloadedFiles = async () => {
      if (!electronAPI || !electronAPI.getDownloadedFiles) {
        console.error("getDownloadedFiles API bulunamadı");
        return;
      }

      try {
        const savedFiles = await electronAPI.getDownloadedFiles();
        console.log("Kaydedilmiş indirilen dosyalar:", savedFiles);

        if (Array.isArray(savedFiles) && savedFiles.length > 0) {
          setDownloadedFiles(savedFiles);
        }
      } catch (error) {
        console.error("İndirilen dosyaları yükleme hatası:", error);
      }
    };

    loadDownloadedFiles();
  }, []);

  // Zaman göstergesi yerine timer state ekliyorum
  useEffect(() => {
    // İndirme işlemi devam ediyorsa, her saniye timerTick'i artır
    let timerInterval;

    if (downloading) {
      console.log("Zamanlayıcı başlatıldı");
      timerInterval = setInterval(() => {
        setTimerTick((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (timerInterval) {
        console.log("Zamanlayıcı durduruldu");
        clearInterval(timerInterval);
      }
    };
  }, [downloading]);

  // Tekli indirme işlemi
  const downloadSingleStream = async (stream) => {
    if (!downloadDir) {
      setNotification({
        open: true,
        message: "Lütfen önce indirme klasörünü seçin.",
        severity: "warning",
      });
      return;
    }

    try {
      if (!electronAPI || !electronAPI.downloadStream) {
        throw new Error("İndirme API bulunamadı");
      }

      // İndirme öncesi state'leri güncelle - bu kısmı daha yukarı taşıdık
      setCurrentDownloadingId(stream.id);
      setDownloading(true);

      // İndirme başlangıç zamanını kaydet
      setDownloadStartTimes((prev) => ({
        ...prev,
        [stream.id]: Date.now(),
      }));

      console.log(`${stream.id} için indirme başlatılıyor...`);

      // İlerleme bilgisini başlat
      setDownloadProgress((prev) => {
        const newState = { ...prev };
        newState[stream.id] = {
          progress: 0,
          received: 0,
          total: 0,
          timestamp: Date.now(),
        };
        return newState;
      });

      // Force render
      forceUpdate();

      // URL temizle ve kodla
      let streamUrl = stream.url.trim();

      // URL'nin geçerli olduğunu kontrol et
      if (
        !streamUrl.startsWith("http://") &&
        !streamUrl.startsWith("https://")
      ) {
        throw new Error(
          "Geçersiz URL formatı. URL 'http://' veya 'https://' ile başlamalıdır"
        );
      }

      // Karakter kodlaması sorunlarını önlemek için URL'yi encode et
      // Ancak zaten encode edilmiş URL'yi tekrar encode etme
      try {
        // URL nesnesini oluşturarak test et
        new URL(streamUrl);
      } catch (e) {
        // URL geçerli bir URL değilse, özel karakterleri encode et
        console.warn("URL düzeltiliyor:", streamUrl);
        // Sadece özel karakterleri encode et, zaten encode edilmiş kısımları değil
        streamUrl = encodeURI(streamUrl);
      }

      // URL'den uzantıyı çıkar
      let fileExtension = ".ts"; // Varsayılan uzantı
      try {
        const urlObj = new URL(streamUrl);
        const pathname = urlObj.pathname;

        // Dosya adını ve uzantısını ayır
        if (pathname && pathname.includes(".")) {
          const lastPartOfPath = pathname.split("/").pop();
          if (lastPartOfPath && lastPartOfPath.includes(".")) {
            const ext = "." + lastPartOfPath.split(".").pop();
            // Geçerli uzantı kontrolü (1-5 karakter, sadece harfler, rakamlar)
            if (/^\.\w{1,5}$/.test(ext)) {
              fileExtension = ext;
              console.log(`Uzantı tespit edildi: ${fileExtension}`);
            }
          }
        }
      } catch (e) {
        console.warn("URL'den uzantı çıkarılamadı:", e.message);
      }

      // Dosya adından geçersiz karakterleri temizle
      const safeTitle = (stream.title || `stream_${stream.id}`).replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

      // Dosya adından dizi/film adı, sezon ve bölüm bilgilerini çıkar
      let seriesName = "";
      let seasonFolder = "";
      let originalFileName = safeTitle;

      // Dizi/Film adı ve sezon/bölüm bilgilerini ayıkla
      // "Dizi Adı S01E01", "Dizi Adı S01-E01", "Dizi Adı Sezon 1 Bölüm 1" gibi formatları tanıma
      const seasonEpisodeRegex =
        /^(.*?)(?:\s+|_+)(S|Sezon\s*)(\d+)[\s_-]*(E|Bölüm\s*)(\d+)/i;
      const match = safeTitle.match(seasonEpisodeRegex);

      if (match) {
        // Regex eşleşmelerini al
        seriesName = match[1].trim();
        const seasonNumber = parseInt(match[3], 10);
        const episodeNumber = parseInt(match[5], 10);

        // Sezon klasörü oluştur (S01, S02 formatında)
        seasonFolder = `S${seasonNumber.toString().padStart(2, "0")}`;

        console.log(
          `Dizi: "${seriesName}", Sezon: ${seasonNumber}, Bölüm: ${episodeNumber}`
        );
      } else {
        // Eğer sezon/bölüm formatı bulunamazsa, sadece ilk kelimeyi dizi adı olarak kullan
        const nameParts = safeTitle.split(/\s+/);
        if (nameParts.length > 0) {
          seriesName = nameParts[0];
        } else {
          seriesName = "Bilinmeyen";
        }
      }

      // Boşlukları ve özel karakterleri temizle
      seriesName = seriesName.replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!seriesName) seriesName = "Bilinmeyen";

      // Klasör yolları oluştur
      const seriesFolderPath = pathUtils.join(downloadDir, seriesName);

      // Tam klasör yolu (sezon klasörü varsa ekle, yoksa sadece dizi klasörü)
      let targetFolderPath;
      if (seasonFolder) {
        targetFolderPath = pathUtils.join(seriesFolderPath, seasonFolder);
      } else {
        targetFolderPath = seriesFolderPath;
      }

      // Dosya adı
      const fileName = `${originalFileName}${fileExtension}`;

      console.log(`İndirme hedefi: ${targetFolderPath}/${fileName}`);

      // İndirme parametrelerini oluştur
      const downloadParams = {
        url: streamUrl,
        fileName: fileName,
        downloadDir: targetFolderPath,
        createFolders: true, // Klasörleri oluştur
        streamInfo: {
          id: stream.id,
          title: stream.title || safeTitle,
          url: streamUrl,
        },
        // Dosya varsa sil (yeniden indirme durumunda)
        forceOverwrite: downloadedFiles.includes(stream.id),
      };

      console.log("İndirme başlatılıyor:", downloadParams);

      // İndirmeyi başlat
      const result = await electronAPI.downloadStream(downloadParams);

      // İndirme sonucunu kontrol et
      if (result.success) {
        console.log(`İndirme tamamlandı: ${result.filePath}`);
        // İndirilen dosyaları listeye ekle
        if (!downloadedFiles.includes(stream.id)) {
          setDownloadedFiles((prev) => [...prev, stream.id]);
        }
        // Bildirim göster
        setNotification({
          open: true,
          message: `"${stream.title || stream.id}" başarıyla indirildi.`,
          severity: "success",
        });
      } else {
        // İndirme başarısız
        console.error("İndirme başarısız:", result.error);
        throw new Error(result.error || "İndirme işlemi başarısız oldu");
      }
    } catch (error) {
      console.error(`${stream.id} indirme hatası:`, error);
      setNotification({
        open: true,
        message: `İndirme sırasında hata oluştu: ${error.message}`,
        severity: "error",
      });
    } finally {
      // İndirme state'lerini sıfırla
      setDownloading(false);
      setCurrentDownloadingId(null);
    }
  };

  // Dosya boyutunu formatlayan yardımcı fonksiyon
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";

    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  // Sayfa değişimi işleyicisi
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  // Sayfa başına satır sayısı değişimi işleyicisi
  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Arama işleyicisi
  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setPage(0); // Arama yapıldığında ilk sayfaya dön
  };

  // Arama filtresi uygula
  const filteredStreams = streams.filter((stream) => {
    const searchTerm = searchQuery.toLowerCase();
    return (
      (stream.title && stream.title.toLowerCase().includes(searchTerm)) ||
      (stream.url && stream.url.toLowerCase().includes(searchTerm))
    );
  });

  // Geçerli sayfadaki satırları al
  const currentPageRows = filteredStreams.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  const closeNotification = () => {
    setNotification({ ...notification, open: false });
  };

  // Checkboxları işleyen fonksiyonlar
  const handleSelectStream = (id) => {
    setStreams((prevStreams) =>
      prevStreams.map((stream) =>
        stream.id === id ? { ...stream, selected: !stream.selected } : stream
      )
    );
  };

  const handleSelectAll = (event) => {
    const checked = event.target.checked;

    // Filtrelenmiş ID'leri al
    const filteredIds = searchQuery
      ? filteredStreams.map((stream) => stream.id)
      : streams.map((stream) => stream.id);

    // Tüm stream'leri güncelle, sadece filtrelenmiş ID'lerdeki seçim değişecek
    setStreams((prevStreams) =>
      prevStreams.map((stream) => ({
        ...stream,
        selected: filteredIds.includes(stream.id) ? checked : stream.selected,
      }))
    );
  };

  // Seçili stream'leri sırasıyla indirme işlemi
  const downloadSelectedStreams = async () => {
    if (!downloadDir) {
      setNotification({
        open: true,
        message: "Lütfen önce indirme klasörünü seçin.",
        severity: "warning",
      });
      return;
    }

    // Seçili stream ID'lerini al
    const selectedStreamIds = streams
      .filter((stream) => stream.selected)
      .map((stream) => stream.id);

    if (selectedStreamIds.length === 0) {
      setNotification({
        open: true,
        message: "Lütfen en az bir stream seçin.",
        severity: "warning",
      });
      return;
    }

    // Eğer zaten indirme yapılıyorsa kuyruk işlemini başlatma
    if (downloading) {
      setNotification({
        open: true,
        message: "Şu anda bir indirme işlemi devam ediyor. Lütfen bekleyin.",
        severity: "warning",
      });
      return;
    }

    // Seçili stream'leri kuyruğa ekle
    setDownloadQueue(selectedStreamIds);
    setBatchDownloading(true);

    // İlk dosyanın indirme işlemini hemen başlat
    const nextStreamId = selectedStreamIds[0];
    const streamToDownload = streams.find((s) => s.id === nextStreamId);
    if (streamToDownload) {
      console.log(
        `Toplu indirme başlatılıyor. İlk dosya: ${
          streamToDownload.title || streamToDownload.id
        }`
      );
      try {
        // Kuyruktaki ilk öğeyi çıkar
        setDownloadQueue(selectedStreamIds.slice(1));
        // İndirme işlemini başlat
        await downloadSingleStream(streamToDownload);
      } catch (error) {
        console.error("İlk dosya indirme hatası:", error);
        setNotification({
          open: true,
          message: `İndirme sırasında hata oluştu: ${error.message}`,
          severity: "error",
        });
      }
    }
  };

  // Kuyruktaki bir sonraki stream'i indir
  useEffect(() => {
    const downloadNextInQueue = async () => {
      // İndirme işlemi devam ediyorsa veya toplu indirme modu aktif değilse çık
      if (downloading || !batchDownloading) return;

      // Kuyrukta eleman varsa
      if (downloadQueue.length > 0) {
        const nextStreamId = downloadQueue[0];
        const streamToDownload = streams.find((s) => s.id === nextStreamId);

        if (streamToDownload) {
          console.log(
            `Kuyruktan sonraki dosya indiriliyor: ${
              streamToDownload.title || streamToDownload.id
            }`
          );
          console.log(`Kalan dosya sayısı: ${downloadQueue.length - 1}`);

          try {
            // Kuyruktaki ilk öğeyi çıkar
            setDownloadQueue((prevQueue) => prevQueue.slice(1));
            // İndirme işlemini başlat
            await downloadSingleStream(streamToDownload);
          } catch (error) {
            console.error("Sıradaki dosya indirme hatası:", error);
            setNotification({
              open: true,
              message: `Sıradaki dosya indirilirken hata oluştu: ${error.message}`,
              severity: "error",
            });

            // Hata durumunda bir sonraki dosyaya geç (indirme durumunu sıfırla)
            setDownloading(false);
            setCurrentDownloadingId(null);
          }
        }
      } else if (downloadQueue.length === 0) {
        // Tüm indirme işlemleri tamamlandığında
        console.log("Tüm dosyalar indirildi, toplu indirme tamamlandı.");
        setBatchDownloading(false);

        // Tüm seçili stream'lerin checkbox'larını kaldır
        setStreams((prevStreams) =>
          prevStreams.map((stream) => ({
            ...stream,
            selected: false,
          }))
        );

        setNotification({
          open: true,
          message: "Tüm seçili stream'lerin indirme işlemi tamamlandı.",
          severity: "success",
        });
      }
    };

    // İndirme işlemi bittiğinde bir sonraki indirmeyi başlat
    if (!downloading && batchDownloading) {
      downloadNextInQueue();
    }
  }, [downloading, batchDownloading, downloadQueue, streams]);

  // Tekrar indirme fonksiyonu
  const redownloadStream = async (stream) => {
    try {
      // Kullanıcıya onay sorusu göster
      if (
        !window.confirm(
          `"${
            stream.title || stream.id
          }" dosyası daha önce indirilmiş. Yeniden indirmek istediğinize emin misiniz? Mevcut dosya silinecek.`
        )
      ) {
        console.log("Yeniden indirme işlemi kullanıcı tarafından iptal edildi");
        return;
      }

      // Fiziksel olarak varsa indirilen dosyayı sil
      const fileExtension = pathUtils.extname(stream.url) || ".ts";
      const safeTitle = (stream.title || `stream_${stream.id}`).replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

      // Dosya adından dizi/film adı ve sezon bilgilerini çıkar
      const seasonEpisodeRegex =
        /^(.*?)(?:\s+|_+)(S|Sezon\s*)(\d+)[\s_-]*(E|Bölüm\s*)(\d+)/i;
      const match = safeTitle.match(seasonEpisodeRegex);

      let seriesName = "";
      let seasonFolder = "";

      if (match) {
        seriesName = match[1].trim();
        const seasonNumber = parseInt(match[3], 10);
        seasonFolder = `S${seasonNumber.toString().padStart(2, "0")}`;
      } else {
        const nameParts = safeTitle.split(/\s+/);
        seriesName = nameParts.length > 0 ? nameParts[0] : "Bilinmeyen";
      }

      seriesName = seriesName.replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!seriesName) seriesName = "Bilinmeyen";

      // Hedef klasör ve dosya yolunu belirle
      const seriesFolderPath = pathUtils.join(downloadDir, seriesName);
      let targetFolderPath;

      if (seasonFolder) {
        targetFolderPath = pathUtils.join(seriesFolderPath, seasonFolder);
      } else {
        targetFolderPath = seriesFolderPath;
      }

      const targetFilePath = pathUtils.join(
        targetFolderPath,
        safeTitle + fileExtension
      );

      try {
        // Dosya var mı kontrol et
        if (electronAPI && electronAPI.checkFileExists) {
          const fileCheck = await electronAPI.checkFileExists({
            filePath: targetFilePath,
          });
          if (fileCheck.exists) {
            console.log(`Dosya bulundu, siliniyor: ${targetFilePath}`);
          }
        }
      } catch (error) {
        console.warn("Dosya kontrol hatası:", error);
      }

      // Önce indirilen dosyalar listesinden çıkar
      setDownloadedFiles((prev) => prev.filter((id) => id !== stream.id));
      // Sonra indirme işlemini başlat
      await downloadSingleStream(stream);
    } catch (error) {
      console.error("Yeniden indirme hatası:", error);
      setNotification({
        open: true,
        message: `Yeniden indirme sırasında hata oluştu: ${error.message}`,
        severity: "error",
      });
    }
  };

  // Uygulama kapanma temizleme olaylarını dinle
  useEffect(() => {
    if (electronAPI && electronAPI.onDownloadsCleanup) {
      const cleanupListener = electronAPI.onDownloadsCleanup((data) => {
        console.log("Temizleme olayı alındı:", data);

        // Temizleme sonrası bildirimi göster (isteğe bağlı)
        if (data.status === "success" && data.count > 0) {
          setNotification({
            open: true,
            message: `${data.count} adet yarım kalan indirme temizlendi.`,
            severity: "info",
          });
        }
      });

      return () => {
        // Bileşen çözüldüğünde dinleyiciyi temizle
        if (cleanupListener) {
          cleanupListener();
        }
      };
    }
  }, [electronAPI]);

  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          M3U Downloader
        </Typography>

        <Box className="action-buttons">
          <Button
            variant="contained"
            startIcon={<FileOpenIcon />}
            onClick={() => loadM3uFile()}
            disabled={loading || downloading || batchDownloading}
          >
            M3U Dosyası Seç
          </Button>

          <Button
            variant="contained"
            startIcon={<FolderOpenIcon />}
            onClick={selectDownloadFolder}
            disabled={loading || downloading || batchDownloading}
          >
            İndirme Klasörü Seç
          </Button>

          {streams.length > 0 && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<DownloadIcon />}
              onClick={downloadSelectedStreams}
              disabled={
                loading ||
                downloading ||
                batchDownloading ||
                streams.filter((s) => s.selected).length === 0
              }
              sx={{ ml: 2 }}
            >
              Seçili Stream'leri İndir
              {streams.filter((s) => s.selected).length > 0 &&
                ` (${streams.filter((s) => s.selected).length})`}
            </Button>
          )}
        </Box>

        {/* Toplu indirme durumunda gösterilecek bilgi */}
        {batchDownloading && (
          <Box sx={{ mt: 2, p: 2, bgcolor: "#f5f5f5", borderRadius: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <CircularProgress size={20} sx={{ mr: 1 }} />
              <Typography variant="body1" fontWeight="bold" color="primary">
                Seçili dosyalar sırayla indiriliyor...
              </Typography>
            </Box>

            <Box
              sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}
            >
              <Typography variant="body2">
                Şu an indirilen:{" "}
                {currentDownloadingId
                  ? streams.find((s) => s.id === currentDownloadingId)?.title ||
                    currentDownloadingId
                  : "İndirme başlatılıyor..."}
              </Typography>
              <Typography variant="body2">
                Kalan: {downloadQueue.length} dosya
              </Typography>
            </Box>

            {/* Şu anki indirme ilerleme çubuğu */}
            {currentDownloadingId && (
              <Box sx={{ mt: 1, mb: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 0.5,
                  }}
                >
                  <Typography variant="caption">İndirme ilerlemesi:</Typography>
                  {downloadProgress[currentDownloadingId] && (
                    <Typography variant="caption">
                      {formatFileSize(
                        downloadProgress[currentDownloadingId].received || 0
                      )}{" "}
                      /
                      {formatFileSize(
                        downloadProgress[currentDownloadingId].total || 0
                      )}{" "}
                      (%
                      {Math.round(
                        (downloadProgress[currentDownloadingId].progress || 0) *
                          100
                      )}
                      )
                      {downloadProgress[currentDownloadingId].received > 0 &&
                        downloadProgress[currentDownloadingId].total > 0 && (
                          <span>
                            {" "}
                            - Tahmini kalan süre:{" "}
                            {(() => {
                              const received =
                                downloadProgress[currentDownloadingId].received;
                              const total =
                                downloadProgress[currentDownloadingId].total;
                              const startTime =
                                downloadStartTimes[currentDownloadingId] || 0;
                              const elapsedMs = Date.now() - startTime;

                              if (received > 0 && total > 0 && elapsedMs > 0) {
                                const progress = received / total;
                                if (progress > 0) {
                                  // Tahmini toplam süre (ms)
                                  const estimatedTotalTime =
                                    elapsedMs / progress;
                                  // Kalan süre (ms)
                                  const remainingTime =
                                    estimatedTotalTime - elapsedMs;

                                  // Süreyi formatla
                                  if (remainingTime < 60000) {
                                    // 1 dakikadan az
                                    return `${Math.ceil(
                                      remainingTime / 1000
                                    )} saniye`;
                                  } else if (remainingTime < 3600000) {
                                    // 1 saatten az
                                    return `${Math.ceil(
                                      remainingTime / 60000
                                    )} dakika`;
                                  } else {
                                    // 1 saatten fazla
                                    return `${Math.floor(
                                      remainingTime / 3600000
                                    )} saat ${Math.ceil(
                                      (remainingTime % 3600000) / 60000
                                    )} dakika`;
                                  }
                                }
                              }
                              return "hesaplanıyor...";
                            })()}
                          </span>
                        )}
                    </Typography>
                  )}
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={
                    downloadProgress[currentDownloadingId]
                      ? Math.round(
                          (downloadProgress[currentDownloadingId].progress ||
                            0) * 100
                        )
                      : 0
                  }
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>
            )}

            {/* Genel ilerleme çubuğu */}
            {(() => {
              // Toplam stream sayısı (indirilenler + kuyrukta bekleyenler)
              const totalSelectedStreams =
                downloadedFiles.filter((id) =>
                  streams.some((s) => s.id === id && s.selected)
                ).length +
                downloadQueue.length +
                (currentDownloadingId ? 1 : 0);

              // Toplam seçili stream sayısı - kaç dosya işleme alındı
              const totalProcessedStreams = streams.filter(
                (s) => s.selected
              ).length;

              // Tamamlanan stream sayısı
              const completedStreams = downloadedFiles.filter((id) =>
                streams.some((s) => s.id === id && s.selected)
              ).length;

              // Indirme devam eden dosya için güncel ilerleme
              let currentProgress = 0;
              if (
                currentDownloadingId &&
                downloadProgress[currentDownloadingId]
              ) {
                currentProgress =
                  downloadProgress[currentDownloadingId].progress || 0;
              }

              // Genel ilerleme hesabı: (tamamlanan dosyalar + mevcut indirmenin ilerlemesi) / toplam dosya sayısı
              const overallProgress =
                totalProcessedStreams > 0
                  ? Math.round(
                      ((completedStreams +
                        (currentDownloadingId ? currentProgress : 0)) /
                        totalProcessedStreams) *
                        100
                    )
                  : 0;

              return (
                <Box sx={{ mt: 2, mb: 1 }}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      mb: 0.5,
                    }}
                  >
                    <Typography variant="caption">Genel ilerleme:</Typography>
                    <Typography variant="caption">
                      {completedStreams} / {totalProcessedStreams} dosya (%
                      {overallProgress})
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={overallProgress}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                </Box>
              );
            })()}
          </Box>
        )}

        {/* Seçilen dosya ve klasör yolları */}
        {m3uFilePath && (
          <Box className="path-display">
            <Typography variant="body2">
              M3U Dosyası:{" "}
              {typeof m3uFilePath === "string"
                ? m3uFilePath
                : JSON.stringify(m3uFilePath)}
            </Typography>
          </Box>
        )}

        {downloadDir && (
          <Box className="path-display">
            <Typography variant="body2">
              İndirme Klasörü:{" "}
              {typeof downloadDir === "string"
                ? downloadDir
                : JSON.stringify(downloadDir)}
            </Typography>
          </Box>
        )}

        {/* Stream Tablosu */}
        {streams.length > 0 && (
          <>
            {/* Arama alanı */}
            <Box sx={{ mt: 3, mb: 2 }}>
              <TextField
                fullWidth
                variant="outlined"
                size="small"
                label="Stream Ara"
                value={searchQuery}
                onChange={handleSearchChange}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        color="primary"
                        onChange={handleSelectAll}
                        checked={
                          streams.length > 0 && streams.every((s) => s.selected)
                        }
                        indeterminate={
                          streams.some((s) => s.selected) &&
                          !streams.every((s) => s.selected)
                        }
                      />
                    </TableCell>
                    <TableCell>Başlık</TableCell>
                    <TableCell>URL</TableCell>
                    <TableCell align="center" width="150">
                      İşlem
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {currentPageRows.map((stream) => {
                    const isDownloading =
                      downloading && currentDownloadingId === stream.id;
                    const isDownloaded = downloadedFiles.includes(stream.id);

                    // İlerleme takibi için değişkenler
                    let progress = 0;
                    let progressData = null;

                    // Hem stream ID hem de olası dosya adı üzerinden ilerleme bilgisi kontrol edilmeli
                    if (downloadProgress[stream.id]) {
                      progressData = downloadProgress[stream.id];
                      progress = progressData.progress || 0;
                    }

                    // Stream ID'sine göre bulunan bilgiler
                    const received = progressData?.received || 0;
                    const total = progressData?.total || 0;
                    const timestamp = progressData?.timestamp || 0;

                    // Gösterim için yüzde hesapla
                    const displayProgress = Math.round(progress * 100);

                    return (
                      <TableRow key={stream.id} hover>
                        <TableCell padding="checkbox">
                          <Checkbox
                            color="primary"
                            checked={stream.selected}
                            onChange={() => handleSelectStream(stream.id)}
                            disabled={
                              isDownloading || isDownloaded || batchDownloading
                            }
                          />
                        </TableCell>
                        <TableCell>{stream.title || "İsimsiz"}</TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 350,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {stream.url}
                        </TableCell>
                        <TableCell align="center">
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {isDownloaded && !isDownloading ? (
                              <Box
                                sx={{ display: "flex", alignItems: "center" }}
                              >
                                <Tooltip title="İndirildi">
                                  <CheckCircleIcon
                                    color="success"
                                    sx={{ mr: 1 }}
                                  />
                                </Tooltip>
                                <Tooltip title="Tekrar İndir">
                                  <IconButton
                                    color="primary"
                                    onClick={() => redownloadStream(stream)}
                                    disabled={downloading || batchDownloading}
                                    size="small"
                                    sx={{ ml: 1 }}
                                  >
                                    <DownloadIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            ) : (
                              <Tooltip
                                title={
                                  isDownloading
                                    ? "İndiriliyor..."
                                    : "Bu stream'i indir"
                                }
                              >
                                <span>
                                  <IconButton
                                    color="primary"
                                    onClick={() => downloadSingleStream(stream)}
                                    disabled={downloading || batchDownloading}
                                    size="small"
                                  >
                                    {isDownloading ? (
                                      <CircularProgress
                                        size={24}
                                        variant="determinate"
                                        value={displayProgress}
                                      />
                                    ) : (
                                      <DownloadIcon />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}

                            {/* İndirme ilerleme çubuğu */}
                            {isDownloading && (
                              <Box
                                sx={{
                                  width: "120px",
                                  ml: 1,
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <LinearProgress
                                  variant="determinate"
                                  value={displayProgress}
                                  sx={{ height: 10, borderRadius: 5 }}
                                />
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "block",
                                    textAlign: "center",
                                    fontWeight: "bold",
                                    mt: 0.5,
                                  }}
                                >
                                  %{displayProgress}
                                  {timestamp > 0 && (
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        opacity: 0.7,
                                        marginLeft: "3px",
                                      }}
                                    >
                                      {(() => {
                                        // Başlangıç zamanı varsa o zaman damgasını kullan, yoksa state'teki timestamp değerini
                                        const startTime =
                                          downloadStartTimes[stream.id] ||
                                          timestamp;
                                        // timerTick burada bağımlılık olarak kullanılıyor,
                                        // böylece her saniye güncellenecek
                                        timerTick;
                                        // Geçen süreyi hesapla
                                        const elapsedSeconds = Math.max(
                                          1,
                                          Math.floor(
                                            (Date.now() - startTime) / 1000
                                          )
                                        );
                                        return `(${elapsedSeconds}s önce)`;
                                      })()}
                                    </span>
                                  )}
                                </Typography>
                                {total > 0 && (
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      display: "block",
                                      textAlign: "center",
                                      fontSize: "0.6rem",
                                    }}
                                  >
                                    {formatFileSize(received)} /{" "}
                                    {formatFileSize(total)}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Boş satırlar durumunu kontrol et */}
                  {currentPageRows.length === 0 && (
                    <TableRow style={{ height: 53 }}>
                      <TableCell colSpan={4} align="center">
                        {searchQuery
                          ? "Aramanızla eşleşen veri bulunamadı."
                          : "Hiç stream verisi bulunamadı."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Sayfalama */}
              <TablePagination
                rowsPerPageOptions={[5, 10, 25, 50, 100]}
                component="div"
                count={filteredStreams.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
                labelRowsPerPage="Sayfa başına satır:"
                labelDisplayedRows={({ from, to, count }) =>
                  `${from}-${to} / ${count}`
                }
              />
            </TableContainer>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2">
                Toplam {filteredStreams.length} stream listeleniyor
                {streams.filter((s) => s.selected).length > 0 &&
                  ` (${
                    streams.filter((s) => s.selected).length
                  } tanesi seçili)`}
                {downloadQueue.length > 0 &&
                  ` - Kuyruktaki dosya sayısı: ${downloadQueue.length}`}
              </Typography>
            </Box>
          </>
        )}

        {/* Yükleniyor göstergesi */}
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Bildirim */}
        <Snackbar
          open={notification.open}
          autoHideDuration={6000}
          onClose={closeNotification}
        >
          <Alert
            onClose={closeNotification}
            severity={notification.severity}
            sx={{ width: "100%" }}
          >
            {notification.message}
          </Alert>
        </Snackbar>
      </Box>
    </Container>
  );
}

export default App;
