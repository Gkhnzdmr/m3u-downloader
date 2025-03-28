import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Hata günlüğü ekle
console.log("React uygulaması başlatılıyor...");

try {
  const container = document.getElementById("root");
  console.log("Kök element:", container);

  if (!container) {
    console.error("Root element bulunamadı!");
  } else {
    const root = createRoot(container);
    root.render(<App />);
    console.log("React uygulaması render edildi");
  }
} catch (error) {
  console.error("React uygulaması render edilirken hata oluştu:", error);
}
