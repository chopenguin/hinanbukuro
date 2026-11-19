# 避難包帖

一個純靜態的防災用品清單，用掃條碼的方式把家裡的備品收進避難包，順便管好每一件物品的有效期限。

- **掃條碼加入**：用手機相機掃 EAN／UPC／Code128，自動帶入商品名稱；已建檔且未過期的商品再掃一次會自動 +1
- **品名與有效期限 OCR**：拍下品名標籤自動辨識名稱（PP-OCRv6 Small，繁體中文），也能拍包裝上的日期自動讀取
- **到期提醒**：首頁紅／金／綠分區倒數，也能匯出 `.ics` 到手機日曆
- **日式暖色 × iOS 介面**：和紙底與朱紅印章，配上大標題收合、毛玻璃導覽列、分組列表與彈簧動態；自動跟隨系統深色模式
- **手勢回饋**：底部面板可拖曳收起、滑動分段控制器、掃描與儲存時的觸覺震動（可在設定關閉）
- **資料不離開裝置**：全部存在瀏覽器 `localStorage`，另有 JSON 匯出／匯入

沒有帳號、沒有後端、沒有追蹤。

**線上版：<https://chopenguin.github.io/hinanbukuro/>**（可以直接加到手機主畫面）

---

## 本機預覽

ES modules 不能直接用 `file://` 開啟，需要一個靜態伺服器：

```bash
# 方式一（需要 Node）
npx serve -l 4173 .

# 方式二（Python 3）
python -m http.server 4173
```

然後打開 <http://localhost:4173>。

> 相機功能需要 `https` 或 `localhost`，所以不要用 `file://` 測試掃碼。

---

## 部署到 GitHub Pages

全部是靜態檔案，而且路徑都用相對路徑寫（`./assets/...`），所以**放在任何 repo 子路徑都不需要改設定**。

目前這個專案的 Pages 已經接好：`main` 每次 push 都會由 Actions 自動部署到
<https://chopenguin.github.io/hinanbukuro/>。

### 換到自己帳號時：Actions 自動部署

1. 建立 repo 並推上去：

   ```bash
   git remote add origin https://github.com/<你的帳號>/<repo>.git
   git branch -M main
   git push -u origin main
   ```

2. GitHub → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
   （或用 `gh api --method POST repos/<帳號>/<repo>/pages -f build_type=workflow` 開一次）
3. 之後每次 push 到 `main`，`.github/workflows/pages.yml` 就會自動部署
4. 網址會是 `https://<你的帳號>.github.io/<repo>/`

> Pages 的免費方案只支援 **public** repo。

### 手動方式

**Settings → Pages → Source** 選 `Deploy from a branch`，分支選 `main`、資料夾選 `/ (root)` 也可以。

> 網站沒有 Service Worker，JS 模組由瀏覽器一般 HTTP 快取（Pages 約 10 分鐘）。
> 更新後若還看到舊版畫面，重新整理一次即可；OCR 的模型與執行環境是釘在
> `@paddleocr/paddleocr-js@0.4.2` 的固定版本，不會因改版而失效。

---

## 使用流程

1. **掃描**頁 → 開啟相機 → 對準條碼
2. 第一次看到這個條碼時，按「拍下品名標籤，自動辨識」帶入名稱（也可以自己取一個好認的名字）；名稱會存進「我的商品庫」，下次同一個條碼自動帶入
3. 按「拍下包裝上的日期，自動讀取」，確認候選日期後按**加入避難包**
4. 之後再掃到同一個條碼、而且還沒過期，會直接自動 +1，並停在結果畫面讓你確認或復原
5. 在**總覽**看哪幾件快到期；到**設定**匯出 `.ics` 丟進手機日曆，讓系統幫你提醒

第一次使用沒有頭緒的話，首頁按「載入建議清單」會加入 18 項常見的三日份防災用品。

---

## 幾個實際限制（先講清楚）

| 限制 | 說明 | 解法 |
| --- | --- | --- |
| 靜態網頁不能背景推播 | 關掉網頁就沒有通知 | 匯出 `.ics` 到手機日曆，或自己記得開網頁 |
| OCR 不是 100% 準 | 點陣印刷、曲面、反光都會影響 | 掃描結果只是「候選」，一定要你確認才寫入 |
| 第一次 OCR 要下載不少東西 | 模型約 30 MB，連同 OpenCV／ONNX Runtime 執行環境約 50 MB | 只在下載後由瀏覽器快取，之後不用再等 |
| OCR 需要一點時間 | 桌面 WASM 約 8～13 秒／張，手機較慢；支援 WebGPU 的瀏覽器會快一些 | 拍清楚、只拍標籤或日期那一小塊，可以減少辨識時間 |
| 資料只在這台裝置 | 換手機、清除瀏覽器資料就沒了 | 定期在設定頁**匯出備份 JSON** |
| localStorage 約 5MB | 純文字資料很夠用（不含照片） | 照片只用於當次辨識，不會儲存 |

---

## 專案結構

```
.
├─ index.html                  # 單頁外殼（雜湊路由）
├─ manifest.webmanifest        # 加到主畫面用的 PWA manifest
├─ assets/
│  ├─ css/style.css            # 設計 token 與所有元件樣式
│  ├─ img/mark.svg             # 印章感的網站圖示
│  ├─ vendor/zxing.min.js      # 條碼解碼（iOS Safari 備援）
│  └─ js/
│     ├─ app.js                # 路由與啟動
│     ├─ core/
│     │  ├─ store.js           # localStorage 資料層、統計
│     │  ├─ dates.js           # 日期計算、期限狀態、日期文字解析
│     │  ├─ ics.js             # .ics 產生器（含到期前提醒）
│     │  ├─ off.js             # Open Food Facts 條碼查詢
│     │  ├─ gtin.js            # 條碼格式、檢查碼、GS1 註冊地
│     │  ├─ barcode.js         # BarcodeDetector + ZXing 掃碼
│     │  ├─ ocr.js             # PP-OCRv6 Small 品名與期限辨識
│     │  ├─ spring.js          # 彈簧動畫、慣性投影、數字滾動
│     │  ├─ haptics.js         # 觸覺回饋（可關閉）
│     │  └─ ui.js              # toast、可拖曳底部面板、iOS 確認框
│     ├─ components/itemCard.js# 物品卡片與編輯面板
│     ├─ data/presets.js       # 預設分類、建議清單
│     └─ views/                # 總覽 / 避難包 / 掃描 / 設定
└─ .github/workflows/pages.yml # GitHub Pages 自動部署
```

沒有建置步驟，改完檔案重新整理就會生效。

---

## 技術備註

- **條碼**：優先使用瀏覽器原生 `BarcodeDetector`（Android Chrome／Edge，省電又快）；不支援時才延遲載入 `@zxing/library`（iOS Safari 靠這個）。兩者都失敗時可手動輸入或上傳照片。
- **條碼本身**：靠長度判斷 EAN-8／UPC-A／EAN-13／GTIN-14，並用最後一碼檢查碼抓「掃錯、打錯」；前 3 碼是 GS1 前綴，會顯示註冊地（`471`＝GS1 台灣），但條碼**不含**品名、容量、製造日或有效期限，前綴也**不代表產地**。
- **商品名稱**：[Open Food Facts](https://world.openfoodfacts.org/) 公開 API，免金鑰、支援 CORS。查不到就由使用者命名，或拍品名標籤用 OCR 辨識。
- **自動計入**：掃到條碼後，若「我的避難包」裡已有同條碼、且沒有過期（沒有期限視為可用）的物品，就優先選最早到期的那一件 +1。結果畫面會暫停相機，避免同一個條碼被連續計入；按「復原」可退回上一次數量。
- **OCR**：[PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js) 從 CDN 延遲載入，使用 `chinese_cht` + `ocrVersion: "PP-OCRv6"`（PP-OCRv6 Small，約 7.7M 參數）。同一個模型負責品名與日期：品名會優先找「品名／商品名／名稱」標籤，沒有標籤時用字體大小、位置與辨識分數猜標題行；日期解析支援 `2027.03.01`、`2027/3/1`、`2027年3月1日`、`20270301`、`27.03.01`、`2027.03`（取月底）、民國 `116.03.01`、`115.11.13`，以及 OCR 吃掉國字後剩下的 `2028531`。每個日期候選都帶該行的辨識信心值，只有信心夠高、而且不是歧義切法時才會自動填入，其餘只列出來給你挑。
- **OCR 執行環境**：預設 `backend: "auto"`，先試 WebGPU，不支援時退回 WASM；模型與執行環境第一次使用才下載，之後由瀏覽器 HTTP 快取。`numThreads: 1` 是為了避開靜態主機沒有 COOP／COEP 標頭時的多執行緒限制。
- **提醒**：`.ics` 每筆事件包含到期前 7 天、約一半天數、當天三段 `VALARM`，由手機日曆負責通知。

## 授權

個人使用自由。內含的第三方程式庫（ZXing、PaddleOCR.js、ONNX Runtime、OpenCV.js）依其原授權（Apache-2.0／MIT）。
