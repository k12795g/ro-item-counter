/**
 * ItemDetector：道具模板管理 + 匹配引擎
 *
 * 流程：
 *   1. 使用者在截圖上框選道具圖示（含右下角數字）
 *   2. 系統自動遮蔽右下角數字區域，用 OpenCV inpainting 填補，產出純淨模板
 *   3. 模板以 base64 儲存於 localStorage，下次直接讀取
 *   4. 辨識時對截圖做 TM_CCOEFF_NORMED 模板匹配，找出所有道具位置
 *   5. 對每個道具位置的右下角，呼叫既有 OCREngine 辨識數量
 */
const ItemDetector = {

    // localStorage 儲存鍵
    STORAGE_KEY: 'ro_item_templates_v1',

    // =========================================================
    // 一、模板建立
    // =========================================================

    /**
     * 從使用者框選的 canvas 區域建立純淨模板
     *
     * 策略（優先 OCR 精確定位）：
     *   1. 對框選區域執行 OCREngine，找出數字的精確邊界框
     *   2. 以 OpenCV Inpainting（INPAINT_TELEA）填補數字區域
     *   3. 若 OCR 未找到數字，退回「遮蔽右下角固定比例」備案
     *
     * @param {HTMLCanvasElement} sourceCanvas - 完整截圖 canvas
     * @param {{x,y,w,h}} rect - 使用者框選的道具矩形（畫面座標）
     * @param {Array} digitTemplates - OCREngine 的數字模板陣列（0~9）
     * @param {Object} ocrOptions - OCR 辨識選項
     * @returns {{cleanCanvas, maskCanvas, maskedRects, usedOcr}}
     */
    createCleanTemplate(sourceCanvas, rect, digitTemplates = [], ocrOptions = {}) {
        const { x, y, w, h } = rect;

        // === 裁切道具區域到臨時 canvas ===
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        tmpCanvas.getContext('2d').drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);

        // === 步驟1：用 OCREngine 找出數字的精確位置 ===
        let maskedRects = [];
        let usedOcr = false;

        if (digitTemplates.length > 0) {
            try {
                const ocrResult = OCREngine.recognizeNumbers(tmpCanvas, digitTemplates, {
                    matchThreshold: ocrOptions.matchThreshold || 0.75,
                    binaryThreshold: ocrOptions.binaryThreshold || 25,
                    nmsIouThreshold: 0.3,
                    yTolerance: 4,
                    maxGapX: 8,
                    debug: false
                });

                // 使用 nmsMatches（個別數字框），精確遮蔽每個數字
                if (ocrResult.nmsMatches && ocrResult.nmsMatches.length > 0) {
                    // 合併相鄰數字為一個矩形（加 padding 避免殘影）
                    const pad = 1;
                    for (const m of ocrResult.nmsMatches) {
                        maskedRects.push({
                            x: Math.max(0, m.x - pad),
                            y: Math.max(0, m.y - pad),
                            w: Math.min(w, m.w + pad * 2),
                            h: Math.min(h, m.h + pad * 2)
                        });
                    }
                    usedOcr = true;
                }
            } catch (e) {
                console.warn('OCR 定位數字失敗，退回固定遮蔽:', e);
            }
        }

        // === 步驟1 備案：找不到數字 → 不做任何處理，直接用原始圖 ===
        if (maskedRects.length === 0) {
            // 直接以原始裁切圖作為模板，不執行 inpainting
            return { cleanCanvas: tmpCanvas, maskCanvas: tmpCanvas, maskedRects: [], usedOcr: false };
        }

        // === 步驟2：建立 inpaint mask（只有 OCR 成功找到數字才執行）===
        const src = cv.imread(tmpCanvas);
        const srcRGB = new cv.Mat();
        // inpaint 需要 3 通道（BGR）
        cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB, 0);

        const inpaintMask = new cv.Mat.zeros(h, w, cv.CV_8UC1);
        for (const r of maskedRects) {
            // 確保不超出邊界
            const rx = Math.max(0, r.x);
            const ry = Math.max(0, r.y);
            const rw = Math.min(r.w, w - rx);
            const rh = Math.min(r.h, h - ry);
            if (rw > 0 && rh > 0) {
                const roi = inpaintMask.roi(new cv.Rect(rx, ry, rw, rh));
                roi.setTo(new cv.Scalar(255));
                roi.delete();
            }
        }

        // === 步驟3：執行 inpainting ===
        const dst = new cv.Mat();
        cv.inpaint(srcRGB, inpaintMask, dst, 3, cv.INPAINT_TELEA);

        // 輸出到 cleanCanvas
        const cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = w;
        cleanCanvas.height = h;
        cv.imshow(cleanCanvas, dst);

        // 輸出 maskCanvas 供預覽（疊加紅色遮蔽框）
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(tmpCanvas, 0, 0);
        maskCtx.fillStyle = 'rgba(233, 69, 96, 0.55)';
        for (const r of maskedRects) {
            maskCtx.fillRect(r.x, r.y, r.w, r.h);
        }

        // 釋放 OpenCV 記憶體
        src.delete();
        srcRGB.delete();
        inpaintMask.delete();
        dst.delete();

        return { cleanCanvas, maskCanvas, maskedRects, usedOcr };
    },

    // =========================================================
    // 二、模板庫管理（localStorage）
    // =========================================================

    /**
     * 載入所有已儲存的道具模板
     * @returns {Array<{id, name, dataUrl, w, h, maskedRects, usedOcr}>}
     */
    loadTemplates() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('載入模板失敗:', e);
            return [];
        }
    },

    /**
     * 儲存道具模板到 localStorage
     * @param {string} name - 道具名稱
     * @param {HTMLCanvasElement} cleanCanvas - 純淨模板 canvas
     * @param {Array} maskedRects - 被遮蔽的數字矩形陣列（相對於道具圖示的座標）
     * @param {boolean} usedOcr - 是否用 OCR 精確定位
     * @returns {Object} 儲存的模板物件
     */
    saveTemplate(name, cleanCanvas, maskedRects = [], usedOcr = false) {
        const templates = this.loadTemplates();
        const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const template = {
            id,
            name: name || `道具 #${templates.length + 1}`,
            dataUrl: cleanCanvas.toDataURL('image/png'),
            w: cleanCanvas.width,
            h: cleanCanvas.height,
            maskedRects,  // 數字區域相對座標，用於辨識時擷取 OCR 範圍
            usedOcr,
            createdAt: new Date().toISOString()
        };
        templates.push(template);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
        return template;
    },

    /**
     * 刪除指定 ID 的模板
     * @param {string} id - 模板 ID
     */
    deleteTemplate(id) {
        const templates = this.loadTemplates().filter(t => t.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
    },

    /**
     * 更新指定模板的欄位（如 name、price）
     * @param {string} id - 模板 ID
     * @param {Object} updates - 要更新的欄位（如 { price: 100, name: '水晶' }）
     * @returns {boolean} 是否找到並更新成功
     */
    updateTemplate(id, updates) {
        const templates = this.loadTemplates();
        const idx = templates.findIndex(t => t.id === id);
        if (idx === -1) return false;
        templates[idx] = { ...templates[idx], ...updates };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(templates));
        return true;
    },

    /**
     * 清空所有模板
     */
    clearAllTemplates() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    // =========================================================
    // 三、道具匹配
    // =========================================================

    /**
     * 對截圖執行單一模板匹配，找出所有道具位置
     *
     * @param {HTMLCanvasElement} sourceCanvas - 完整截圖 canvas
     * @param {HTMLImageElement} templateImg - 純淨模板 Image 物件
     * @param {number} matchThreshold - 匹配信心度閾值（預設 0.80）
     * @param {number} nmsIouThreshold - NMS IoU 閾值（預設 0.4）
     * @returns {Array<{x, y, w, h, confidence}>}
     */
    matchTemplate(sourceCanvas, templateImg, matchThreshold = 0.80, nmsIouThreshold = 0.4) {
        const tw = templateImg.naturalWidth;
        const th = templateImg.naturalHeight;

        if (tw > sourceCanvas.width || th > sourceCanvas.height) {
            console.warn('模板尺寸大於截圖，跳過匹配');
            return [];
        }

        // 建立模板 Mat（RGBA → RGB，保留顏色資訊以區分不同顏色道具）
        const tmplCanvas = document.createElement('canvas');
        tmplCanvas.width = tw;
        tmplCanvas.height = th;
        tmplCanvas.getContext('2d').drawImage(templateImg, 0, 0);

        const srcMat = cv.imread(sourceCanvas);
        const tmplMat = cv.imread(tmplCanvas);
        const srcRGB = new cv.Mat();
        const tmplRGB = new cv.Mat();
        const result = new cv.Mat();

        try {
            // 轉為 RGB 3 通道（保留顏色，TM_CCOEFF_NORMED 支援多通道）
            cv.cvtColor(srcMat, srcRGB, cv.COLOR_RGBA2RGB, 0);
            cv.cvtColor(tmplMat, tmplRGB, cv.COLOR_RGBA2RGB, 0);

            // TM_CCOEFF_NORMED：多通道時對每個通道分別計算，自動考量顏色差異
            cv.matchTemplate(srcRGB, tmplRGB, result, cv.TM_CCOEFF_NORMED);

            // 找出所有高於閾值的位置
            const threshResult = new cv.Mat();
            cv.threshold(result, threshResult, matchThreshold, 1.0, cv.THRESH_BINARY);
            const threshU8 = new cv.Mat();
            threshResult.convertTo(threshU8, cv.CV_8UC1, 255);

            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(threshU8, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const rawMatches = [];
            for (let i = 0; i < contours.size(); i++) {
                const rect = cv.boundingRect(contours.get(i));
                const roi = result.roi(new cv.Rect(
                    Math.max(0, rect.x),
                    Math.max(0, rect.y),
                    Math.min(rect.width, result.cols - rect.x),
                    Math.min(rect.height, result.rows - rect.y)
                ));
                const minMax = cv.minMaxLoc(roi);
                roi.delete();

                rawMatches.push({
                    x: rect.x + (minMax.maxLoc.x || 0),
                    y: rect.y + (minMax.maxLoc.y || 0),
                    w: tw,
                    h: th,
                    confidence: minMax.maxVal
                });
            }

            threshResult.delete();
            threshU8.delete();
            contours.delete();
            hierarchy.delete();

            // NMS 去重複
            return NMS.nonMaxSuppression(rawMatches, nmsIouThreshold);

        } finally {
            srcMat.delete();
            tmplMat.delete();
            srcRGB.delete();
            tmplRGB.delete();
            result.delete();
        }
    },

    // =========================================================
    // 四、對匹配位置執行 OCR（直接用 OCREngine）
    // =========================================================

    /**
     * 對道具矩形擷取數量文字，呼叫 OCREngine 辨識
     *
     * 使用 maskedRects（儲存的數字位置），對匹配到的道具框的對應區域做 OCR。
     * 若沒有 maskedRects，則對整個道具框做 OCR。
     *
     * @param {HTMLCanvasElement} sourceCanvas - 完整截圖
     * @param {{x,y,w,h}} itemRect - 道具位置矩形（匹配結果）
     * @param {Array} maskedRects - 數字區域相對座標（來自模板建立時的紀錄）
     * @param {Array} digitTemplates - 數字模板陣列（App.templates）
     * @param {Object} ocrOptions - OCR 選項
     * @returns {{value: number|null, valueStr: string}} 辨識結果
     */
    recognizeQuantity(sourceCanvas, itemRect, maskedRects, digitTemplates, ocrOptions = {}) {
        const { x, y, w, h } = itemRect;

        // 決定要 OCR 的區域：優先用 maskedRects，否則對整個道具框
        let ocrX, ocrY, ocrW, ocrH;
        if (maskedRects && maskedRects.length > 0) {
            // 取所有 maskedRect 的聯集 bounding box
            const minX = Math.min(...maskedRects.map(r => r.x));
            const minY = Math.min(...maskedRects.map(r => r.y));
            const maxX = Math.max(...maskedRects.map(r => r.x + r.w));
            const maxY = Math.max(...maskedRects.map(r => r.y + r.h));
            ocrX = x + minX;
            ocrY = y + minY;
            ocrW = maxX - minX;
            ocrH = maxY - minY;
        } else {
            // maskedRects 為空（建立模板時 OCR 未找到數字）
            // 退回策略：只 OCR 道具框「右下角」區域
            //   → 右側 60%（x + w*0.4 ~ x + w）
            //   → 下側 60%（y + h*0.4 ~ y + h）
            // 比對整個道具框更準確，可排除道具圖示主體的干擾
            ocrX = x + Math.floor(w * 0.4);
            ocrY = y + Math.floor(h * 0.4);
            ocrW = w - Math.floor(w * 0.4);
            ocrH = h - Math.floor(h * 0.4);
        }

        // 邊界保護
        const cx = Math.max(0, ocrX);
        const cy = Math.max(0, ocrY);
        const cw = Math.min(ocrW, sourceCanvas.width - cx);
        const ch = Math.min(ocrH, sourceCanvas.height - cy);
        if (cw <= 0 || ch <= 0) return { value: null, valueStr: '?' };

        // 擷取 OCR 區域到臨時 canvas
        const numCanvas = document.createElement('canvas');
        numCanvas.width = cw;
        numCanvas.height = ch;
        numCanvas.getContext('2d').drawImage(sourceCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

        // 呼叫 OCREngine 辨識
        try {
            const opts = {
                matchThreshold: ocrOptions.matchThreshold || 0.75,
                binaryThreshold: ocrOptions.binaryThreshold || 25,
                nmsIouThreshold: 0.3,
                yTolerance: 4,
                maxGapX: 8,
                debug: false
            };
            const result = OCREngine.recognizeNumbers(numCanvas, digitTemplates, opts);
            if (result.numbers.length > 0) {
                const best = result.numbers.reduce((a, b) => a.confidence > b.confidence ? a : b);
                return { value: best.value, valueStr: best.valueStr };
            }
        } catch (e) {
            console.warn('OCR 失敗:', e);
        }
        return { value: null, valueStr: '?' };
    },

    // =========================================================
    // 五、完整辨識流程
    // =========================================================

    /**
     * 對所有已儲存的道具模板執行完整的匹配 + OCR 流程
     *
     * @param {HTMLCanvasElement} sourceCanvas - 完整截圖
     * @param {Array} templates - ItemDetector 模板陣列
     * @param {Array} digitTemplates - OCREngine 數字模板陣列
     * @param {Object} options - 選項
     * @returns {Array<{templateId, name, matches: [{x,y,w,h,confidence,quantity}]}>}
     */
    async detectAll(sourceCanvas, templates, digitTemplates, options = {}) {
        const results = [];

        for (const tmpl of templates) {
            // 載入模板圖片
            const img = await this._loadImageFromDataUrl(tmpl.dataUrl);

            // 模板匹配（在截圖中找出所有相同道具的位置）
            const matches = this.matchTemplate(
                sourceCanvas, img,
                options.itemMatchThreshold || 0.80,
                options.nmsIouThreshold || 0.4
            );

            // 對每個匹配位置，用儲存的 maskedRects 精確定位數字後做 OCR
            const matchesWithQty = matches.map(m => {
                const qty = this.recognizeQuantity(
                    sourceCanvas, m,
                    tmpl.maskedRects,
                    digitTemplates, options
                );
                return { ...m, quantity: qty.value, quantityStr: qty.valueStr };
            });

            results.push({
                templateId: tmpl.id,
                name: tmpl.name,
                dataUrl: tmpl.dataUrl,
                matches: matchesWithQty
            });
        }

        return results;
    },

    /**
     * 從 dataUrl 載入 Image（Promise 包裝）
     */
    _loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
        });
    }
};

window.ItemDetector = ItemDetector;
