# Cross the Hill

原創的多人合作越野駕駛網頁遊戲：low-poly 立體可愛風、運送任務、用絞盤互相拉車。手機（直向）和電腦都能玩。

設計文件：[docs/DESIGN.md](docs/DESIGN.md)

## 怎麼玩

1. 輸入暱稱 →「開房」→ 選車與顏色 → 出發
2. 從左上 ☰ 選單「複製邀請連結」貼到 LINE / Discord，朋友點開就會帶入房號
3. 開到目的地（羅盤和小地圖上的黃點），**全隊都進入光圈**算送達一趟
4. 卡住了？用絞盤勾樹、勾石頭、勾隊友，按住收繩把車拉出來

| 動作 | 手機 | 鍵盤 | 手把 |
|---|---|---|---|
| 轉向 | 左下搖桿 | A / D | 左搖桿 |
| 油門 / 煞車（停下後倒車） | 右下踏板 | W / S | RT / LT |
| 勾繩：按住瞄準、放開射出 | 🪝 按住，拖曳換目標 | 按住 E＋滑鼠 | 按住 LB＋右搖桿 |
| 收繩 | 已勾上時按住 🪝 | 按住 E | 按住 LB |
| 斷開 | ✕ | Q | B |
| 原地翻正（冷卻 5 秒） | ↻ | R | Y |
| 喇叭 | 📯 | H | X |
| 大地圖 / 放標記 | 點小地圖，再點地圖 | M | View |
| 縮放鏡頭 | 雙指 | 滾輪 | — |

## 開發

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # 型別檢查＋打包到 dist/
npm run analyze-terrain  # 產生坡度熱度圖 out/terrain.png，檢查道路坡度與水面一致性
npm run test-physics     # 無頭物理測試：落地、沿路行駛、爬石頭、絞盤
```

### 手機測試（同一個 Wi-Fi）

`npm run dev` 會顯示 `Network: http://192.168.x.x:5173`，手機開這個網址即可。
多人連線預設使用免費的 PeerJS 公共配對伺服器；如果它連不上，可以在電腦上自架：

```bash
npm run peer-server      # ws://<電腦區網 IP>:9000/cth
cp .env.example .env.local   # 打開註解，把 VITE_PEER_HOST 改成電腦的區網 IP
npm run dev
```

連不到配對伺服器時，開房會自動變成單人模式（畫面會提示）。

### 調整駕駛手感

網址加上 `?debug`（例：`http://localhost:5173/?debug`），開房後右上角會出現「手感調整」面板：

- 每台車的重心、懸吊、輪胎抓地、扭力、轉向、絞盤力都能即時拖拉
- 「地面」可調各地形的抓地與阻力；「繩索」可調剛性與阻尼
- 「顯示碰撞體」會把附近的實際碰撞形狀畫出來，用來確認地形與畫面一致
- 「傳送」可直接跳到各目的地或溪流做測試
- 調好後按「📋 複製設定」，把 JSON 貼回 `src/config/vehicles.ts`

調參只在主機端生效（物理由主機計算）。

## 部署到 Cloudflare

專案同時支援 Cloudflare **Workers**（新版預設流程）和 **Pages**，二選一即可。Node 版本由 `.node-version` 指定，不用另外設定。

### A. Workers（Cloudflare 新版「Import a repository」流程）

1. Workers & Pages → Create application → **Import a repository** → 選 `crossthehill`
2. Build command：`npm run build`
3. Deploy command：`npx wrangler deploy`（預設值，不用改）
4. Deploy。網址是 `https://crossthehill.<你的帳號>.workers.dev`
5. TURN Secret 設在：該 Worker → Settings → Variables and Secrets

設定檔：`wrangler.jsonc`（靜態檔來自 `dist/`，`/api/turn` 由 `worker/index.js` 處理）。

### B. Pages

1. Workers & Pages → Create → Pages → Connect to Git → 選 repo
2. Framework preset：None；Build command：`npm run build`；Build output directory：`dist`
3. TURN Secret 設在：Pages 專案 → Settings → Variables and Secrets

### 開啟 TURN（讓 4G / 5G 玩家也連得上）

1. Cloudflare 後台 → **Realtime** → **TURN Server** → 建立 TURN key，記下 **Key ID** 和 **API Token**
2. 在上面 A 或 B 對應的位置新增兩個 Secret：`TURN_KEY_ID`、`TURN_KEY_API_TOKEN`
3. 重新部署後，打開 `https://<你的網址>/api/turn`，看到 `{"configured":true}` 就完成了

沒設定時遊戲會退回只用 STUN（Wi-Fi 大多可連，部分 4G 會連不上）。

## 架構速覽

| 路徑 | 內容 |
|---|---|
| `src/world/terrainGen.ts` | 程序生成島嶼：地形、道路、溪流、泥地、岩石、樹（純資料，node 也能跑） |
| `src/world/terrainChunks.ts` | 地形區塊頂點／索引，**畫面與物理共用同一份** |
| `src/world/physicsWorld.ts` | Rapier 靜態碰撞（地形 trimesh、岩石凸包、樹幹圓柱） |
| `src/vehicle/vehiclePhysics.ts` | 自製輪胎模型：球形掃掠懸吊、摩擦圓、齒比引擎 |
| `src/config/vehicles.ts` | 所有手感參數 |
| `src/game/sim.ts` / `rope.ts` | 主機權威模擬、絞盤繩 |
| `src/net/` | PeerJS 連線與訊息格式 |
| `src/render/` / `src/ui/` | Three.js 畫面、HUD、觸控 |

## 已知限制（MVP）

- 加入者的操作有約 0.1–0.2 秒延遲（尚未做客戶端預測）
- 主機離開時房間會結束
- iPhone 開 Discord / LINE 通話時，遊戲音效可能變小聲，建議戴耳機
