/**
 * Canvas 拖曳裁剪功能
 */
const Cropper = {
    canvas: null,
    ctx: null,
    isCropping: false,
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    
    onCropComplete: null, // callback(canvas)

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.bindEvents();
    },

    bindEvents() {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        // 使用 window 綁定 mouseup 避免滑出 canvas 時失效
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    },

    start(callback) {
        this.isCropping = true;
        this.onCropComplete = callback;
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.zIndex = '100';
        
        // 開始裁剪時，先清除畫布上的結果框，然後加上半透明遮罩
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawOverlay();
    },

    cancel() {
        this.isCropping = false;
        this.isDragging = false;
        this.canvas.style.cursor = 'default';
        this.canvas.style.pointerEvents = '';
        this.canvas.style.zIndex = '';
        
        // 觸發重新繪製以清除遮罩並恢復結果框
        if (window.App) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (App.lastResult) {
                App.drawResults(App.lastResult);
            }
        }
    },

    handleMouseDown(e) {
        if (!this.isCropping) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        this.startX = (e.clientX - rect.left) * scaleX;
        this.startY = (e.clientY - rect.top) * scaleY;
        this.isDragging = true;
    },

    handleMouseMove(e) {
        if (!this.isDragging) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        this.currentX = (e.clientX - rect.left) * scaleX;
        this.currentY = (e.clientY - rect.top) * scaleY;

        this.drawOverlay();
    },

    handleMouseUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        
        const x = Math.min(this.startX, this.currentX);
        const y = Math.min(this.startY, this.currentY);
        const w = Math.abs(this.currentX - this.startX);
        const h = Math.abs(this.currentY - this.startY);

        // 如果拖曳範圍太小，視為無效點擊
        if (w < 5 || h < 5) {
            this.drawOverlay(); // 恢復純遮罩
            return;
        }

        this.cropAndFinish(x, y, w, h);
    },

    drawOverlay() {
        if (!window.App || !App.currentImage) return;
        
        // 清空 result-canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 畫半透明遮罩
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 如果正在拖曳，挖空選取區並畫邊框
        if (this.isDragging) {
            const x = Math.min(this.startX, this.currentX);
            const y = Math.min(this.startY, this.currentY);
            const w = Math.abs(this.currentX - this.startX);
            const h = Math.abs(this.currentY - this.startY);

            // 挖空 (destination-out)
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
            this.ctx.fillRect(x, y, w, h);
            
            // 恢復原本模式
            this.ctx.globalCompositeOperation = 'source-over';
            
            // 畫邊框
            this.ctx.strokeStyle = '#f0c040';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, w, h);
        }
    },

    cropAndFinish(x, y, w, h) {
        this.isCropping = false;
        this.canvas.style.cursor = 'default';
        this.canvas.style.pointerEvents = '';
        this.canvas.style.zIndex = '';

        // 創建一個新的小 canvas 來存儲裁剪結果
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w;
        cropCanvas.height = h;
        const cropCtx = cropCanvas.getContext('2d');
        
        // 從 App.currentImage 擷取影像 (避免畫到我們剛剛加的遮罩)
        cropCtx.drawImage(App.currentImage, x, y, w, h, 0, 0, w, h);

        // 清除主 canvas 的遮罩，恢復辨識結果
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (window.App && App.lastResult) {
            App.drawResults(App.lastResult);
        }

        if (this.onCropComplete) {
            this.onCropComplete(cropCanvas);
        }
    }
};

window.Cropper = Cropper;
