/**
 * 道具庫管理與圖示匹配引擎
 */
const ItemLibrary = {
    items: [], // { id, name, price, iconBase64, width, height, _mat }

    init() {
        this.load();
    },

    /**
     * 新增道具
     */
    addItem(name, price, iconCanvas) {
        const id = 'item_' + Date.now();
        const iconBase64 = iconCanvas.toDataURL('image/png');
        
        this.items.push({
            id,
            name,
            price: parseInt(price, 10) || 0,
            iconBase64,
            width: iconCanvas.width,
            height: iconCanvas.height
        });

        this.save();
        return id;
    },

    /**
     * 刪除道具
     */
    removeItem(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.save();
    },

    /**
     * 儲存到 LocalStorage
     */
    save() {
        // 儲存前剔除 _mat (OpenCV 物件無法序列化)
        const dataToSave = this.items.map(item => {
            const { _mat, ...rest } = item;
            return rest;
        });
        localStorage.setItem('ro_item_library', JSON.stringify(dataToSave));
    },

    /**
     * 從 LocalStorage 載入
     */
    load() {
        const data = localStorage.getItem('ro_item_library');
        if (data) {
            try {
                this.items = JSON.parse(data);
            } catch (e) {
                console.error('載入道具庫失敗', e);
                this.items = [];
            }
        }
    },

    /**
     * 取得道具的 OpenCV Mat (快取機制)
     */
    async getIconMat(item) {
        if (item._mat && !item._mat.isDeleted()) {
            return item._mat;
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = item.width;
                canvas.height = item.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const src = cv.imread(canvas);
                const gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
                src.delete();

                item._mat = gray;
                resolve(gray);
            };
            img.src = item.iconBase64;
        });
    },

    /**
     * 在指定區域內匹配最相似的道具
     * @param {cv.Mat} grayImg 完整的灰階截圖
     * @param {cv.Rect} region 要搜尋的區域 (通常是數字左上方的 25x25 範圍)
     * @returns {Promise<Object|null>} 匹配到的道具與信心度
     */
    async recognizeItem(grayImg, region) {
        if (this.items.length === 0) return null;

        // 確保區域在圖片範圍內
        const x = Math.max(0, region.x);
        const y = Math.max(0, region.y);
        const w = Math.min(region.width, grayImg.cols - x);
        const h = Math.min(region.height, grayImg.rows - y);
        
        if (w <= 0 || h <= 0) return null;

        const roi = grayImg.roi(new cv.Rect(x, y, w, h));
        let bestMatch = null;
        let maxConfidence = -1;

        for (const item of this.items) {
            const tmplMat = await this.getIconMat(item);
            
            // 如果模板比 ROI 還大，無法匹配
            if (tmplMat.cols > roi.cols || tmplMat.rows > roi.rows) continue;

            const result = new cv.Mat();
            const mask = new cv.Mat();
            
            try {
                // TM_CCOEFF_NORMED 對於灰階圖示匹配效果最好，能抵抗亮度變化
                cv.matchTemplate(roi, tmplMat, result, cv.TM_CCOEFF_NORMED, mask);
                const minMax = cv.minMaxLoc(result);
                
                if (minMax.maxVal > maxConfidence) {
                    maxConfidence = minMax.maxVal;
                    bestMatch = item;
                }
            } finally {
                result.delete();
                mask.delete();
            }
        }

        roi.delete();

        // 設定一個基本信心度閾值，避免亂配對 (例如 0.5)
        if (maxConfidence > 0.5) {
            return {
                item: bestMatch,
                confidence: maxConfidence
            };
        }

        return null;
    },

    /**
     * 匯出 JSON
     */
    exportJSON() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.items, null, 2));
        const anchor = document.createElement('a');
        anchor.href = dataStr;
        anchor.download = "ro_items_config.json";
        anchor.click();
    },

    /**
     * 匯入 JSON
     */
    importJSON(fileStr) {
        try {
            const data = JSON.parse(fileStr);
            if (Array.isArray(data)) {
                this.items = data;
                this.save();
                return true;
            }
        } catch (e) {
            console.error("匯入失敗", e);
        }
        return false;
    }
};

window.ItemLibrary = ItemLibrary;
