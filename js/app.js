/**
 * RO 道具數量辨識器 - 主程式
 * 負責 UI 控制、事件綁定、OpenCV.js 管理、模板載入和結果渲染
 */

const App = {
    // 狀態
    cvReady: false,
    templates: [],
    currentImage: null,
    lastResult: null,

    // DOM 元素快取
    els: {},

    /**
     * 初始化應用程式
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.initOpenCV();
    },

    /**
     * 快取 DOM 元素引用
     */
    cacheElements() {
        this.els = {
            // 上傳區域
            dropZone: document.getElementById('drop-zone'),
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

            // 模板預覽
            templatePreview: document.getElementById('template-preview'),
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
        });
        this.els.binaryThreshold.addEventListener('input', (e) => {
            this.els.binaryThresholdVal.textContent = e.target.value;
        });

        // 辨識按鈕
        this.els.recognizeBtn.addEventListener('click', () => this.runRecognition());

        // 匯出按鈕
        this.els.exportCsvBtn.addEventListener('click', () => this.exportCSV());
        this.els.exportJsonBtn.addEventListener('click', () => this.exportJSON());

        // 偵錯模式：切換時重新辨識以產生/隱藏偵錯圖
        this.els.debugMode.addEventListener('change', () => {
            if (this.els.debugMode.checked) {
                // 開啟偵錯模式：重新辨識以產生偵錯圖
                if (this.currentImage) {
                    this.runRecognition();
                }
            } else {
                // 關閉偵錯模式：隱藏偵錯 canvas
                this.els.debugCanvas.style.display = 'none';
            }
        });
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
        this.setStatus('就緒！請上傳 RO 截圖', 'ready');
    },

    /**
     * 載入數字模板 (0~9)
     */
    async loadTemplates() {
        this.templates = [];
        const previewContainer = this.els.templatePreview;
        previewContainer.innerHTML = '';

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

                // 模板預覽 UI
                const preview = document.createElement('div');
                preview.className = 'template-item';
                preview.innerHTML = `<span class="template-digit">${digit}</span>`;
                const previewCanvas = document.createElement('canvas');
                previewCanvas.width = img.naturalWidth * 4;
                previewCanvas.height = img.naturalHeight * 4;
                previewCanvas.style.imageRendering = 'pixelated';
                const pCtx = previewCanvas.getContext('2d');
                pCtx.imageSmoothingEnabled = false;
                pCtx.drawImage(img, 0, 0, img.naturalWidth * 4, img.naturalHeight * 4);
                preview.appendChild(previewCanvas);
                previewContainer.appendChild(preview);

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
     */
    exportCSV() {
        if (!this.lastResult || this.lastResult.numbers.length === 0) return;

        const headers = '編號,數值,X座標,Y座標,信心度\n';
        const rows = this.lastResult.numbers
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((n, i) => `${i + 1},${n.value},${n.x},${n.y},${(n.confidence * 100).toFixed(1)}%`)
            .join('\n');

        // 加 BOM 避免 Excel 亂碼
        this.downloadFile('\uFEFF' + headers + rows, 'ro_items.csv', 'text/csv;charset=utf-8');
    },

    /**
     * 匯出 JSON
     */
    exportJSON() {
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

        this.downloadFile(JSON.stringify(data, null, 2), 'ro_items.json', 'application/json');
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
