/**
 * 非極大值抑制 (Non-Maximum Suppression) 與數字組合模組
 * 負責去除重疊的匹配框，並將辨識到的個別數字組合成完整數值
 */

/**
 * 計算兩個矩形的 IoU（交集 / 聯集）
 * @param {Object} a - 矩形 {x, y, w, h}
 * @param {Object} b - 矩形 {x, y, w, h}
 * @returns {number} IoU 值 (0~1)
 */
function computeIoU(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);

    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const interArea = interW * interH;

    const aArea = a.w * a.h;
    const bArea = b.w * b.h;
    const unionArea = aArea + bArea - interArea;

    return unionArea === 0 ? 0 : interArea / unionArea;
}

/**
 * 非極大值抑制：移除重疊的匹配框
 * @param {Array} matches - 匹配結果陣列 [{digit, x, y, w, h, confidence}]
 * @param {number} iouThreshold - IoU 閾值，超過此值視為重疊（預設 0.3）
 * @returns {Array} 去重後的匹配結果
 */
function nonMaxSuppression(matches, iouThreshold = 0.3) {
    if (matches.length === 0) return [];

    // 依信心度降序排列
    const sorted = [...matches].sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    const suppressed = new Set();

    for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue;

        kept.push(sorted[i]);

        // 檢查後面的框是否與當前框重疊
        for (let j = i + 1; j < sorted.length; j++) {
            if (suppressed.has(j)) continue;
            const iou = computeIoU(sorted[i], sorted[j]);
            if (iou > iouThreshold) {
                suppressed.add(j);
            }
        }
    }

    return kept;
}

/**
 * 將匹配到的個別數字組合成完整數值
 * 邏輯：依 Y 座標粗略分行 → 同行內依 X 座標排序 → 相鄰數字組合
 * @param {Array} matches - NMS 後的匹配結果 [{digit, x, y, w, h, confidence}]
 * @param {number} yTolerance - Y 座標容差（同行判定，預設 4px）
 * @param {number} maxGapX - 同一數字組內的最大 X 間距（預設 8px）
 * @returns {Array} 組合結果 [{value, x, y, digits: [{digit, x, y}], confidence}]
 */
function assembleNumbers(matches, yTolerance = 4, maxGapX = 8) {
    if (matches.length === 0) return [];

    // 先依 Y 座標排序，再依 X 座標排序
    const sorted = [...matches].sort((a, b) => {
        if (Math.abs(a.y - b.y) <= yTolerance) {
            return a.x - b.x;
        }
        return a.y - b.y;
    });

    // 分行：Y 座標差距在 yTolerance 內的視為同一行
    const rows = [];
    let currentRow = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        // 與當前行最後一個元素比較 Y 值
        const lastInRow = currentRow[currentRow.length - 1];
        if (Math.abs(sorted[i].y - lastInRow.y) <= yTolerance) {
            currentRow.push(sorted[i]);
        } else {
            rows.push(currentRow);
            currentRow = [sorted[i]];
        }
    }
    rows.push(currentRow);

    // 在每行中，依 X 座標分群成數字組
    const results = [];

    for (const row of rows) {
        // 行內依 X 座標排序
        row.sort((a, b) => a.x - b.x);

        let group = [row[0]];

        for (let i = 1; i < row.length; i++) {
            const prev = row[i - 1];
            const curr = row[i];
            // 前一個數字的右邊界到當前數字的左邊界的距離
            const gap = curr.x - (prev.x + prev.w);

            if (gap <= maxGapX) {
                group.push(curr);
            } else {
                // 儲存當前群組並開始新群組
                results.push(buildNumberFromGroup(group));
                group = [curr];
            }
        }
        // 儲存最後一個群組
        results.push(buildNumberFromGroup(group));
    }

    return results;
}

/**
 * 從數字群組建構最終數值
 * @param {Array} group - 同一組的數字匹配結果
 * @returns {Object} {value, x, y, w, h, digits, confidence}
 */
function buildNumberFromGroup(group) {
    const valueStr = group.map(g => g.digit).join('');
    const value = parseInt(valueStr, 10);
    const minX = Math.min(...group.map(g => g.x));
    const minY = Math.min(...group.map(g => g.y));
    const maxX = Math.max(...group.map(g => g.x + g.w));
    const maxY = Math.max(...group.map(g => g.y + g.h));
    const avgConf = group.reduce((sum, g) => sum + g.confidence, 0) / group.length;

    return {
        value,
        valueStr,
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        digits: group.map(g => ({ digit: g.digit, x: g.x, y: g.y })),
        confidence: avgConf
    };
}

// 匯出
window.NMS = {
    nonMaxSuppression,
    assembleNumbers
};
