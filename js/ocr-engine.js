/**
 * OCR 引擎：使用 OpenCV.js 進行模板匹配辨識 RO 道具數量
 * 核心流程：灰階 → 二值化 → 模板匹配 (TM_CCOEFF_NORMED) → NMS → 數字組合
 * 
 * 設計理念：
 * - 使用 TM_CCOEFF_NORMED 不帶 mask，讓它匹配完整的二值化「圖案」
 * - 模板特徵：黑色數字主體→255，白色描邊→0，透明背景→0
 * - 截圖二值化後：黑色數字→255，其餘→0
 * - TM_CCOEFF_NORMED 會比對整個模板矩形內的明暗「模式」，
 *   只有同時符合「這些位置亮、周圍暗」才會高分
 * - 降低二值化閾值（預設 25）可排除深色道具背景的干擾
 */

const OCREngine = {
    /**
     * 前處理截圖：轉灰階 + 二值化，提取深色像素（數字主體）
     * @param {cv.Mat} srcMat - 來源圖片 (RGBA)
     * @param {number} threshold - 二值化閾值（低於此值的像素視為「黑色/數字」）
     * @returns {cv.Mat} 二值化後的圖片（數字部分為白色 255，背景為黑色 0）
     */
    preprocessImage(srcMat, threshold = 25) {
        const gray = new cv.Mat();
        cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);
        // THRESH_BINARY_INV：低於閾值的像素（黑色數字）變成 255（白色）
        cv.threshold(gray, gray, threshold, 255, cv.THRESH_BINARY_INV);
        return gray;
    },

    /**
     * 前處理模板圖片：提取數字圖案
     * 模板特性：RGBA 格式，黑色=數字主體，白色=描邊，透明=背景
     * 
     * 轉換規則：
     * - 黑色像素（數字主體）→ 255（白色）：與截圖二值化結果一致
     * - 白色像素（描邊）→ 0（黑色）：描邊在二值化截圖中也是黑色
     * - 透明像素（背景）→ 0（黑色）
     * 
     * 這樣整個模板形成一個獨特的「亮暗圖案」，
     * TM_CCOEFF_NORMED 會尋找與此圖案高度吻合的區域。
     * 
     * @param {cv.Mat} templateMat - 模板圖片 (RGBA)
     * @returns {{binary: cv.Mat}} 二值化的模板
     */
    preprocessTemplate(templateMat) {
        const rows = templateMat.rows;
        const cols = templateMat.cols;

        // 建立二值化模板
        const binary = new cv.Mat(rows, cols, cv.CV_8UC1, new cv.Scalar(0));

        const data = templateMat.data;
        const binaryData = binary.data;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const a = data[idx + 3];

                const pixIdx = y * cols + x;

                // 非透明 + 黑色像素 → 白色 (255)
                if (a > 128 && r < 50 && g < 50 && b < 50) {
                    binaryData[pixIdx] = 255;
                }
                // 其他（白色描邊、透明背景）保持 0
            }
        }

        return { binary };
    },

    /**
     * 對單一數字模板執行匹配，找出所有符合閾值的位置
     * @param {cv.Mat} binaryImg - 二值化後的截圖
     * @param {cv.Mat} binaryTemplate - 二值化後的模板
     * @param {number} digit - 數字值 (0~9)
     * @param {number} threshold - 匹配信心度閾值 (0~1)
     * @returns {Array} 匹配結果 [{digit, x, y, w, h, confidence}]
     */
    matchSingleDigit(binaryImg, binaryTemplate, digit, threshold = 0.85) {
        const result = new cv.Mat();
        const mask = new cv.Mat();
        const matches = [];

        try {
            // TM_CCOEFF_NORMED：比對明暗圖案，不使用 mask
            cv.matchTemplate(binaryImg, binaryTemplate, result, cv.TM_CCOEFF_NORMED, mask);

            // 找出所有高於閾值的位置
            const threshResult = new cv.Mat();
            cv.threshold(result, threshResult, threshold, 1.0, cv.THRESH_BINARY);

            // 轉為 8UC1 以便 findContours
            const threshU8 = new cv.Mat();
            threshResult.convertTo(threshU8, cv.CV_8UC1, 255);

            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(threshU8, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            for (let i = 0; i < contours.size(); i++) {
                const rect = cv.boundingRect(contours.get(i));
                // 取該區域內最大的信心度值
                const roi = result.roi(new cv.Rect(
                    Math.max(0, rect.x),
                    Math.max(0, rect.y),
                    Math.min(rect.width, result.cols - rect.x),
                    Math.min(rect.height, result.rows - rect.y)
                ));
                const minMax = cv.minMaxLoc(roi);
                roi.delete();

                matches.push({
                    digit,
                    x: rect.x + (minMax.maxLoc.x || 0),
                    y: rect.y + (minMax.maxLoc.y || 0),
                    w: binaryTemplate.cols,
                    h: binaryTemplate.rows,
                    confidence: minMax.maxVal
                });
            }

            threshResult.delete();
            threshU8.delete();
            contours.delete();
            hierarchy.delete();
        } finally {
            result.delete();
            mask.delete();
        }

        return matches;
    },

    /**
     * 對所有數字模板 (0~9) 執行匹配
     */
    matchAllDigits(binaryImg, templates, threshold = 0.85) {
        let allMatches = [];

        for (const tmpl of templates) {
            if (tmpl.binary.rows > binaryImg.rows || tmpl.binary.cols > binaryImg.cols) {
                console.warn(`模板 ${tmpl.digit} 尺寸大於圖片，跳過`);
                continue;
            }

            const matches = this.matchSingleDigit(
                binaryImg, tmpl.binary, tmpl.digit, threshold
            );
            allMatches = allMatches.concat(matches);
        }

        return allMatches;
    },

    /**
     * 主函式：辨識截圖中的所有數字
     */
    recognizeNumbers(source, templates, options = {}) {
        const {
            matchThreshold = 0.85,
            binaryThreshold = 25,
            nmsIouThreshold = 0.3,
            yTolerance = 4,
            maxGapX = 8,
            debug = false
        } = options;

        const startTime = performance.now();
        const debugImages = {};

        const src = cv.imread(source);
        const binaryImg = this.preprocessImage(src, binaryThreshold);

        if (debug) {
            debugImages.binary = binaryImg.clone();
        }

        const rawMatches = this.matchAllDigits(binaryImg, templates, matchThreshold);
        const nmsMatches = NMS.nonMaxSuppression(rawMatches, nmsIouThreshold);
        const numbers = NMS.assembleNumbers(nmsMatches, yTolerance, maxGapX);

        const processingTime = performance.now() - startTime;

        src.delete();
        binaryImg.delete();

        return {
            numbers,
            rawMatches,
            nmsMatches,
            processingTime,
            debugImages
        };
    }
};

window.OCREngine = OCREngine;
