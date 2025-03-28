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

          // setDownloadProgress ve ilgili state güncellemesi
          setDownloadProgress((prev) => {
            const newState = { ...prev };
            // Mevcut stream için ilerleme güncelle (hem ID hem de dosya adı ile eşleştirme)
            newState[streamId] = {
              progress: data.progress || 0,
              received: data.received || 0,
              total: data.total || 0,
              timestamp: now,
            };

            // Eğer data.id bir dosya adı ise ve currentDownloadingId farklıysa
            if (data.id !== streamId) {
              newState[data.id] = {
                progress: data.progress || 0,
                received: data.received || 0,
                total: data.total || 0,
                timestamp: now,
              };
            }

            // Debug için son ilerlemeyi kaydet
            debugInfoRef.current.lastProgress = newState[streamId];

            console.log("State güncellendi:", newState);

            // Her güncelleme sonrası render tetikle
            setTimeout(() => forceUpdate(), 0);

            return newState;
          });

          // Her güncelleme sonrası render tetikle
          forceUpdate();
        }
      );

      // Ekstra render triggerı için interval
      const intervalId = setInterval(() => {
        if (downloading && debugInfoRef.current.receivedUpdates > 0) {
          const timeSinceLastUpdate =
            Date.now() - debugInfoRef.current.lastProgressTime;
          console.log(
            `Son güncelleme üzerinden geçen süre: ${timeSinceLastUpdate}ms`
          );

          // Son güncelleme 2 saniyeden eski değilse ek render tetikle
          if (timeSinceLastUpdate < 2000) {
            forceUpdate();
          }
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
  }, [downloading, electronAPI]);

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

      // URL kontrolü
      if (!stream.url) {
        throw new Error("Stream URL'si boş");
      }

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

      const fileName = `${originalFileName}${fileExtension}`;
      const fullFilePath = pathUtils.join(targetFolderPath, fileName);

      console.log(`İndirme başlatılıyor - URL: ${streamUrl}`);
      console.log(`Dosya: ${fileName} (Uzantı: ${fileExtension})`);
      console.log(`Dizi klasörü: ${seriesFolderPath}`);
      console.log(`Hedef klasör: ${targetFolderPath}`);
      console.log(`Tam dosya yolu: ${fullFilePath}`);

      // Dosya zaten var mı kontrol et
      if (electronAPI.checkFileExists) {
        console.log("Dosya varlığı kontrol ediliyor...");

        const fileCheck = await electronAPI.checkFileExists({
          filePath: fullFilePath,
          // Beklenen boyut, varsa kontrol edilebilir ama şu an için null
          expectedSize: null,
        });

        console.log("Dosya kontrol sonucu:", fileCheck);

        // Dosya varsa ve boyut olumlu ise
        if (fileCheck.exists && fileCheck.match) {
          console.log(
            `Dosya zaten mevcut, indirme atlanıyor: ${fullFilePath} (Boyut: ${fileCheck.fileSize} byte)`
          );

          // İndirilen dosyalar listesine ekle
          setDownloadedFiles((prev) => {
            // Eğer zaten listedeyse ekleme yapma
            if (prev.includes(stream.id)) return prev;
            return [...prev, stream.id];
          });

          // Kullanıcıya bildir
          setNotification({
            open: true,
            message: `"${
              stream.title || fileName
            }" zaten indirilmiş (${formatFileSize(
              fileCheck.fileSize
            )}). İndirme atlanıyor.`,
            severity: "info",
          });

          // Stream'in seçimini kaldır
          setStreams((prevStreams) =>
            prevStreams.map((s) =>
              s.id === stream.id ? { ...s, selected: false } : s
            )
          );

          // Logları güncelle
          try {
            // Dosya olduğu için logla (gerçek indirme yapmadık ama sistem için farketmez)
            if (electronAPI.getDownloadLogs) {
              // Log için indirme bilgisi oluştur
              const logInfo = {
                id: stream.id,
                title: stream.title || fileName,
                url: streamUrl,
                filePath: fullFilePath,
                fileSize: fileCheck.fileSize,
                timestamp: Date.now(),
                skipped: true, // Atlandı bilgisi
                reason: "Dosya zaten mevcut",
              };

              // Ana süreçteki log fonksiyonlarını çağır (opsiyonel)
              // await electronAPI.logDownloadedStream(logInfo);
            }
          } catch (logError) {
            console.error("Log kaydetme hatası:", logError);
          }

          // İndirmeyi atla
          return;
        }
      }

      // İndirme öncesi state'leri güncelle
      setCurrentDownloadingId(stream.id);
      setDownloading(true);

      // İndirme başlangıç zamanını kaydet
      setDownloadStartTimes((prev) => ({
        ...prev,
        [stream.id]: Date.now(),
      }));

      // İndirme öncesi ilerleme state'ini açıkça sıfırla
      console.log(`${stream.id} için ilerleme state'i sıfırlanıyor...`);

      // İlerleme bilgisini daha kapsamlı olarak başlat
      setDownloadProgress((prev) => {
        const newState = { ...prev };
        // Stream ID için ilerleme durumunu oluştur
        newState[stream.id] = {
          progress: 0,
          received: 0,
          total: 0,
          timestamp: Date.now(),
          fileName: fileName, // Dosya adını da ekle (main.js'den gelen data.id ile eşleştirebilmek için)
        };

        // Dosya adı için de aynı ilerleme durumunu oluştur (ana süreç dosya adını ID olarak kullanıyor)
        newState[fileName] = {
          progress: 0,
          received: 0,
          total: 0,
          timestamp: Date.now(),
          streamId: stream.id, // Stream ID'sini de ekle (iki yönlü eşleştirme için)
        };

        return newState;
      });

      // Force render
      forceUpdate();

      const params = {
        url: streamUrl,
        fileName,
        downloadDir: targetFolderPath, // Organize edilmiş klasör yapısını kullan
        createFolders: true, // Klasörleri oluştur bayrağını ekle
        streamInfo: {
          // Stream bilgilerini ekle
          id: stream.id,
          title: stream.title || fileName,
          url: streamUrl,
        },
      };

      const result = await electronAPI.downloadStream(params);

      if (result.success) {
        // İndirilen dosyalar listesine ekle
        setDownloadedFiles((prev) => [...prev, stream.id]);

        // Stream'in seçimini kaldır
        setStreams((prevStreams) =>
          prevStreams.map((s) =>
            s.id === stream.id ? { ...s, selected: false } : s
          )
        );

        setNotification({
          open: true,
          message: `"${
            stream.title || fileName
          }" başarıyla indirildi. (${formatFileSize(result.fileSize)})`,
          severity: "success",
        });
      } else {
        setNotification({
          open: true,
          message: `"${stream.title || fileName}" indirilemedi: ${
            result.error
          }`,
          severity: "error",
        });
      }
    } catch (error) {
      console.error(`İndirme hatası (${stream.title}):`, error);
      setNotification({
        open: true,
        message: `İndirme sırasında hata oluştu: ${error.message || error}`,
        severity: "error",
      });
    } finally {
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
    setStreams((prevStreams) =>
      prevStreams.map((stream) => ({ ...stream, selected: checked }))
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

    // Seçili stream'leri kuyruğa ekle
    setDownloadQueue(selectedStreamIds);
    setBatchDownloading(true);
  };

  // Kuyruktaki bir sonraki stream'i indir
  useEffect(() => {
    const downloadNextInQueue = async () => {
      // Eğer indirme işlemi zaten devam ediyorsa, bekle
      if (downloading) return;

      // Kuyrukta eleman varsa ve toplu indirme modu aktifse
      if (downloadQueue.length > 0 && batchDownloading) {
        const nextStreamId = downloadQueue[0];
        const streamToDownload = streams.find((s) => s.id === nextStreamId);

        if (streamToDownload) {
          // İndirme kuyruğundan çıkar
          setDownloadQueue((prevQueue) => prevQueue.slice(1));
          // İndirme işlemini başlat
          await downloadSingleStream(streamToDownload);
        }
      } else if (downloadQueue.length === 0 && batchDownloading) {
        // Tüm indirme işlemleri tamamlandığında
        setBatchDownloading(false);
        setNotification({
          open: true,
          message: "Tüm seçili stream'lerin indirme işlemi tamamlandı.",
          severity: "success",
        });
      }
    };

    downloadNextInQueue();
  }, [downloadQueue, downloading, batchDownloading, streams]);

  // Tekrar indirme fonksiyonu
  const redownloadStream = async (stream) => {
    // Önce indirilen dosyalar listesinden çıkar
    setDownloadedFiles((prev) => prev.filter((id) => id !== stream.id));
    // Sonra indirme işlemini başlat
    await downloadSingleStream(stream);
  };

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
          <Box sx={{ mt: 2, display: "flex", alignItems: "center" }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2" color="primary">
              Seçili dosyalar sırayla indiriliyor... (Kalan:{" "}
              {downloadQueue.length})
            </Typography>
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
