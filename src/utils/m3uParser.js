/**
 * M3U dosyalarını ayrıştırmak için yardımcı sınıf
 */
class M3uParser {
  /**
   * M3U içeriğini ayrıştırır ve stream nesneleri dizisi döndürür
   * @param {string} content - M3U dosya içeriği
   * @returns {Array} - Stream nesneleri dizisi
   */
  static parse(content) {
    if (!content) return [];

    const lines = content.split("\n");
    const streams = [];
    let currentStream = null;
    let id = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Yorumları ve boş satırları atla
      if (!line || (line.startsWith("#") && !line.startsWith("#EXTINF:"))) {
        continue;
      }

      // EXTINF satırı - metaveri içerir
      if (line.startsWith("#EXTINF:")) {
        currentStream = {
          id: ++id,
          title: this.extractTitle(line),
          url: "",
        };
      }
      // URL satırı
      else if (currentStream && !line.startsWith("#")) {
        currentStream.url = line;
        streams.push({ ...currentStream });
        currentStream = null;
      }
    }

    return streams;
  }

  /**
   * EXTINF satırından başlık bilgisini çıkarır
   * @param {string} line - EXTINF satırı
   * @returns {string} - Çıkarılan başlık
   */
  static extractTitle(line) {
    // Örnek: #EXTINF:-1 tvg-name="Channel Name",Channel Name
    // veya: #EXTINF:-1,Channel Name

    const commaIndex = line.indexOf(",");
    if (commaIndex !== -1 && commaIndex < line.length - 1) {
      return line.substring(commaIndex + 1).trim();
    }

    // Başlık bulunamazsa, tvg-name özelliğini aramayı dene
    const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
    if (tvgNameMatch && tvgNameMatch[1]) {
      return tvgNameMatch[1].trim();
    }

    return "";
  }
}

export default M3uParser;
