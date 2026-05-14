"""
精確分析 RO 道具欄的格子結構：
找出格線位置、格子大小、圖示區域和數字區域的關係
"""
from PIL import Image

img_path = r"c:\Users\k1279\Desktop\RO讀取網頁\Screenshot 2026-05-14 101616.png"
img = Image.open(img_path)
w, h = img.size
pixels = img.load()
print(f"圖片尺寸: {w}x{h}")

# 找出所有「非常接近純灰色」的垂直線（格線通常是淺灰色邊框）
print("\n=== 尋找垂直格線 ===")
grid_x = []
for x in range(w):
    gray_count = 0
    for y in range(h):
        p = pixels[x, y]
        r, g, b = p[0], p[1], p[2]
        avg = (r + g + b) / 3
        # 尋找淺藍灰色邊界 (這張圖的邊框看起來是淺藍色/灰色)
        if 180 < avg < 240 and abs(r-g) < 20 and abs(g-b) < 20:
             gray_count += 1
    ratio = gray_count / h
    if ratio > 0.4:
        grid_x.append((x, ratio, gray_count))

print(f"找到 {len(grid_x)} 個候選垂直格線位置:")
if grid_x:
    groups = []
    current = [grid_x[0]]
    for i in range(1, len(grid_x)):
        if grid_x[i][0] - grid_x[i-1][0] <= 3:
            current.append(grid_x[i])
        else:
            groups.append(current)
            current = [grid_x[i]]
    groups.append(current)
    
    print(f"合併為 {len(groups)} 條垂直線:")
    grid_positions = []
    for g in groups:
        center = g[len(g)//2][0]
        grid_positions.append(center)
        print(f"  x={center} (寬度={len(g)}px)")
    
    if len(grid_positions) >= 2:
        gaps = [grid_positions[i+1] - grid_positions[i] for i in range(len(grid_positions)-1)]
        print(f"\n格子間距: {gaps}")
        print(f"平均格子寬度: {sum(gaps)/len(gaps):.1f}px")

print("\n=== 尋找水平格線 ===")
grid_y = []
for y in range(h):
    gray_count = 0
    for x in range(w):
        p = pixels[x, y]
        r, g, b = p[0], p[1], p[2]
        avg = (r + g + b) / 3
        if 180 < avg < 240 and abs(r-g) < 20 and abs(g-b) < 20:
             gray_count += 1
    ratio = gray_count / w
    if ratio > 0.3:
        grid_y.append((y, ratio, gray_count))

if grid_y:
    groups_y = []
    current = [grid_y[0]]
    for i in range(1, len(grid_y)):
        if grid_y[i][0] - grid_y[i-1][0] <= 3:
            current.append(grid_y[i])
        else:
            groups_y.append(current)
            current = [grid_y[i]]
    groups_y.append(current)
    
    for g in groups_y:
        center = g[len(g)//2][0]
        print(f"  y={center} (寬度={len(g)}px)")

print("\n=== 尋找黑色像素密集區（數字位置） ===")
black_regions = []
for y in range(h - 8):
    for x in range(w - 5):
        black_count = 0
        for dy in range(8):
            for dx in range(5):
                p = pixels[x+dx, y+dy]
                if p[0] < 50 and p[1] < 50 and p[2] < 50:
                    black_count += 1
        if black_count > 6:
            black_regions.append((x, y, black_count))

if black_regions:
    merged = []
    last_x = -100
    for x, y, c in black_regions:
        if x - last_x > 5:
            merged.append((x, y, c))
        last_x = x
    
    print(f"黑色像素密集區域 (前10個):")
    for x, y, c in merged[:10]:
        print(f"  位置: ({x}, {y})")

img.close()
