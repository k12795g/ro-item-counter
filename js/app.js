/**
 * RO 道具數量辨識器 - 主程式
 * 負責 UI 控制、事件綁定、OpenCV.js 管理、模板載入和結果渲染
 */

const App = {
    // 狀態
    cvReady: false,
    templates: [],          // 數字模板（0~9）
    currentImage: null,
    lastResult: null,

    // 道具樣本庫狀態
    isSelectingItem: false,         // 是否處於框選道具模式
    selectionStart: null,           // 框選起點 {x, y}（相對於 canvas）
    selectionEnd: null,             // 框選終點 {x, y}
    pendingTemplate: null,          // 待確認的模板資料 {cleanCanvas, maskCanvas, maskedRects, usedOcr}
    lastItemResults: null,          // 最近一次道具辨識結果

    // 縮放狀態
    zoomLevel: 1.0,                 // 目前縮放對比

    // DOM 元素快取
    els: {},

    /**
     * 初始化應用程式
     */
    init() {
        this.cacheElements();
        this.loadSettings();
        this.bindEvents();
        this.initOpenCV();
    },

    /**
     * 從 localStorage 載入使用者設定
     */
    loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('roItemCounterSettings'));
            if (saved) {
                if (saved.matchThreshold !== undefined) {
                    this.els.matchThreshold.value = saved.matchThreshold;
                    this.els.matchThresholdVal.textContent = saved.matchThreshold;
                }
                if (saved.itemMatchThreshold !== undefined) {
                    this.els.itemMatchThreshold.value = saved.itemMatchThreshold;
                    this.els.itemMatchThresholdVal.textContent = saved.itemMatchThreshold;
                }
                if (saved.binaryThreshold !== undefined) {
                    this.els.binaryThreshold.value = saved.binaryThreshold;
                    this.els.binaryThresholdVal.textContent = saved.binaryThreshold;
                }
                if (saved.debugMode !== undefined) {
                    this.els.debugMode.checked = saved.debugMode;
                }
            }
        } catch (e) {
            console.warn('載入設定失敗:', e);
        }
    },

    /**
     * 儲存使用者設定到 localStorage
     */
    saveSettings() {
        const settings = {
            matchThreshold: this.els.matchThreshold.value,
            itemMatchThreshold: this.els.itemMatchThreshold.value,
            binaryThreshold: this.els.binaryThreshold.value,
            debugMode: this.els.debugMode.checked
        };
        localStorage.setItem('roItemCounterSettings', JSON.stringify(settings));
    },

    /**
     * 快取 DOM 元素引用
     */
    cacheElements() {
        this.els = {
            // 上傳區域
            dropZone: document.getElementById('canvas-wrapper'),
            fileInput: document.getElementById('file-input'),
            uploadBtn: document.getElementById('upload-btn'),

            // Canvas
            sourceCanvas: document.getElementById('source-canvas'),
            resultCanvas: document.getElementById('result-canvas'),
            debugCanvas: document.getElementById('debug-canvas'),
            canvasContainer: document.getElementById('canvas-container'),
            placeholder: document.getElementById('canvas-placeholder'),

            // 控制面板
            matchThreshold: document.getElementById('match-threshold'),
            matchThresholdVal: document.getElementById('match-threshold-val'),
            itemMatchThreshold: document.getElementById('item-match-threshold'),
            itemMatchThresholdVal: document.getElementById('item-match-threshold-val'),
            binaryThreshold: document.getElementById('binary-threshold'),
            binaryThresholdVal: document.getElementById('binary-threshold-val'),
            debugMode: document.getElementById('debug-mode'),
            recognizeBtn: document.getElementById('recognize-btn'),

            // 結果
            resultsList: document.getElementById('results-list'),
            resultCount: document.getElementById('result-count'),
            processingTime: document.getElementById('processing-time'),
            totalSum: document.getElementById('total-sum'),
            exportCsvBtn: document.getElementById('export-csv'),
            exportJsonBtn: document.getElementById('export-json'),

            // 狀態
            statusBar: document.getElementById('status-bar'),
            statusText: document.getElementById('status-text'),
            cvStatus: document.getElementById('cv-status'),


            // 道具樣本庫
            addSampleBtn: document.getElementById('add-sample-btn'),
            detectItemsBtn: document.getElementById('detect-items-btn'),
            selectionHint: document.getElementById('selection-hint'),
            itemTemplateList: document.getElementById('item-template-list'),
            itemResultsSection: document.getElementById('item-results-section'),
            itemResultsList: document.getElementById('item-results-list'),

            // 確認彈窗
            itemModal: document.getElementById('item-modal'),
            modalOriginalCanvas: document.getElementById('modal-original-canvas'),
            modalCleanCanvas: document.getElementById('modal-clean-canvas'),
            modalOcrInfo: document.getElementById('modal-ocr-info'),
            modalOcrText: document.getElementById('modal-ocr-text'),
            modalItemName: document.getElementById('modal-item-name'),
            modalCancel: document.getElementById('modal-cancel'),
            modalConfirm: document.getElementById('modal-confirm'),

            // 縮放控制
            canvasWrapper: document.getElementById('canvas-wrapper'),
            zoomOutBtn: document.getElementById('zoom-out-btn'),
            zoomInBtn: document.getElementById('zoom-in-btn'),
            zoomResetBtn: document.getElementById('zoom-reset-btn'),
            zoomFitBtn: document.getElementById('zoom-fit-btn'),
            zoomLevelDisplay: document.getElementById('zoom-level-display'),
        };
    },

    /**
     * 綁定事件
     */
    bindEvents() {
        // 檔案上傳按鈕
        this.els.uploadBtn.addEventListener('click', () => this.els.fileInput.click());
        this.els.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // 拖放上傳
        const dz = this.els.dropZone;
        dz.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dz.classList.add('drag-over');
        });
        dz.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dz.classList.remove('drag-over');
        });
        dz.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dz.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadImageFile(files[0]);
        });

        // Ctrl+V 貼上
        document.addEventListener('paste', (e) => this.handlePaste(e));

        // 參數滑桿
        this.els.matchThreshold.addEventListener('input', (e) => {
            this.els.matchThresholdVal.textContent = e.target.value;
            this.saveSettings();
        });
        this.els.itemMatchThreshold.addEventListener('input', (e) => {
            this.els.itemMatchThresholdVal.textContent = e.target.value;
            this.saveSettings();
        });
        this.els.binaryThreshold.addEventListener('input', (e) => {
            this.els.binaryThresholdVal.textContent = e.target.value;
            this.saveSettings();
        });

        // 辨識按鈕
        this.els.recognizeBtn.addEventListener('click', () => this.runRecognition());

        // 匯出按鈕
        this.els.exportCsvBtn.addEventListener('click', () => this.exportCSV());
        this.els.exportJsonBtn.addEventListener('click', () => this.exportJSON());

        // 偵錯模式：切換時重新辨識以產生/隱藏偵錯圖
        this.els.debugMode.addEventListener('change', () => {
            this.saveSettings();
            if (this.els.debugMode.checked) {
                if (this.currentImage) this.runRecognition();
            } else {
                this.els.debugCanvas.style.display = 'none';
            }
        });

        // ===== 道具樣本庫事件 =====

        // 截圖建立樣本按鈕
        this.els.addSampleBtn.addEventListener('click', () => this.startItemSelection());

        // 辨識道具數量按鈕
        this.els.detectItemsBtn.addEventListener('click', () => this.detectAllItems());

        // Canvas 框選事件（在 result-canvas 上操作，因為它覆蓋在 source-canvas 上方）
        const rc = this.els.resultCanvas;
        rc.addEventListener('mousedown', (e) => this.onSelectionMouseDown(e));
        rc.addEventListener('mousemove', (e) => this.onSelectionMouseMove(e));
        rc.addEventListener('mouseup',   (e) => this.onSelectionMouseUp(e));

        // Esc 取消框選
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isSelectingItem) this.cancelItemSelection();
        });

        // 彈窗按鈕
        this.els.modalCancel.addEventListener('click',  () => this.closeItemModal(false));
        this.els.modalConfirm.addEventListener('click', () => this.closeItemModal(true));
        this.els.itemModal.addEventListener('click', (e) => {
            if (e.target === this.els.itemModal) this.closeItemModal(false);
        });
        // Enter 確認弸窗
        this.els.modalItemName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.closeItemModal(true);
        });

        // ===== 縮放事件 =====
        this.els.zoomInBtn.addEventListener('click',    () => this.setZoom(this.zoomLevel + 0.25));
        this.els.zoomOutBtn.addEventListener('click',   () => this.setZoom(this.zoomLevel - 0.25));
        this.els.zoomResetBtn.addEventListener('click', () => this.setZoom(1.0));
        this.els.zoomFitBtn.addEventListener('click',   () => this.zoomToFit());

        // Ctrl + 滾輪縮放
        this.els.canvasWrapper.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                this.setZoom(this.zoomLevel + delta);
            }
        }, { passive: false });
    },

    /**
     * 初始化 OpenCV.js
     */
    initOpenCV() {
        this.setStatus('正在載入 OpenCV.js...', 'loading');
        this.els.cvStatus.textContent = '載入中...';
        this.els.cvStatus.className = 'cv-status loading';

        // OpenCV.js 載入完成的回調在全域 onOpenCvReady 函式中處理
    },

    /**
     * OpenCV.js 載入完成
     */
    async onCvReady() {
        this.cvReady = true;
        this.els.cvStatus.textContent = '✓ 已就緒';
        this.els.cvStatus.className = 'cv-status ready';
        this.setStatus('OpenCV.js 載入完成，正在載入模板...', 'loading');

        await this.loadTemplates();
        this.els.recognizeBtn.disabled = false;
        // 道具庫按鈕：需要 cvReady，上傳截圖後才可用
        this.els.addSampleBtn.disabled = false;
        // 重新渲染已儲存的模板列表
        this.renderItemTemplateList();
        this.setStatus('就緒！請上傳 RO 截圖', 'ready');
    },

    /**
     * 載入數字模板 (0~9)
     */
    async loadTemplates() {
        this.templates = [];
        for (let digit = 0; digit <= 9; digit++) {
            try {
                const cacheBuster = Date.now();
                const img = await this.loadImage(`templates/digits/${digit}.png?t=${cacheBuster}`);

                // 建立隱藏的 canvas 來載入模板到 OpenCV
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = img.naturalWidth;
                tmpCanvas.height = img.naturalHeight;
                const ctx = tmpCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // 讀入 OpenCV Mat
                const mat = cv.imread(tmpCanvas);
                const { binary } = OCREngine.preprocessTemplate(mat);

                this.templates.push({ digit, binary, width: img.naturalWidth, height: img.naturalHeight });


                mat.delete();
            } catch (err) {
                console.error(`載入模板 ${digit} 失敗:`, err);
            }
        }

        console.log(`已載入 ${this.templates.length} 個數字模板`);
    },

    /**
     * 載入圖片（Promise 包裝）
     */
    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    },

    /**
     * 處理檔案選擇
     */
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadImageFile(file);
    },

    /**
     * 處理 Ctrl+V 貼上
     */
    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                this.loadImageFile(file);
                return;
            }
        }
    },

    /**
     * 載入圖片檔案到 Canvas
     */
    loadImageFile(file) {
        if (!file.type.startsWith('image/')) {
            this.setStatus('請上傳圖片檔案', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.currentImage = img;
                this.drawSourceImage(img);
                this.setStatus(`圖片已載入：${img.naturalWidth}×${img.naturalHeight}`, 'ready');

                // 隱藏 placeholder，顯示 canvas
                this.els.placeholder.style.display = 'none';
                this.els.sourceCanvas.style.display = 'block';
                this.els.resultCanvas.style.display = 'block';

                // 有道具模板時啟用辨識按鈕
                if (ItemDetector.loadTemplates().length > 0) {
                    this.els.detectItemsBtn.disabled = false;
                }

                // 自動執行辨識
                if (this.cvReady && this.templates.length > 0) {
                    this.runRecognition();
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    /**
     * 將圖片繪製到來源 Canvas
     */
    drawSourceImage(img) {
        const canvas = this.els.sourceCanvas;
        const resultCanvas = this.els.resultCanvas;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        resultCanvas.width = img.naturalWidth;
        resultCanvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // 套用目前縮放比（先設為 1.0 然後判斷是否要縮放至符合）
        if (this.zoomLevel === 1.0) {
            this.zoomToFit();
        } else {
            this.setZoom(this.zoomLevel);
        }
    },

    /**
     * 執行辨識
     */
    runRecognition() {
        if (!this.cvReady) {
            this.setStatus('OpenCV.js 尚未載入完成', 'error');
            return;
        }
        if (!this.currentImage) {
            this.setStatus('請先上傳圖片', 'error');
            return;
        }
        if (this.templates.length === 0) {
            this.setStatus('模板未載入', 'error');
            return;
        }

        this.setStatus('辨識中...', 'loading');
        this.els.recognizeBtn.disabled = true;

        // 使用 requestAnimationFrame 讓 UI 更新後再開始運算
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    const options = {
                        matchThreshold: parseFloat(this.els.matchThreshold.value),
                        binaryThreshold: parseInt(this.els.binaryThreshold.value),
                        nmsIouThreshold: 0.3,
                        yTolerance: 4,
                        maxGapX: 8,
                        debug: this.els.debugMode.checked
                    };

                    const result = OCREngine.recognizeNumbers(
                        this.els.sourceCanvas, this.templates, options
                    );

                    this.lastResult = result;
                    this.drawResults(result);
                    this.renderResultsList(result);

                    // 偵錯模式：顯示二值化圖
                    if (result.debugImages?.binary) {
                        const debugCanvas = this.els.debugCanvas;
                        debugCanvas.width = result.debugImages.binary.cols;
                        debugCanvas.height = result.debugImages.binary.rows;
                        debugCanvas.style.display = 'block';
                        cv.imshow(debugCanvas, result.debugImages.binary);
                        result.debugImages.binary.delete();
                    } else {
                        this.els.debugCanvas.style.display = 'none';
                    }

                    this.setStatus(
                        `辨識完成！找到 ${result.numbers.length} 組數字，耗時 ${result.processingTime.toFixed(1)}ms`,
                        'ready'
                    );

                    // 若道具樣本庫有模板，自動接著辨識道具
                    if (ItemDetector.loadTemplates().length > 0) {
                        this.detectAllItems();
                    }
                } catch (err) {
                    console.error('辨識錯誤:', err);
                    this.setStatus(`辨識失敗：${err.message}`, 'error');
                } finally {
                    this.els.recognizeBtn.disabled = false;
                }
            }, 50);
        });
    },

    /**
     * 在結果 Canvas 上繪製辨識結果
     */
    drawResults(result) {
        const canvas = this.els.resultCanvas;
        const ctx = canvas.getContext('2d');

        // 清空結果層
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 繪製每組數字的框
        for (const num of result.numbers) {
            const padding = 2;
            const x = num.x - padding;
            const y = num.y - padding;
            const w = num.w + padding * 2;
            const h = num.h + padding * 2;

            // 半透明背景
            ctx.fillStyle = 'rgba(233, 69, 96, 0.2)';
            ctx.fillRect(x, y, w, h);

            // 紅色邊框
            ctx.strokeStyle = '#e94560';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);

            // 數字標籤（在框的上方）
            const label = `${num.value}`;
            ctx.font = 'bold 10px Inter, sans-serif';
            const labelW = ctx.measureText(label).width + 4;
            const labelH = 12;
            const labelX = x;
            const labelY = y - labelH - 1;

            ctx.fillStyle = '#e94560';
            ctx.fillRect(labelX, labelY, labelW, labelH);
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'top';
            ctx.fillText(label, labelX + 2, labelY + 1);
        }

        // 偵錯圖在 runRecognition 中處理，這裡不動它
    },

    /**
     * 渲染結果列表
     */
    renderResultsList(result) {
        const list = this.els.resultsList;
        list.innerHTML = '';

        if (result.numbers.length === 0) {
            list.innerHTML = '<div class="no-results">未辨識到任何數字</div>';
            this.els.resultCount.textContent = '0';
            this.els.processingTime.textContent = `${result.processingTime.toFixed(1)}ms`;
            this.els.totalSum.textContent = '0';
            return;
        }

        // 排序：由上到下、由左到右
        const sorted = [...result.numbers].sort((a, b) => {
            if (Math.abs(a.y - b.y) < 10) return a.x - b.x;
            return a.y - b.y;
        });

        let totalSum = 0;
        sorted.forEach((num, i) => {
            totalSum += num.value;

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <span class="result-index">#${i + 1}</span>
                <span class="result-value">${num.valueStr}</span>
                <span class="result-pos">(${num.x}, ${num.y})</span>
                <span class="result-conf">${(num.confidence * 100).toFixed(1)}%</span>
            `;

            // 滑鼠懸停高亮對應的框
            item.addEventListener('mouseenter', () => {
                this.highlightNumber(num);
            });
            item.addEventListener('mouseleave', () => {
                this.drawResults(result);
            });

            list.appendChild(item);
        });

        this.els.resultCount.textContent = result.numbers.length.toString();
        this.els.processingTime.textContent = `${result.processingTime.toFixed(1)}ms`;
        this.els.totalSum.textContent = totalSum.toLocaleString();
    },

    /**
     * 高亮指定數字的框
     */
    highlightNumber(num) {
        if (!this.lastResult) return;

        // 重繪所有框
        this.drawResults(this.lastResult);

        // 在指定數字上加粗高亮
        const canvas = this.els.resultCanvas;
        const ctx = canvas.getContext('2d');
        const padding = 3;

        ctx.strokeStyle = '#f0c040';
        ctx.lineWidth = 2;
        ctx.strokeRect(
            num.x - padding, num.y - padding,
            num.w + padding * 2, num.h + padding * 2
        );

        // 加上箭頭光暈
        ctx.shadowColor = '#f0c040';
        ctx.shadowBlur = 6;
        ctx.strokeRect(
            num.x - padding, num.y - padding,
            num.w + padding * 2, num.h + padding * 2
        );
        ctx.shadowBlur = 0;
    },

    /**
     * 匯出 CSV
     *
     * 優先順序：
     *   1. 有道具辨識結果 → 匯出道具清單（名稱、數量、單價、小計）
     *   2. 否則 → 匯出數字 OCR 結果
     */
    exportCSV() {
        // ── 道具辨識結果 ──────────────────────────────────────────
        const hasItems = this.lastItemResults?.some(r => r.matches.length > 0);
        if (hasItems) {
            const headers = '道具名稱,位置X,位置Y,數量,單價(z),小計(z),信心度\n';
            const rows = [];
            let grandTotal = 0;
            let hasGrand = false;

            for (const g of this.lastItemResults) {
                for (const m of g.matches) {
                    const qty    = m.quantity  != null ? m.quantity  : '';
                    const price  = g.price     != null ? g.price     : '';
                    const sub    = (m.quantity != null && g.price != null)
                        ? m.quantity * g.price : '';
                    if (sub !== '') { grandTotal += sub; hasGrand = true; }
                    const conf = `${(m.confidence * 100).toFixed(1)}%`;
                    // 名稱含逗號時加引號
                    const name = g.name.includes(',') ? `"${g.name}"` : g.name;
                    rows.push([name, m.x, m.y, qty, price, sub, conf].join(','));
                }
            }

            // 合計行
            if (hasGrand) {
                rows.push(''); // 空行
                rows.push(`總計,,,,,${grandTotal},`);
            }

            this.downloadFile(
                '\uFEFF' + headers + rows.join('\n'),
                'ro_items_detected.csv',
                'text/csv;charset=utf-8'
            );
            return;
        }

        // ── 數字 OCR 結果 ─────────────────────────────────────────
        if (!this.lastResult || this.lastResult.numbers.length === 0) return;

        const headers = '編號,數值,X座標,Y座標,信心度\n';
        const rows = this.lastResult.numbers
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((n, i) => `${i + 1},${n.value},${n.x},${n.y},${(n.confidence * 100).toFixed(1)}%`)
            .join('\n');

        // 加 BOM 避免 Excel 亂碼
        this.downloadFile('\uFEFF' + headers + rows, 'ro_ocr.csv', 'text/csv;charset=utf-8');
    },

    /**
     * 匯出 JSON
     *
     * 優先順序：
     *   1. 有道具辨識結果 → 匯出道具清單 + 總計
     *   2. 否則 → 匯出數字 OCR 結果
     */
    exportJSON() {
        // ── 道具辨識結果 ──────────────────────────────────────────
        const hasItems = this.lastItemResults?.some(r => r.matches.length > 0);
        if (hasItems) {
            let grandTotal = 0;
            const items = this.lastItemResults
                .filter(g => g.matches.length > 0)
                .map(g => {
                    const totalQty = g.matches.reduce((s, m) => s + (m.quantity ?? 0), 0);
                    const subtotal = g.price != null ? totalQty * g.price : null;
                    if (subtotal != null) grandTotal += subtotal;
                    return {
                        name: g.name,
                        unitPrice: g.price ?? null,
                        totalQuantity: totalQty,
                        subtotal,
                        matches: g.matches.map(m => ({
                            x: m.x, y: m.y,
                            w: m.w, h: m.h,
                            quantity: m.quantity,
                            confidence: parseFloat(m.confidence.toFixed(4)),
                            rowPrice: (m.quantity != null && g.price != null)
                                ? m.quantity * g.price : null
                        }))
                    };
                });

            const data = {
                timestamp: new Date().toISOString(),
                grandTotal,
                items
            };

            this.downloadFile(
                JSON.stringify(data, null, 2),
                'ro_items_detected.json',
                'application/json'
            );
            return;
        }

        // ── 數字 OCR 結果 ─────────────────────────────────────────
        if (!this.lastResult || this.lastResult.numbers.length === 0) return;

        const data = {
            timestamp: new Date().toISOString(),
            count: this.lastResult.numbers.length,
            processingTime: this.lastResult.processingTime,
            numbers: this.lastResult.numbers.map(n => ({
                value: n.value,
                x: n.x,
                y: n.y,
                confidence: n.confidence
            }))
        };

        this.downloadFile(JSON.stringify(data, null, 2), 'ro_ocr.json', 'application/json');
    },

    /**
     * 下載檔案
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * 更新狀態列
     */
    setStatus(text, type = 'ready') {
        this.els.statusText.textContent = text;
        this.els.statusBar.className = `status-bar ${type}`;
    },

    // =========================================================
    // 縮放功能
    // =========================================================

    /**
     * 設定 canvas 顯示縮放比
     * @param {number} level - 縮放倍率（0.1 ~ 8.0）
     */
    setZoom(level) {
        this.zoomLevel = Math.min(Math.max(level, 0.10), 8.0);
        this.zoomLevel = Math.round(this.zoomLevel * 100) / 100; // 避免浮點誤差

        const sc = this.els.sourceCanvas;
        const rc = this.els.resultCanvas;
        if (sc.width === 0) return; // 尚未載入圖片

        const displayW = Math.round(sc.width * this.zoomLevel);
        const displayH = Math.round(sc.height * this.zoomLevel);

        sc.style.width  = `${displayW}px`;
        sc.style.height = `${displayH}px`;
        rc.style.width  = `${displayW}px`;
        rc.style.height = `${displayH}px`;

        const pct = Math.round(this.zoomLevel * 100);
        this.els.zoomLevelDisplay.textContent = `${pct}%`;
    },

    /**
     * 縮放至符合 canvas-wrapper 尺寸（「⊡ 符合」按鈕用）
     */
    zoomToFit() {
        const sc = this.els.sourceCanvas;
        if (sc.width === 0) return;

        const wrapper = this.els.canvasWrapper;
        // 扣掉 padding（0.5rem × 2 ≈ 16px）
        const availW = wrapper.clientWidth - 16;
        const availH = wrapper.clientHeight - 16;
        const fitScale = Math.min(availW / sc.width, availH / sc.height, 1.0);
        this.setZoom(fitScale);
    },

    // =========================================================
    // 道具樣本庫：框選、建立模板
    // =========================================================


    /**
     * 進入道具框選模式
     */
    startItemSelection() {
        if (!this.currentImage) {
            this.setStatus('請先上傳截圖', 'error');
            return;
        }
        this.isSelectingItem = true;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.els.canvasContainer.classList.add('selecting-mode');
        this.els.selectionHint.classList.add('active');
        // result-canvas 需要 pointer-events 才能接收滑鼠事件
        this.els.resultCanvas.style.pointerEvents = 'auto';

        // 清空所有辨識標示，提供乾淨的截圖畫面
        const ctx = this.els.resultCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.els.resultCanvas.width, this.els.resultCanvas.height);

        this.setStatus('框選模式：在截圖上拖曳框選道具圖示', 'loading');
    },

    /**
     * 取消框選模式
     */
    cancelItemSelection() {
        this.isSelectingItem = false;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.els.canvasContainer.classList.remove('selecting-mode');
        this.els.selectionHint.classList.remove('active');
        this.els.resultCanvas.style.pointerEvents = 'none';

        // 恢復原本的標示
        if (this.lastItemResults) {
            this.drawItemResults(this.lastItemResults);
        } else if (this.lastResult) {
            this.drawResults(this.lastResult);
        } else {
            const ctx = this.els.resultCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.els.resultCanvas.width, this.els.resultCanvas.height);
        }
        this.setStatus('已取消框選', 'ready');
    },

    /**
     * 取得滑鼠相對於 canvas 的座標（考慮 canvas 縮放比）
     */
    getCanvasCoord(e) {
        const canvas = this.els.resultCanvas;
        const rect = canvas.getBoundingClientRect();
        // canvas 實際顯示尺寸 vs 原始尺寸的比例
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: Math.round((e.clientX - rect.left) * scaleX),
            y: Math.round((e.clientY - rect.top) * scaleY)
        };
    },

    /** 框選 mousedown */
    onSelectionMouseDown(e) {
        if (!this.isSelectingItem) return;
        e.preventDefault();
        this.selectionStart = this.getCanvasCoord(e);
        this.selectionEnd = { ...this.selectionStart };
    },

    /** 框選 mousemove：即時繪製虛線框 */
    onSelectionMouseMove(e) {
        if (!this.isSelectingItem || !this.selectionStart) return;
        e.preventDefault();
        this.selectionEnd = this.getCanvasCoord(e);
        this.drawSelectionRect();
    },

    /** 框選 mouseup：完成框選 */
    onSelectionMouseUp(e) {
        if (!this.isSelectingItem || !this.selectionStart) return;
        e.preventDefault();
        this.selectionEnd = this.getCanvasCoord(e);

        const rect = this.normalizeRect(this.selectionStart, this.selectionEnd);
        if (rect.w < 5 || rect.h < 5) {
            this.setStatus('框選區域太小，請重試', 'error');
            return;
        }

        // 退出框選模式
        this.isSelectingItem = false;
        this.els.canvasContainer.classList.remove('selecting-mode');
        this.els.selectionHint.classList.remove('active');
        this.els.resultCanvas.style.pointerEvents = 'none';

        // 恢復原本的標示
        if (this.lastItemResults) {
            this.drawItemResults(this.lastItemResults);
        } else if (this.lastResult) {
            this.drawResults(this.lastResult);
        }

        // 執行模板建立（OCR 去除數字）
        this.buildItemTemplate(rect);
    },

    /**
     * 繪製即時框選虛線矩形
     */
    drawSelectionRect() {
        const ctx = this.els.resultCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.els.resultCanvas.width, this.els.resultCanvas.height);
        // 框選時不繪製其他標示，保持畫面乾淨

        if (!this.selectionStart || !this.selectionEnd) return;
        const { x, y, w, h } = this.normalizeRect(this.selectionStart, this.selectionEnd);

        ctx.save();
        ctx.strokeStyle = 'rgba(78, 204, 163, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(78, 204, 163, 0.08)';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    },

    /**
     * 標準化矩形（確保 x/y 為左上角）
     */
    normalizeRect(start, end) {
        return {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.abs(end.x - start.x),
            h: Math.abs(end.y - start.y)
        };
    },

    /**
     * 建立道具模板（OCR 定位數字 → inpainting → 開啟確認彈窗）
     */
    buildItemTemplate(rect) {
        this.setStatus('正在分析數字位置...', 'loading');

        // 使用 requestAnimationFrame 讓 UI 更新後再執行 OpenCV 運算
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    const result = ItemDetector.createCleanTemplate(
                        this.els.sourceCanvas,
                        rect,
                        this.templates,   // 數字模板（0~9）
                        {
                            matchThreshold: parseFloat(this.els.matchThreshold.value),
                            binaryThreshold: parseInt(this.els.binaryThreshold.value)
                        }
                    );

                    this.pendingTemplate = { rect, ...result };

                    // 在彈窗中顯示預覽
                    this.openItemModal(result);
                    this.setStatus('就緒！請確認模板並輸入道具名稱', 'ready');
                } catch (err) {
                    console.error('建立模板失敗:', err);
                    this.setStatus(`建立模板失敗：${err.message}`, 'error');
                }
            }, 30);
        });
    },

    /**
     * 開啟確認彈窗並填入預覽
     */
    openItemModal(result) {
        const { cleanCanvas, maskCanvas, maskedRects, usedOcr } = result;

        // 縮放預覽（最大 140×140）
        const scale = Math.min(140 / cleanCanvas.width, 140 / cleanCanvas.height, 6);

        // 左側：原始框選（從 sourceCanvas 直接裁切，不帶紅框標示）
        const origCv = this.els.modalOriginalCanvas;
        origCv.width = Math.round(cleanCanvas.width * scale);
        origCv.height = Math.round(cleanCanvas.height * scale);
        const origCtx = origCv.getContext('2d');
        origCtx.imageSmoothingEnabled = false;
        const { rect } = this.pendingTemplate;
        origCtx.drawImage(
            this.els.sourceCanvas,
            rect.x, rect.y, rect.w, rect.h,
            0, 0, origCv.width, origCv.height
        );

        // 右側：inpainting 後的純淨模板
        const cleanCv = this.els.modalCleanCanvas;
        cleanCv.width = origCv.width;
        cleanCv.height = origCv.height;
        const cleanCtx = cleanCv.getContext('2d');
        cleanCtx.imageSmoothingEnabled = false;
        cleanCtx.drawImage(cleanCanvas, 0, 0, cleanCv.width, cleanCv.height);

        // OCR 定位資訊
        const ocrInfo = this.els.modalOcrInfo;
        const ocrText = this.els.modalOcrText;
        if (usedOcr) {
            ocrInfo.className = 'modal-ocr-info success';
            ocrText.textContent = `OCR 精確定位到 ${maskedRects.length} 個數字區域，已去除`;
        } else {
            ocrInfo.className = 'modal-ocr-info fallback';
            ocrText.textContent = '未偵測到數字，直接使用原始圖作為模板';
        }

        // 清空名稱輸入，顯示彈窗
        this.els.modalItemName.value = '';
        this.els.itemModal.classList.add('active');
        setTimeout(() => this.els.modalItemName.focus(), 100);
    },

    /**
     * 關閉確認彈窗
     * @param {boolean} confirmed - true = 使用者確認儲存
     */
    closeItemModal(confirmed) {
        this.els.itemModal.classList.remove('active');

        if (confirmed && this.pendingTemplate) {
            const { cleanCanvas, maskedRects, usedOcr } = this.pendingTemplate;
            const name = this.els.modalItemName.value.trim() ||
                `道具 #${ItemDetector.loadTemplates().length + 1}`;

            ItemDetector.saveTemplate(name, cleanCanvas, maskedRects, usedOcr);
            this.renderItemTemplateList();

            // 有截圖 + 有模板 → 啟用辨識按鈕
            if (this.currentImage) this.els.detectItemsBtn.disabled = false;
            this.setStatus(`✓ 已儲存道具樣本「${name}」`, 'ready');
        }

        this.pendingTemplate = null;
        // 還原 result-canvas 顯示
        if (this.lastResult) this.drawResults(this.lastResult);
        else {
            const ctx = this.els.resultCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.els.resultCanvas.width, this.els.resultCanvas.height);
        }
    },

    // =========================================================
    // 道具樣本庫：渲染模板列表
    // =========================================================

    /**
     * 渲染左側道具模板列表
     */
    renderItemTemplateList() {
        const templates = ItemDetector.loadTemplates();
        const container = this.els.itemTemplateList;
        container.innerHTML = '';

        if (templates.length === 0) {
            container.innerHTML = `
                <div class="no-templates-hint">
                    尚無道具樣本<br>
                    <span style="opacity:0.6">上傳截圖後點「截圖建立樣本」</span>
                </div>`;
            return;
        }

        for (const tmpl of templates) {
            const card = document.createElement('div');
            card.className = 'item-template-card';
            card.dataset.id = tmpl.id;

            // 縮圖
            const thumb = document.createElement('img');
            thumb.className = 'item-template-thumb';
            thumb.src = tmpl.dataUrl;
            thumb.alt = tmpl.name;

            // 資訊區
            const info = document.createElement('div');
            info.className = 'item-template-info';

            // 道具名稱（可點擊編輯）
            const nameEl = document.createElement('div');
            nameEl.className = 'item-template-name';
            nameEl.textContent = tmpl.name;
            nameEl.title = '點擊編輯名稱';
            nameEl.style.cursor = 'pointer';
            nameEl.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'item-name-inline-input';
                input.value = tmpl.name;
                input.maxLength = 20;
                nameEl.replaceWith(input);
                input.focus();
                input.select();
                const save = () => {
                    const newName = input.value.trim() || tmpl.name;
                    ItemDetector.updateTemplate(tmpl.id, { name: newName });
                    this.renderItemTemplateList();
                };
                input.addEventListener('blur', save);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); save(); }
                    if (e.key === 'Escape') this.renderItemTemplateList();
                });
            });



            // 單價輸入區
            const priceRow = document.createElement('div');
            priceRow.className = 'item-price-row';

            const priceLabel = document.createElement('span');
            priceLabel.className = 'item-price-label';
            priceLabel.textContent = '單價';

            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.className = 'item-price-input';
            priceInput.placeholder = '0';
            priceInput.min = '0';
            priceInput.step = '1';
            priceInput.value = tmpl.price != null ? tmpl.price : '';

            const priceSuffix = document.createElement('span');
            priceSuffix.className = 'item-price-suffix';
            priceSuffix.textContent = 'z';

            const savePrice = () => {
                const val = parseFloat(priceInput.value);
                const price = isNaN(val) || val < 0 ? null : Math.round(val);
                ItemDetector.updateTemplate(tmpl.id, { price });
                if (price === null) priceInput.value = '';
            };
            priceInput.addEventListener('blur', savePrice);
            priceInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); priceInput.blur(); }
            });

            priceRow.appendChild(priceLabel);
            priceRow.appendChild(priceInput);
            priceRow.appendChild(priceSuffix);

            // info：名稱 → 單價
            info.appendChild(nameEl);
            info.appendChild(priceRow);

            // 刪除按鈕（絕對定位於右上角，由 CSS 控制位置）
            const delBtn = document.createElement('button');
            delBtn.className = 'item-template-delete';
            delBtn.title = '刪除此道具樣本';
            delBtn.textContent = '✕';
            delBtn.addEventListener('click', () => {
                ItemDetector.deleteTemplate(tmpl.id);
                this.renderItemTemplateList();
                if (ItemDetector.loadTemplates().length === 0) {
                    this.els.detectItemsBtn.disabled = true;
                }
            });

            // 卡片結構：刪除鈕（絕對定位）→ 縮圖 → info
            card.appendChild(delBtn);
            card.appendChild(thumb);
            card.appendChild(info);
            container.appendChild(card);
        }
    },

    // =========================================================
    // 道具辨識
    // =========================================================

    /**
     * 對所有道具模板執行匹配 + OCR，渲染結果
     *
     * 匹配流程：
     *   1. 執行全圖數字辨識（取得 nmsMatches 個別數字框 + 全圖 numbers 供顯示）
     *   2. 對截圖執行道具模板匹配，找出所有道具位置
     *   3. 針對每個道具框，直接裁切「右下角 ROI 區域」做局部 OCR，
     *      精確取得該道具的數量（不依賴全圖 cross-reference 中心點篩選，
     *      避免多位數字有部分中心點落在區域外而漏判）
     */
    async detectAllItems() {
        if (!this.currentImage) {
            this.setStatus('請先上傳截圖', 'error');
            return;
        }
        const templates = ItemDetector.loadTemplates();
        if (templates.length === 0) {
            this.setStatus('請先建立道具樣本', 'error');
            return;
        }

        this.setStatus(`正在辨識 ${templates.length} 種道具...`, 'loading');
        this.els.detectItemsBtn.disabled = true;

        try {
            const startTime = performance.now();

            // ── 步驟 1：全圖數字辨識（供顯示用，非匹配依據）─────────────
            const ocrOpts = {
                matchThreshold: parseFloat(this.els.matchThreshold.value),
                binaryThreshold: parseInt(this.els.binaryThreshold.value),
                nmsIouThreshold: 0.3,
                yTolerance: 4,
                maxGapX: 8,
                debug: false
            };
            this.setStatus('先掃描全圖數字...', 'loading');
            this.lastResult = OCREngine.recognizeNumbers(
                this.els.sourceCanvas, this.templates, ocrOpts
            );
            this.drawResults(this.lastResult);
            this.renderResultsList(this.lastResult);

            // ── 步驟 2：道具模板匹配 ─────────────────────────────────────
            this.setStatus(`正在比對 ${templates.length} 種道具模板...`, 'loading');
            const matchOpts = {
                itemMatchThreshold: parseFloat(this.els.itemMatchThreshold.value),
                nmsIouThreshold: 0.4,
                matchThreshold: parseFloat(this.els.matchThreshold.value),
                binaryThreshold: parseInt(this.els.binaryThreshold.value)
            };

            // detectAll 內部已對每個 match 呼叫 recognizeQuantity（全道具框 OCR），
            // 步驟 3 會再以局部右下角 ROI OCR 覆蓋，精度更高。
            const results = await ItemDetector.detectAll(
                this.els.sourceCanvas, templates, this.templates, matchOpts
            );

            // 把每個模板的 price 帶入結果
            const templateMap = Object.fromEntries(templates.map(t => [t.id, t]));
            for (const r of results) {
                const tmpl = templateMap[r.templateId];
                r.price = tmpl ? (tmpl.price ?? null) : null;
            }

            // ── 步驟 3：把全圖 OCR 識別到的數字「對應」到每個道具框 ────────
            // 全圖 OCR（步驟 1）已正確識別所有數字及其位置（lastResult.numbers）。
            // 這裡只需做「空間匹配」：找出每個道具框右下角區域內的數字即可，
            // 完全不需要重跑 OCR，直接使用現成結果。
            //
            // 匹配邏輯：
            //   ・搜尋區域 = 道具框右下角（從 30% 位置起）+ 外溢 12px
            //   ・條件 = 數字的「中心點」落在搜尋區域內
            //   ・多個候選 → 取中心點最接近道具框右下角的那個
            let matchedCount = 0;
            const ocrNumbers = this.lastResult?.numbers ?? [];

            if (ocrNumbers.length > 0) {
                const OVF = 12; // 允許數字超出道具框邊緣的像素數

                for (const group of results) {
                    for (const match of group.matches) {
                        const { x, y, w, h } = match;

                        // 道具框右下角的搜尋區域
                        const zoneX1 = x + w * 0.30;
                        const zoneY1 = y + h * 0.30;
                        const zoneX2 = x + w + OVF;
                        const zoneY2 = y + h + OVF;

                        // 找中心點落在搜尋區域內的所有數字
                        const candidates = ocrNumbers.filter(n => {
                            const cx = n.x + n.w / 2;
                            const cy = n.y + n.h / 2;
                            return cx >= zoneX1 && cx <= zoneX2
                                && cy >= zoneY1 && cy <= zoneY2;
                        });

                        if (candidates.length > 0) {
                            // 取中心點最接近道具框右下角 (x+w, y+h) 的那個
                            const cornerX = x + w;
                            const cornerY = y + h;
                            const best = candidates.reduce((a, b) => {
                                const da = Math.hypot(a.x + a.w / 2 - cornerX, a.y + a.h / 2 - cornerY);
                                const db = Math.hypot(b.x + b.w / 2 - cornerX, b.y + b.h / 2 - cornerY);
                                return da <= db ? a : b;
                            });
                            match.quantity    = best.value;
                            match.quantityStr = best.valueStr;
                            match.qtySource   = 'spatial-match';
                            matchedCount++;
                            console.debug(`[QTY] ${group.name} @ (${x},${y}) => ${best.value}`);
                        } else {
                            console.warn(`[QTY] ${group.name} @ (${x},${y}) 找不到對應數字（搜尋區: ${zoneX1.toFixed(0)},${zoneY1.toFixed(0)}~${zoneX2.toFixed(0)},${zoneY2.toFixed(0)}）`);
                        }
                    }
                }
            } else {
                console.warn('[QTY] 全圖 OCR 沒有識別到任何數字，無法做空間匹配');
            }
            const localOcrCount = matchedCount;

            const elapsed = performance.now() - startTime;
            this.lastItemResults = results;

            // 重繪：道具框 + 保留數字框
            this.drawItemResults(results);
            this.renderItemResultsList(results);

            const totalFound = results.reduce((s, r) => s + r.matches.length, 0);
            this.setStatus(
                `道具辨識完成！找到 ${totalFound} 個道具` +
                (localOcrCount > 0 ? `（${localOcrCount} 個數量局部辨識成功）` : '') +
                `，耗時 ${elapsed.toFixed(1)}ms`,
                'ready'
            );
        } catch (err) {
            console.error('道具辨識失敗:', err);
            this.setStatus(`道具辨識失敗：${err.message}`, 'error');
        } finally {
            this.els.detectItemsBtn.disabled = false;
        }
    },

    /**
     * 在 result-canvas 上繪製道具匹配框
     *
     * 每個匹配框包含：
     *   ・頂部 badge：道具名稱（靠近頂緣時移至框內）
     *   ・右下角 badge：×數量
     *   ・設有單價時，右下角額外顯示「n z」小計
     */
    drawItemResults(results) {
        const canvas = this.els.resultCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // roundRect 相容性 polyfill（Chrome < 99、Firefox < 112 不支援）
        if (typeof ctx.roundRect !== 'function') {
            ctx.roundRect = function(x, y, w, h) { this.rect(x, y, w, h); };
        }

        // 若有數字辨識結果也保留
        if (this.lastResult) this.drawResults(this.lastResult);

        const colors = [
            '#4ecca3', '#7c5cbf', '#3d8bfd', '#f0c040', '#e94560',
            '#ff8c00', '#00ced1', '#da70d6', '#adff2f', '#ff6347'
        ];

        // 輔助：解析 hex → {r,g,b}
        const hexToRgb = (hex) => ({
            r: parseInt(hex.slice(1,3), 16),
            g: parseInt(hex.slice(3,5), 16),
            b: parseInt(hex.slice(5,7), 16)
        });

        // 輔助：在指定位置繪製圓角色塊 + 白色文字
        const drawBadge = (text, lx, ly, bgColor, textColor = '#fff', font = 'bold 10px Inter, sans-serif') => {
            ctx.font = font;
            const tw = ctx.measureText(text).width;
            const padX = 4, padY = 2;
            const bw = tw + padX * 2;
            const bh = 13;
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.roundRect(lx, ly, bw, bh, 3);
            ctx.fill();
            ctx.fillStyle = textColor;
            ctx.textBaseline = 'top';
            ctx.fillText(text, lx + padX, ly + padY);
            return { bw, bh };
        };

        results.forEach((group, gi) => {
            const color = colors[gi % colors.length];
            const { r, g, b } = hexToRgb(color);

            for (const m of group.matches) {
                // ── 半透明背景 ──────────────────────────
                ctx.fillStyle = `rgba(${r},${g},${b},0.13)`;
                ctx.fillRect(m.x, m.y, m.w, m.h);

                // ── 邊框 ────────────────────────────────
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(m.x, m.y, m.w, m.h);

                // ── 道具名稱 badge（框頂部）──────────────
                const nameBadgeH = 13;
                // 若框頂部離畫面邊緣不足，放到框內頂部
                const nameY = m.y >= nameBadgeH + 2
                    ? m.y - nameBadgeH - 1
                    : m.y + 1;
                drawBadge(
                    group.name,
                    m.x,
                    nameY,
                    `rgba(${r},${g},${b},0.88)`,
                    '#fff'
                );

                // ── 數量 badge（右下角）──────────────────
                const qty = m.quantityStr || (m.quantity !== null ? String(m.quantity) : '?');
                const qtyText = `×${qty}`;
                ctx.font = 'bold 10px Inter, sans-serif';
                const qtyW = ctx.measureText(qtyText).width + 8;
                const qtyH = 13;
                const qtyX = m.x + m.w - qtyW;
                const qtyY = m.y + m.h - qtyH - 1;
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.beginPath();
                ctx.roundRect(qtyX, qtyY, qtyW, qtyH, 3);
                ctx.fill();
                ctx.fillStyle = color;
                ctx.textBaseline = 'top';
                ctx.fillText(qtyText, qtyX + 4, qtyY + 2);

                // ── 單格小計 badge（有設單價時，右下角數量下方）──
                const price = group.price ?? null;
                if (price !== null && m.quantity !== null) {
                    const subtotal = (m.quantity * price).toLocaleString();
                    const priceText = `${subtotal}z`;
                    ctx.font = 'bold 9px Inter, sans-serif';
                    const pw = ctx.measureText(priceText).width + 6;
                    const ph = 12;
                    const px = m.x + m.w - pw;
                    const py = m.y + m.h + 1;
                    ctx.fillStyle = 'rgba(240,192,64,0.85)';
                    ctx.beginPath();
                    ctx.roundRect(px, py, pw, ph, 3);
                    ctx.fill();
                    ctx.fillStyle = '#1a1a2e';
                    ctx.textBaseline = 'top';
                    ctx.fillText(priceText, px + 3, py + 2);
                }
            }
        });
    },

    /**
     * 渲染右側道具辨識結果列表
     */
    renderItemResultsList(results) {
        const section = this.els.itemResultsSection;
        const list = this.els.itemResultsList;
        list.innerHTML = '';

        const hasAny = results.some(r => r.matches.length > 0);
        if (!hasAny) {
            list.innerHTML = '<div class="no-results">未找到任何道具</div>';
            section.style.display = 'block';
            return;
        }

        let grandTotal = 0;    // 全部道具總價値
        let grandHasPrice = false;

        for (const group of results) {
            if (group.matches.length === 0) continue;

            const groupEl = document.createElement('div');
            groupEl.className = 'item-result-group';

            // 計算此道具組小計
            const totalQty = group.matches.reduce((s, m) => s + (m.quantity || 0), 0);
            const price = group.price;          // 單價（可能為 null）
            const hasPrice = price != null;
            const subtotal = hasPrice ? totalQty * price : null;
            if (hasPrice) { grandTotal += subtotal; grandHasPrice = true; }

            // 群組標題
            const header = document.createElement('div');
            header.className = 'item-result-header';

            const thumbEl = document.createElement('img');
            thumbEl.className = 'item-result-thumb';
            thumbEl.src = group.dataUrl;
            thumbEl.alt = group.name;

            const nameEl = document.createElement('span');
            nameEl.className = 'item-result-name';
            nameEl.textContent = group.name;

            // 數量處 + 單價資訊
            const summaryEl = document.createElement('div');
            summaryEl.className = 'item-result-summary';
            summaryEl.innerHTML = `
                <span class="item-result-total-qty">共 <b>${totalQty.toLocaleString()}</b> 個</span>
                ${hasPrice
                    ? `<span class="item-result-subtotal">≈ ${subtotal.toLocaleString()} z</span>`
                    : `<span class="item-result-no-price">未設定單價</span>`
                }`;

            header.appendChild(thumbEl);
            header.appendChild(nameEl);
            header.appendChild(summaryEl);
            groupEl.appendChild(header);

            // 各匹配列（可展開）
            const rows = document.createElement('div');
            rows.className = 'item-result-rows';
            group.matches.forEach((m, i) => {
                const row = document.createElement('div');
                row.className = 'item-result-row';

                const idx = document.createElement('span');
                idx.className = 'item-result-row-idx';
                idx.textContent = `#${i + 1}`;

                const pos = document.createElement('span');
                pos.className = 'item-result-pos';
                pos.textContent = `(${m.x}, ${m.y})`;

                const qty = document.createElement('span');
                const hasQty = m.quantity !== null;
                qty.className = `item-result-qty${hasQty ? '' : ' unknown'}`;
                qty.textContent = hasQty ? `×${m.quantity.toLocaleString()}` : '×?';

                const conf = document.createElement('span');
                conf.className = 'item-result-conf';
                conf.textContent = `${(m.confidence * 100).toFixed(1)}%`;

                // 每個道具的小計
                const rowPrice = document.createElement('span');
                rowPrice.className = 'item-result-row-price';
                if (hasPrice && hasQty) {
                    rowPrice.textContent = `${(m.quantity * price).toLocaleString()} z`;
                    rowPrice.style.color = 'var(--accent-gold)';
                } else {
                    rowPrice.textContent = '—';
                    rowPrice.style.color = 'var(--text-muted)';
                }

                row.appendChild(idx);
                row.appendChild(pos);
                row.appendChild(qty);
                row.appendChild(conf);
                row.appendChild(rowPrice);

                // 懸停高亮
                row.addEventListener('mouseenter', () => {
                    this.drawItemResults(results);
                    const canvas = this.els.resultCanvas;
                    const ctx = canvas.getContext('2d');
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.shadowColor = '#fff';
                    ctx.shadowBlur = 8;
                    ctx.strokeRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
                    ctx.shadowBlur = 0;
                });
                row.addEventListener('mouseleave', () => this.drawItemResults(results));

                rows.appendChild(row);
            });
            groupEl.appendChild(rows);
            list.appendChild(groupEl);
        }

        // 更新頂部獨立的總計顯示
        const totalDisplay = document.getElementById('total-value-display');
        if (totalDisplay) {
            totalDisplay.textContent = grandHasPrice ? grandTotal.toLocaleString() : '—';
        }

        // 列表內的總計區
        if (grandHasPrice) {
            const totalEl = document.createElement('div');
            totalEl.className = 'item-result-grand-total';
            totalEl.innerHTML = `
                <span class="grand-total-label">💰 全部總計</span>
                <span class="grand-total-value">${grandTotal.toLocaleString()} z</span>`;
            list.appendChild(totalEl);
        }

        section.style.display = 'block';
    }
};

// OpenCV.js 載入完成的全域回調
function onOpenCvReady() {
    console.log('OpenCV.js 已載入');
    App.onCvReady();
}

// 頁面載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
