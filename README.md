# ⚔️ RO 道具數量辨識器

使用 OpenCV.js 在瀏覽器端辨識 Ragnarok Online 截圖中的道具數量。

## ✨ 功能

- 📸 上傳截圖（拖放 / 按鈕 / `Ctrl+V` 貼上）
- 🔢 自動辨識截圖中的所有道具數量（0~30000）
- 🎯 紅框標記辨識位置
- ⚙️ 可調參數（匹配信心度、二值化閾值）
- 🐛 偵錯模式（顯示二值化結果）
- 💾 匯出結果（CSV / JSON）

## 🚀 使用方式

直接開啟網頁 → `Ctrl+V` 貼上 RO 截圖 → 自動辨識

## 🔧 技術架構

- **前端**：HTML5 + Vanilla CSS + JavaScript（純靜態，無框架）
- **影像處理**：OpenCV.js 4.12.0（CDN 載入）
- **全瀏覽器端運算**，無需後端伺服器，速度快、保護隱私

## 📁 專案結構

```
├── index.html              # 主頁面
├── css/
│   └── style.css           # 深色主題樣式
├── js/
│   ├── app.js              # UI 控制
│   ├── ocr-engine.js       # OpenCV 模板匹配引擎
│   └── nms.js              # 非極大值抑制 & 數字組合
└── templates/
    ├── digits/             # 0~9 數字模板
    └── config.json         # 模板設定
```

## 📝 授權

MIT License
