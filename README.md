# 避難包帖

一個純靜態、免帳號、真正可離線運作的防災用品管理網頁應用（PWA）。用掃條碼或拍照辨識的方式把家裡的備品收進避難包，管好每一件物品的有效期限，並整合家庭集合點、離線距離方位計算與一鍵 GPS 報平安。

- **雙版型響應式設計**：手機端配備浮動毛玻璃底部導覽列，桌面端自動切換左側導覽欄；採用溫潤石紙色系與防災朱紅主色，支援手動或跟隨系統切換淺色／深色主題
- **條碼 Web Worker 掃描**：支援原生 `BarcodeDetector` 與背景 Web Worker 執行 ZXing 相容解碼（不阻塞畫面幀率），可切換掃描引擎與手電筒；已建檔未過期商品再掃一次自動 +1
- **單拍雙辨識 OCR**：除了獨立辨識品名或效期外，新增「拍照辨識」模式（PP-OCRv6 Small，繁體中文），拍一張標籤同時帶出品名、推薦分類／單位與有效期限候選
- **順手盤點與即時提醒**：清單列內建數量微調器（`− / +`）、狀態篩選膠囊、搜尋一鍵清除、刪除後 Toast 復原、以及首頁一鍵「已更換」更新效期
- **平安頁與離線計算**：預設家庭集合點、具名緊急聯絡人、台灣常用防災專線（119 / 110 / 1991 / 112）速撥；取得 GPS 後可**完全離線**算出各集合點直線距離與八方位，一鍵產生報平安簡訊或 QR Code 分享給家人
- **真正離線可用**：內建 Service Worker（`sw.js`）預快取本地 App Shell；全部資料僅保存在瀏覽器 `localStorage`，支援 JSON 匯出／合併匯入與 `.ics` 行事曆提醒匯出

沒有帳號、沒有後端、沒有追蹤。

**線上版：<https://chopenguin.github.io/hinanbukuro/>**（可直接加到手機主畫面或桌面離線開啟）

---

## 本機預覽

ES modules、Web Worker 與 Service Worker 需要透過靜態伺服器開啟（不能用 `file://`）：

```bash
# 方式一（Python 3）
python3 -m http.server 4173

# 方式二（Node）
npx serve -l 4173 .
```

然後打開 <http://localhost:4173>。

> 相機、GPS 定位與 Service Worker 需要 `https` 或 `localhost` 環境。

---

## 部署到 GitHub Pages

全部為純靜態檔案且使用相對路徑（`./...`），**放在任何 repo 子路徑都不需要修改設定**。

`main` 分支每次 push 都會透過 `.github/workflows/pages.yml` 自動上傳並部署到 GitHub Pages。

---

## 專案結構

```
.
├─ index.html                  # 單頁外殼（支援手機 Dock 與桌面側欄、無閃爍主題初始化）
├─ manifest.webmanifest        # PWA manifest 與快速捷徑
├─ sw.js                       # Service Worker（App Shell 離線快取，跨網域請求直接放行）
├─ assets/
│  ├─ css/
│  │  ├─ tokens.css            # 雙主題語意色彩、字體與間距 Token
│  │  ├─ base.css              # Reset、響應式版型外殼、離線橫幅與列印樣式
│  │  ├─ components.css        # 卡片、列表步進器、膠囊、面板與 Toast 元件
│  │  └─ views.css             # 五大視圖專用版面樣式
│  ├─ img/mark.svg             # 印章風格網站圖示
│  ├─ vendor/zxing.min.js      # 條碼解碼（Web Worker 相容模式使用）
│  ├─ vendor/qrcode.min.js     # 集合點分享 QR Code（MIT，延遲載入）
│  └─ js/
│     ├─ app.js                # 雜湊路由、主題切換、SW 註冊、IntersectionObserver 導覽列
│     ├─ components/itemCard.js# 物品列（步進器 / 已更換）、編輯面板（含效期 OCR）與建議清單選擇器
│     ├─ data/presets.js       # 預設分類、建議清單（含家庭人數換算）與台灣緊急專線
│     ├─ core/
│     │  ├─ store.js           # localStorage 資料層、具名聯絡人遷移、復原與統計
│     │  ├─ icons.js           # 統一 24×24 細線 SVG 圖示庫
│     │  ├─ dates.js           # 當地時區日期運算、期限狀態、多格式 OCR 日期解析
│     │  ├─ safety.js          # GPS 定位、Haversine 離線距離與方位、簡訊產生與 QR 分享
│     │  ├─ ics.js             # .ics 行事曆產生器（含 DTEND 與 3 段 VALARM）
│     │  ├─ off.js             # Open Food Facts 查詢與台灣商品分類／單位推斷
│     │  ├─ gtin.js            # 條碼格式、檢查碼驗證與 GS1 註冊地對照
│     │  ├─ barcode.js         # 原生 BarcodeDetector + Web Worker ZXing 掃碼控制器
│     │  ├─ barcode.worker.js  # ZXing 條碼解碼背景 Worker
│     │  ├─ ocr.js             # PP-OCRv6 Small 品名、效期與單拍雙辨識
│     │  ├─ spring.js          # 物理彈簧動畫與數字滾動
│     │  ├─ haptics.js         # 觸覺震動回饋
│     │  └─ ui.js              # 可復原 Toast、底部／置中面板、確認框與圖片工具
│     └─ views/                # 總覽 / 避難包 / 掃描入包 / 平安 / 設定
└─ .github/workflows/pages.yml # GitHub Pages 自動部署
```

沒有建置步驟，改完檔案重新整理即可生效。

---

## 授權

個人使用自由。內含的第三方程式庫（ZXing、PaddleOCR.js、ONNX Runtime、OpenCV.js、qrcode-generator）依其原授權（Apache-2.0／MIT）。
