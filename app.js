if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentScale = 1.0;
let currentTool = 'off'; 
let currentShape = 'none';
let currentBg = 'white';
let activeDrawCanvas = null;
let activeDrawCtx = null;
let isDrawing = false;
let startX = 0, startY = 0;
let snapshot = null;

const historyStore = new WeakMap();

const renderContainer = document.getElementById('pdf-render-container');
const leftToolbar = document.getElementById('left-toolbar');
const bottomDock = document.getElementById('bottom-dock');
const eyeBtn = document.getElementById('eye-toggle-btn');
const flyoutMenu = document.getElementById('flyout-menu');
const bgMenu = document.getElementById('bg-menu');
const calcPopup = document.getElementById('calc-tool');

// Hide / Show Eye Toggle
eyeBtn.addEventListener('click', () => {
  const isHidden = leftToolbar.classList.toggle('hidden-ui');
  bottomDock.classList.toggle('hidden-ui');
  flyoutMenu.classList.remove('open');
  bgMenu.classList.remove('open');
  
  const icon = eyeBtn.querySelector('i');
  icon.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
});

// Open PDF
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const typedarray = new Uint8Array(this.result);
      pdfjsLib.getDocument(typedarray).promise.then(doc => {
        pdfDoc = doc;
        renderAllPages();
      });
    };
    fileReader.readAsArrayBuffer(file);
  }
});

// Add Blank Whiteboard Page
document.getElementById('btn-add-board').addEventListener('click', () => {
  createBlankWhiteboardPage();
});

function createBlankWhiteboardPage() {
  const width = window.innerWidth * 0.9 * currentScale;
  const height = window.innerHeight * 0.8 * currentScale;

  const pageWrapper = document.createElement('div');
  pageWrapper.className = `page-wrapper bg-${currentBg}`;
  pageWrapper.style.width = `${width}px`;
  pageWrapper.style.height = `${height}px`;

  const dCanvas = document.createElement('canvas');
  dCanvas.className = 'draw-canvas-layer';
  dCanvas.width = width;
  dCanvas.height = height;

  historyStore.set(dCanvas, { stack: [], step: -1 });

  pageWrapper.appendChild(dCanvas);
  renderContainer.appendChild(pageWrapper);

  attachDrawingListeners(dCanvas, pageWrapper);
  pageWrapper.scrollIntoView({ behavior: 'smooth' });
}

function renderAllPages() {
  renderContainer.innerHTML = '';
  document.getElementById('zoom-text').textContent = `${Math.round(currentScale * 100)}%`;

  if (!pdfDoc) {
    createBlankWhiteboardPage();
    return;
  }

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    pdfDoc.getPage(pageNum).then(page => {
      const viewport = page.getViewport({ scale: currentScale });

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'page-wrapper';
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;

      const pCanvas = document.createElement('canvas');
      pCanvas.className = 'pdf-canvas-layer';
      pCanvas.width = viewport.width;
      pCanvas.height = viewport.height;
      const pCtx = pCanvas.getContext('2d');

      const dCanvas = document.createElement('canvas');
      dCanvas.className = 'draw-canvas-layer';
      dCanvas.width = viewport.width;
      dCanvas.height = viewport.height;

      historyStore.set(dCanvas, { stack: [], step: -1 });

      pageWrapper.appendChild(pCanvas);
      pageWrapper.appendChild(dCanvas);
      renderContainer.appendChild(pageWrapper);

      page.render({ canvasContext: pCtx, viewport: viewport });
      attachDrawingListeners(dCanvas, pageWrapper);
    });
  }
}

// Background Selection Menu
document.getElementById('btn-bg-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  flyoutMenu.classList.remove('open');
  bgMenu.classList.toggle('open');
});

document.querySelectorAll('#bg-menu .flyout-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    currentBg = item.getAttribute('data-bg');
    
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
      if (!wrapper.querySelector('.pdf-canvas-layer')) {
        wrapper.className = `page-wrapper bg-${currentBg}`;
      }
    });

    bgMenu.classList.remove('open');
  });
});

// History Saver
function saveHistory(canvas) {
  const h = historyStore.get(canvas);
  if (!h) return;
  const ctx = canvas.getContext('2d');
  
  h.step++;
  if (h.step < h.stack.length) {
    h.stack = h.stack.slice(0, h.step);
  }
  h.stack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (h.stack.length > 25) {
    h.stack.shift();
    h.step--;
  }
}

// Undo
document.getElementById('btn-undo').addEventListener('click', () => {
  if (!activeDrawCanvas) {
    const canvases = document.querySelectorAll('.draw-canvas-layer');
    activeDrawCanvas = canvases[canvases.length - 1];
  }
  if (!activeDrawCanvas) return;

  const h = historyStore.get(activeDrawCanvas);
  if (!h) return;
  const ctx = activeDrawCanvas.getContext('2d');

  if (h.step > 0) {
    h.step--;
    ctx.putImageData(h.stack[h.step], 0, 0);
  } else if (h.step === 0) {
    h.step = -1;
    ctx.clearRect(0, 0, activeDrawCanvas.width, activeDrawCanvas.height);
  }
});

// Redo
document.getElementById('btn-redo').addEventListener('click', () => {
  if (!activeDrawCanvas) return;
  const h = historyStore.get(activeDrawCanvas);
  if (!h) return;
  const ctx = activeDrawCanvas.getContext('2d');

  if (h.step < h.stack.length - 1) {
    h.step++;
    ctx.putImageData(h.stack[h.step], 0, 0);
  }
});

// Tool Selection
function setActiveBtn(btn) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

document.getElementById('btn-pen').addEventListener('click', () => {
  if (currentTool === 'pen') { currentTool = 'off'; setActiveBtn(null); }
  else { currentTool = 'pen'; currentShape = 'none'; setActiveBtn(document.getElementById('btn-pen')); }
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  if (currentTool === 'eraser') { currentTool = 'off'; setActiveBtn(null); }
  else { currentTool = 'eraser'; currentShape = 'none'; setActiveBtn(document.getElementById('btn-eraser')); }
});

document.getElementById('btn-text').addEventListener('click', () => {
  if (currentTool === 'text') { currentTool = 'off'; setActiveBtn(null); }
  else { currentTool = 'text'; currentShape = 'none'; setActiveBtn(document.getElementById('btn-text')); }
});

document.getElementById('btn-calc').addEventListener('click', () => {
  if (calcPopup.style.display === 'block') {
    calcPopup.style.display = 'none';
    document.getElementById('btn-calc').classList.remove('active');
  } else {
    calcPopup.style.display = 'block';
    document.getElementById('btn-calc').classList.add('active');
  }
});

function calcInput(val) {
  const display = document.getElementById('calc-display');
  if (val === 'C') display.value = '0';
  else if (display.value === '0') display.value = val;
  else display.value += val;
}
function calcSolve() {
  const display = document.getElementById('calc-display');
  try { display.value = eval(display.value); } catch { display.value = 'Error'; }
}
document.getElementById('close-calc').addEventListener('click', () => {
  calcPopup.style.display = 'none';
  document.getElementById('btn-calc').classList.remove('active');
});

// Shapes Selection
document.getElementById('btn-tools-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  bgMenu.classList.remove('open');
  flyoutMenu.classList.toggle('open');
});

document.addEventListener('click', () => {
  flyoutMenu.classList.remove('open');
  bgMenu.classList.remove('open');
});

document.querySelectorAll('#flyout-menu .flyout-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    currentShape = item.getAttribute('data-action');
    currentTool = 'shape';
    setActiveBtn(document.getElementById('btn-tools-menu'));
    flyoutMenu.classList.remove('open');
  });
});

// Clear All
document.getElementById('btn-clear').addEventListener('click', () => {
  document.querySelectorAll('.draw-canvas-layer').forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    historyStore.set(c, { stack: [], step: -1 });
  });
});

// Zoom Logic
document.getElementById('zoom-in').addEventListener('click', () => {
  currentScale += 0.15;
  renderAllPages();
});

document.getElementById('zoom-out').addEventListener('click', () => {
  if (currentScale > 0.5) {
    currentScale -= 0.15;
    renderAllPages();
  }
});

// Create On-screen Text Input
function createInlineText(wrapper, ctx, x, y) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-text-input';
  input.style.left = `${x}px`;
  input.style.top = `${y}px`;
  input.style.color = document.getElementById('pen-color').value;
  input.style.fontSize = `${18 * currentScale}px`;

  wrapper.appendChild(input);
  setTimeout(() => input.focus(), 50);

  function finalizeText() {
    if (input.value.trim() !== '') {
      ctx.font = `${18 * currentScale}px Arial`;
      ctx.fillStyle = document.getElementById('pen-color').value;
      ctx.fillText(input.value, x, y + (16 * currentScale));
      saveHistory(ctx.canvas);
    }
    input.remove();
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finalizeText(); });
  input.addEventListener('blur', finalizeText);
}

// Drawing & Shapes Handler
function attachDrawingListeners(canvas, wrapper) {
  const ctx = canvas.getContext('2d');

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e) {
    if (currentTool === 'off') return;
    
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;

    if (currentTool === 'text') {
      createInlineText(wrapper, ctx, startX, startY);
      return;
    }

    isDrawing = true;
    activeDrawCanvas = canvas;
    activeDrawCtx = ctx;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function draw(e) {
    if (!isDrawing || currentTool === 'off' || activeDrawCanvas !== canvas) return;
    const pos = getPos(e);
    const color = document.getElementById('pen-color').value;

    if (currentTool === 'pen') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (currentTool === 'eraser') {
      ctx.clearRect(pos.x - 15, pos.y - 15, 30, 30);
    } else if (currentTool === 'shape') {
      ctx.putImageData(snapshot, 0, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();

      const w = pos.x - startX;
      const h = pos.y - startY;

      if (currentShape === 'rect') ctx.strokeRect(startX, startY, w, h);
      else if (currentShape === 'circle') {
        let radius = Math.sqrt(w * w + h * h);
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (currentShape === 'line') {
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (currentShape === 'arrow') {
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        let angle = Math.atan2(h, w);
        ctx.lineTo(pos.x - 10 * Math.cos(angle - Math.PI / 6), pos.y - 10 * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - 10 * Math.cos(angle + Math.PI / 6), pos.y - 10 * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }
    }
  }

  function stopDraw() {
    if (isDrawing) {
      isDrawing = false;
      saveHistory(canvas);
    }
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: true });
  canvas.addEventListener('touchmove', draw, { passive: true });
  canvas.addEventListener('touchend', stopDraw);
}

// Initial Run
renderAllPages();