// ======= STATE =======
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const area = document.getElementById('canvas-area');

let scale = 5; // cm per pixel
let gridSize = 20;
let zoom = 1;
let panX = 0, panY = 0;
let snapEnabled = true;
let currentTool = 'wall';
let drawingWall = false;
let wallStart = null;
let pendingTextPos = null;
let spaceDown = false;
let panStart = null;
let panOrigin = null;

let elements = []; // all drawn elements
let selectedId = null;
let history = [];
let draggingId = null, dragOffset = null;
let resizingId = null, resizeHandle = null;

// ======= RESIZE CANVAS =======
function resizeCanvas() {
    const r = area.getBoundingClientRect();
    canvas.width = r.width;
    canvas.height = r.height;
    draw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ======= TOOLS =======
const toolNames = { wall: 'Mur', select: 'Sélection', door: 'Porte', window: 'Fenêtre', text: 'Texte', measure: 'Cote' };
function setTool(t) {
    currentTool = t;
    drawingWall = false; wallStart = null;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const el = document.getElementById('tool-' + t);
    if (el) el.classList.add('active');
    document.getElementById('active-tool-name').textContent = toolNames[t] || t;
    showProps(null);
    draw();
}

// ======= SNAP =======
function snap(v) {
    if (!snapEnabled) return v;
    return Math.round(v / gridSize) * gridSize;
}
function toCanvas(wx, wy) {
    return { x: wx * zoom + panX, y: wy * zoom + panY };
}
function toWorld(cx, cy) {
    return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
}
function snapWorld(cx, cy) {
    const w = toWorld(cx, cy);
    return { x: snap(w.x), y: snap(w.y) };
}

// ======= DRAW =======
function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = '#f5f2eb';
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.save();
    ctx.strokeStyle = '#ddd8ce';
    ctx.lineWidth = 1;
    const gs = gridSize * zoom;
    const startX = ((panX % gs) + gs) % gs;
    const startY = ((panY % gs) + gs) % gs;
    for (let x = startX; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = startY; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // major grid (5x)
    ctx.strokeStyle = '#ccc5b6';
    const gs5 = gs * 5;
    const sx5 = ((panX % gs5) + gs5) % gs5;
    const sy5 = ((panY % gs5) + gs5) % gs5;
    for (let x = sx5; x < W; x += gs5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = sy5; y < H; y += gs5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();

    // origin cross
    ctx.save();
    ctx.strokeStyle = '#bbb5a6';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(panX - 10, panY); ctx.lineTo(panX + 10, panY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(panX, panY - 10); ctx.lineTo(panX, panY + 10); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // draw all elements
    for (const el of elements) {
        const sel = el.id === selectedId;
        drawElement(el, sel);
    }

    ctx.restore();

    // drawing preview
    if (drawingWall && wallStart && lastMouse) {
        const sp = toCanvas(wallStart.x, wallStart.y);
        const ep = toCanvas(lastMouse.x, lastMouse.y);
        ctx.save();
        ctx.strokeStyle = currentTool === 'door' ? '#5b8dd9' : currentTool === 'window' ? '#87c1ea' : '#2c2c34';
        ctx.lineWidth = currentTool === 'wall' ? 8 * zoom : 6 * zoom;
        ctx.lineCap = 'round';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
        ctx.setLineDash([]);

        // live measure
        const dx = (lastMouse.x - wallStart.x) * scale;
        const dy = (lastMouse.y - wallStart.y) * scale;
        const len = Math.sqrt(dx * dx + dy * dy);
        ctx.fillStyle = '#5b8dd9';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.fillText(len.toFixed(0) + ' cm', (sp.x + ep.x) / 2 + 6, (sp.y + ep.y) / 2 - 6);
        ctx.restore();
    }

    document.getElementById('zoom-display').textContent = 'Zoom : ' + Math.round(zoom * 100) + '%';
    document.getElementById('elem-count').textContent = elements.length;
}

function drawElement(el, selected) {
    ctx.save();

    if (el.type === 'wall') {
        ctx.strokeStyle = selected ? '#5b8dd9' : '#2c2c34';
        ctx.lineWidth = el.thickness || 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(el.x1, el.y1);
        ctx.lineTo(el.x2, el.y2);
        ctx.stroke();
        // measure label
        const len = Math.round(Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2) * scale);
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
        const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(44,44,52,0.85)';
        ctx.font = 'bold 9px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(len + ' cm', 0, -7);
        ctx.restore();
    }

    else if (el.type === 'door') {
        const cx = el.x1, cy = el.y1;
        const ex = el.x2, ey = el.y2;
        const len = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
        const ang = Math.atan2(ey - cy, ex - cx);
        ctx.strokeStyle = selected ? '#87c1ea' : '#5b8dd9';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
        // arc
        ctx.strokeStyle = selected ? '#87c1ea' : '#5b8dd9aa';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, len, ang, ang + Math.PI / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // label
        ctx.fillStyle = '#5b8dd9';
        ctx.font = '8px Segoe UI, sans-serif';
        const ml = Math.round(len * scale);
        ctx.fillText(ml + ' cm', (cx + ex) / 2 + 4, (cy + ey) / 2 - 4);
    }

    else if (el.type === 'window') {
        const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        const len = Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2);
        ctx.save();
        ctx.translate(el.x1, el.y1);
        ctx.rotate(ang);
        ctx.strokeStyle = selected ? '#5b8dd9' : '#2c2c34';
        ctx.lineWidth = 8;
        ctx.lineCap = 'square';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.strokeStyle = '#87c1ea';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(len * 0.1, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke();
        ctx.restore();
        // label
        ctx.fillStyle = '#87c1ea';
        ctx.font = '8px Segoe UI, sans-serif';
        const ml = Math.round(len * scale);
        ctx.fillText(ml + ' cm', (el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2 - 8);
    }

    else if (el.type === 'furniture') {
        const x = el.x, y = el.y, w = el.w, h = el.h;
        ctx.fillStyle = selected ? 'rgba(91,141,217,.25)' : 'rgba(180,165,140,.3)';
        ctx.strokeStyle = selected ? '#5b8dd9' : '#8a7e6c';
        ctx.lineWidth = selected ? 2 : 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill(); ctx.stroke();
        drawFurnitureDetail(el);
        // label
        ctx.fillStyle = '#5a4f3c';
        ctx.font = `bold ${Math.max(8, Math.min(w / 7, 10))}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.label, x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        // dimensions
        ctx.fillStyle = '#9a8e7a';
        ctx.font = '7px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(w * scale)}×${Math.round(h * scale)} cm`, x + w / 2, y + h + 9);
        ctx.textAlign = 'left';
        // resize handle
        if (selected) {
            ctx.fillStyle = '#5b8dd9';
            ctx.fillRect(x + w - 5, y + h - 5, 8, 8);
        }
    }

    else if (el.type === 'text') {
        ctx.font = `bold ${el.fontSize || 14}px Segoe UI, sans-serif`;
        ctx.fillStyle = selected ? '#5b8dd9' : '#4a3f30';
        ctx.fillText(el.label, el.x, el.y);
        if (selected) {
            const m = ctx.measureText(el.label);
            ctx.strokeStyle = '#5b8dd988';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(el.x - 2, el.y - (el.fontSize || 14) - 2, m.width + 4, (el.fontSize || 14) + 6);
            ctx.setLineDash([]);
        }
    }

    else if (el.type === 'measure') {
        const len = Math.round(Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2) * scale);
        ctx.strokeStyle = selected ? '#e8a44a' : '#e8a44a88';
        ctx.lineWidth = 1;
        const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        const perp = ang + Math.PI / 2;
        const off = 18;
        const x1b = el.x1 + Math.cos(perp) * off, y1b = el.y1 + Math.sin(perp) * off;
        const x2b = el.x2 + Math.cos(perp) * off, y2b = el.y2 + Math.sin(perp) * off;
        // witness lines
        ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(x1b, y1b); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(el.x2, el.y2); ctx.lineTo(x2b, y2b); ctx.stroke();
        // dim line
        ctx.beginPath(); ctx.moveTo(x1b, y1b); ctx.lineTo(x2b, y2b); ctx.stroke();
        // arrows
        const aw = 5;
        ctx.fillStyle = '#e8a44a';
        for (const [bx, by, dir] of [[x1b, y1b, 1], [x2b, y2b, -1]]) {
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.moveTo(dir * aw, 0); ctx.lineTo(0, -3); ctx.lineTo(0, 3); ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        ctx.translate((x1b + x2b) / 2, (y1b + y2b) / 2);
        ctx.rotate(ang);
        ctx.fillStyle = '#c07e20';
        ctx.font = 'bold 9px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(len + ' cm', 0, -5);
        ctx.restore();
    }

    ctx.restore();
}

function drawFurnitureDetail(el) {
    const { x, y, w, h, kind } = el;
    ctx.save();
    ctx.strokeStyle = '#8a7e6caa';
    ctx.lineWidth = 1;
    if (kind === 'canapé') {
        ctx.fillStyle = '#b5a899aa';
        ctx.beginPath(); ctx.roundRect(x + 3, y + h * 0.55, w - 6, h * 0.4, 3); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(x + 3, y + 3, 14, h - 6, 3); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(x + w - 17, y + 3, 14, h - 6, 3); ctx.fill(); ctx.stroke();
    } else if (kind === 'lit_double' || kind === 'lit_simple') {
        ctx.fillStyle = '#e0d8ccaa';
        ctx.fillRect(x + 4, y + h * 0.2, w - 8, h * 0.75);
        ctx.strokeRect(x + 4, y + 4, w - 8, h * 0.18);
        if (kind === 'lit_double') {
            ctx.beginPath(); ctx.moveTo(x + w / 2, y + h * 0.2); ctx.lineTo(x + w / 2, y + h * 0.95); ctx.stroke();
        }
    } else if (kind === 'wc') {
        ctx.fillStyle = '#e8e4dcaa';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.6, w * 0.4, h * 0.35, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillRect(x + w * 0.2, y + 3, w * 0.6, h * 0.25);
        ctx.strokeRect(x + w * 0.2, y + 3, w * 0.6, h * 0.25);
    } else if (kind === 'baignoire') {
        ctx.fillStyle = '#d5ecf8aa';
        ctx.beginPath(); ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.7, w * 0.25, h * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === 'escalier') {
        const steps = 6;
        for (let i = 0; i < steps; i++) {
            const yy = y + (h / steps) * i;
            ctx.fillStyle = i % 2 === 0 ? '#ccc5b6aa' : '#b5ae9faa';
            ctx.fillRect(x + 2, yy + 2, w - 4, h / steps - 2);
        }
    } else if (kind === 'colonne') {
        ctx.fillStyle = '#b5a899cc';
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    }
    ctx.restore();
}

// ======= MOUSE EVENTS =======
let lastMouse = null;

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const sw = snapWorld(cx, cy);
    lastMouse = sw;
    document.getElementById('mouse-x').textContent = Math.round(sw.x * scale) + ' cm';
    document.getElementById('mouse-y').textContent = Math.round(sw.y * scale) + ' cm';

    if (spaceDown && panStart) {
        panX = panOrigin.x + (cx - panStart.x);
        panY = panOrigin.y + (cy - panStart.y);
        draw(); return;
    }

    if (draggingId !== null) {
        const el = elements.find(e => e.id === draggingId);
        if (el) {
            if (el.type === 'wall' || el.type === 'door' || el.type === 'window' || el.type === 'measure') {
                const dx = sw.x - dragOffset.x, dy = sw.y - dragOffset.y;
                el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
                dragOffset = sw;
            } else {
                el.x = snap(sw.x - dragOffset.ox);
                el.y = snap(sw.y - dragOffset.oy);
            }
            draw(); return;
        }
    }

    if (resizingId !== null) {
        const el = elements.find(e => e.id === resizingId);
        if (el) {
            el.w = Math.max(20, sw.x - el.x);
            el.h = Math.max(20, sw.y - el.y);
            draw(); return;
        }
    }

    if (drawingWall) { draw(); }
    else { canvas.style.cursor = spaceDown ? 'grab' : cursorForTool(); }
});

function cursorForTool() {
    if (currentTool === 'select') return 'default';
    return 'crosshair';
}

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const sw = snapWorld(cx, cy);

    if (spaceDown) {
        panStart = { x: cx, y: cy };
        panOrigin = { x: panX, y: panY };
        return;
    }

    if (currentTool === 'select') {
        // check resize handle
        for (const el of [...elements].reverse()) {
            if (el.type === 'furniture' && el.id === selectedId) {
                const rh = { x: el.x + el.w - 5, y: el.y + el.h - 5, w: 8, h: 8 };
                const wPos = toWorld(cx, cy);
                if (wPos.x >= rh.x && wPos.x <= rh.x + rh.w && wPos.y >= rh.y && wPos.y <= rh.y + rh.h) {
                    resizingId = el.id;
                    return;
                }
            }
        }
        // check hit
        const hit = hitTest(toWorld(cx, cy));
        if (hit) {
            selectedId = hit.id;
            const wPos = toWorld(cx, cy);
            if (hit.type === 'furniture' || hit.type === 'text') {
                draggingId = hit.id;
                dragOffset = { ox: wPos.x - hit.x, oy: wPos.y - hit.y };
            } else {
                draggingId = hit.id;
                dragOffset = { x: wPos.x, y: wPos.y };
            }
            showProps(hit);
        } else {
            selectedId = null;
            showProps(null);
        }
        draw(); return;
    }

    if (currentTool === 'text') {
        pendingTextPos = sw;
        document.getElementById('text-input').value = '';
        openModal('text-modal');
        return;
    }

    if (!drawingWall) {
        drawingWall = true;
        wallStart = sw;
    } else {
        saveHistory();
        const id = Date.now() + Math.random();
        const el = { id, type: currentTool, x1: wallStart.x, y1: wallStart.y, x2: sw.x, y2: sw.y };
        if (currentTool === 'wall') el.thickness = 8;
        elements.push(el);
        wallStart = sw; // chain walls
        draw();
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (panStart) { panStart = null; panOrigin = null; }
    if (draggingId !== null) { draggingId = null; }
    if (resizingId !== null) { resizingId = null; }
});

canvas.addEventListener('dblclick', (e) => {
    if (currentTool === 'wall' || currentTool === 'door' || currentTool === 'window' || currentTool === 'measure') {
        drawingWall = false;
        wallStart = null;
        draw();
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const before = toWorld(cx, cy);
    zoom *= factor;
    zoom = Math.min(Math.max(zoom, 0.1), 8);
    const after = toWorld(cx, cy);
    panX += (after.x - before.x) * zoom;
    panY += (after.y - before.y) * zoom;
    draw();
}, { passive: false });

// HIT TEST
function hitTest(wp) {
    for (const el of [...elements].reverse()) {
        if (el.type === 'wall' || el.type === 'door' || el.type === 'window' || el.type === 'measure') {
            const d = distToSegment(wp, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 });
            if (d < 10 / zoom) return el;
        } else if (el.type === 'furniture') {
            if (wp.x >= el.x && wp.x <= el.x + el.w && wp.y >= el.y && wp.y <= el.y + el.h) return el;
        } else if (el.type === 'text') {
            if (wp.x >= el.x - 5 && wp.x <= el.x + 200 && wp.y >= el.y - 20 && wp.y <= el.y + 5) return el;
        }
    }
    return null;
}
function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ======= KEYBOARD =======
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); }
    if (e.key === 'Escape') { drawingWall = false; wallStart = null; draw(); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId !== null) {
            saveHistory();
            elements = elements.filter(e => e.id !== selectedId);
            selectedId = null; showProps(null); draw();
        }
    }
    if (e.ctrlKey && e.key === 'z') { undo(); }
    if (e.key === 'w' || e.key === 'W') setTool('wall');
    if (e.key === 's' || e.key === 'S') setTool('select');
    if (e.key === 'd' || e.key === 'D') setTool('door');
    if (e.key === 'f' || e.key === 'F') setTool('window');
    if (e.key === 'g' || e.key === 'G') {
        snapEnabled = !snapEnabled;
        document.getElementById('snap-status').innerHTML = 'Magnétique : <span>' + (snapEnabled ? 'ON' : 'OFF') + '</span>';
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = cursorForTool(); }
});

// ======= FURNITURE =======
const furnitureDefs = {
    canapé: { label: 'Canapé', w: 100, h: 40 },
    lit_double: { label: 'Lit 2p', w: 70, h: 100 },
    lit_simple: { label: 'Lit 1p', w: 50, h: 90 },
    bureau: { label: 'Bureau', w: 80, h: 45 },
    table: { label: 'Table', w: 60, h: 60 },
    baignoire: { label: 'Baignoire', w: 40, h: 80 },
    douche: { label: 'Douche', w: 40, h: 40 },
    wc: { label: 'WC', w: 30, h: 45 },
    evier: { label: 'Évier', w: 50, h: 30 },
    cuisine: { label: 'Cuisine', w: 120, h: 35 },
    escalier: { label: 'Escalier', w: 50, h: 80 },
    colonne: { label: 'Poteau', w: 20, h: 20 },
};

function addFurniture(kind) {
    saveHistory();
    const def = furnitureDefs[kind];
    const cx = (canvas.width / 2 - panX) / zoom;
    const cy = (canvas.height / 2 - panY) / zoom;
    elements.push({
        id: Date.now() + Math.random(),
        type: 'furniture',
        kind,
        label: def.label,
        x: snap(cx - def.w / 2),
        y: snap(cy - def.h / 2),
        w: def.w,
        h: def.h
    });
    draw();
}

// ======= TEXT =======
window.confirmText = function () {
    const label = document.getElementById('text-input').value.trim();
    const fontSize = parseInt(document.getElementById('font-size-input').value) || 14;
    if (label && pendingTextPos) {
        saveHistory();
        elements.push({ id: Date.now() + Math.random(), type: 'text', label, x: pendingTextPos.x, y: pendingTextPos.y, fontSize });
    }
    closeModal('text-modal');
    draw();
};

// ======= HISTORY =======
function saveHistory() {
    history.push(JSON.stringify(elements));
    if (history.length > 40) history.shift();
}
function undo() {
    if (history.length === 0) return;
    elements = JSON.parse(history.pop());
    selectedId = null; showProps(null); draw();
}

// ======= PROPS PANEL =======
function showProps(el) {
    const panel = document.getElementById('props-content');
    if (!el) {
        panel.innerHTML = `<div class="props-empty">Sélectionnez un élément pour modifier ses propriétés.<br><br><small>Outil actif : <strong id="active-tool-name">${toolNames[currentTool] || currentTool}</strong></small></div>`;
        return;
    }
    let html = '';
    if (el.type === 'wall') {
        const len = Math.round(Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2) * scale);
        html = `
      <div class="prop-row"><div class="prop-label">Longueur</div><div style="font-size:13px;font-weight:700;color:var(--accent)">${len} cm</div></div>
      <div class="prop-row"><div class="prop-label">Épaisseur (px)</div>
        <input class="prop-input" type="number" value="${el.thickness || 8}" min="2" max="40"
          onchange="updateElProp('${el.id}','thickness',+this.value)">
      </div>`;
    } else if (el.type === 'furniture') {
        html = `
      <div class="prop-row"><div class="prop-label">Nom</div>
        <input class="prop-input" type="text" value="${el.label}"
          onchange="updateElProp('${el.id}','label',this.value)">
      </div>
      <div class="prop-row"><div class="prop-label">Largeur (px → ${Math.round(el.w * scale)} cm)</div>
        <input class="prop-input" type="number" value="${el.w}" min="10"
          onchange="updateElProp('${el.id}','w',+this.value)">
      </div>
      <div class="prop-row"><div class="prop-label">Hauteur (px → ${Math.round(el.h * scale)} cm)</div>
        <input class="prop-input" type="number" value="${el.h}" min="10"
          onchange="updateElProp('${el.id}','h',+this.value)">
      </div>`;
    } else if (el.type === 'text') {
        html = `
      <div class="prop-row"><div class="prop-label">Texte</div>
        <input class="prop-input" type="text" value="${el.label}"
          onchange="updateElProp('${el.id}','label',this.value)">
      </div>
      <div class="prop-row"><div class="prop-label">Taille police</div>
        <input class="prop-input" type="number" value="${el.fontSize || 14}" min="6" max="72"
          onchange="updateElProp('${el.id}','fontSize',+this.value)">
      </div>`;
    } else if (el.type === 'door' || el.type === 'window') {
        const len = Math.round(Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2) * scale);
        html = `<div class="prop-row"><div class="prop-label">Largeur</div><div style="font-size:13px;font-weight:700;color:var(--door-color)">${len} cm</div></div>`;
    }
    html += `<div class="prop-actions">
    <button class="btn btn-danger" onclick="deleteSelected()">Supprimer</button>
  </div>`;
    panel.innerHTML = html;
}

window.updateElProp = function (id, prop, val) {
    const el = elements.find(e => e.id == id);
    if (el) { el[prop] = val; draw(); showProps(el); }
};
window.deleteSelected = function () {
    if (selectedId !== null) {
        saveHistory();
        elements = elements.filter(e => e.id !== selectedId);
        selectedId = null; showProps(null); draw();
    }
};

// ======= SCALE MODAL =======
window.openScaleModal = function () { openModal('scale-modal'); };
window.applyScale = function () {
    scale = parseFloat(document.getElementById('scale-input').value) || 5;
    gridSize = parseInt(document.getElementById('grid-input').value) || 20;
    document.getElementById('scale-display').textContent = `Échelle : 1 px = ${scale} cm`;
    closeModal('scale-modal');
    draw();
};

// ======= MODALS =======
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.closeModal = closeModal;

// ======= ZOOM =======
window.zoomFit = function () {
    if (elements.length === 0) { zoom = 1; panX = 80; panY = 80; draw(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
        if (el.x1 !== undefined) {
            minX = Math.min(minX, el.x1, el.x2); minY = Math.min(minY, el.y1, el.y2);
            maxX = Math.max(maxX, el.x1, el.x2); maxY = Math.max(maxY, el.y1, el.y2);
        } else if (el.x !== undefined) {
            minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + (el.w || 0)); maxY = Math.max(maxY, el.y + (el.h || 0));
        }
    }
    const pw = canvas.width - 60, ph = canvas.height - 60;
    const fw = maxX - minX, fh = maxY - minY;
    zoom = Math.min(pw / fw, ph / fh, 4);
    panX = 30 - minX * zoom;
    panY = 30 - minY * zoom;
    draw();
};
window.setZoom = function (z) { zoom = z; draw(); };

// ======= EXPORT =======
window.exportPNG = function () {
    const link = document.createElement('a');
    link.download = 'plan.png';
    link.href = canvas.toDataURL();
    link.click();
};

// ======= CLEAR =======
window.clearAll = function () {
    if (!confirm('Tout effacer ?')) return;
    saveHistory();
    elements = []; selectedId = null;
    showProps(null); draw();
};

// ======= INIT =======
panX = 40; panY = 40;

// Demo: draw a small apartment outline
function drawDemo() {
    const w = 200, h = 160, ox = 20, oy = 20;
    const walls = [
        { x1: ox, y1: oy, x2: ox + w, y2: oy },
        { x1: ox + w, y1: oy, x2: ox + w, y2: oy + h },
        { x1: ox + w, y1: oy + h, x2: ox, y2: oy + h },
        { x1: ox, y1: oy + h, x2: ox, y2: oy },
        // internal wall
        { x1: ox + 110, y1: oy, x2: ox + 110, y2: oy + h },
    ];
    walls.forEach(w => elements.push({ id: Date.now() + Math.random(), type: 'wall', ...w, thickness: 8 }));
    // door
    elements.push({ id: Date.now() + Math.random(), type: 'door', x1: ox + 140, y1: oy, x2: ox + 140 + 35, y2: oy });
    // window
    elements.push({ id: Date.now() + Math.random(), type: 'window', x1: ox + 30, y1: oy, x2: ox + 80, y2: oy });
    // furniture
    const furn = [
        { kind: 'canapé', x: ox + 130, y: oy + 20, w: 100, h: 40, label: 'Canapé' },
        { kind: 'table', x: ox + 135, y: oy + 90, w: 50, h: 50, label: 'Table' },
        { kind: 'lit_double', x: ox + 20, y: oy + 30, w: 70, h: 100, label: 'Lit 2p' },
        { kind: 'wc', x: ox + 15, y: oy + h - 50, w: 30, h: 45, label: 'WC' },
        { kind: 'baignoire', x: ox + 55, y: oy + h - 60, w: 40, h: 55, label: 'Baignoire' },
    ];
    furn.forEach(f => elements.push({ id: Date.now() + Math.random(), type: 'furniture', ...f }));
    // labels
    elements.push({ id: Date.now() + Math.random(), type: 'text', label: 'Salon/Cuisine', x: ox + 120, y: oy + 15, fontSize: 11 });
    elements.push({ id: Date.now() + Math.random(), type: 'text', label: 'Chambre', x: ox + 15, y: oy + 15, fontSize: 11 });
    elements.push({ id: Date.now() + Math.random(), type: 'text', label: 'SDB', x: ox + 10, y: oy + h - 60, fontSize: 10 });
    draw();
}
drawDemo();