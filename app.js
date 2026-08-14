if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentScale = 1.0;
let currentTool = 'pen'; 
let currentShape = 'none';
let isDrawing = false;
let startX = 0, startY = 0;
let snapshot = null;

let pagesData = [null];
let currentPageIndex = 0; 
let isPdfMode = false;
let renderTask = null;

// Multi-touch / Pinch Zoom Variables
let initialPinchDistance = null;
let initialScale = 1.0;

let historyStack = [];
let historyStep = -1;
const MAX_HISTORY = 30;

const pdfCanvas = document.getElementById('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const drawCanvas = document.getElementById('draw-canvas');
const drawCtx = drawCanvas.getContext('2d');
const container = document.getElementById('canvas-container');
const laserDot = document.getElementById('laser-dot');

const leftToolbar = document.getElementById('left-toolbar');
const bottomDock = document.getElementById('bottom-dock');

function hideToolbars() {
  leftToolbar.classList.add('autohide');
  bottomDock.classList.add('autohide');
  flyoutMenu.classList.remove('open');
}

function showToolbars() {
  leftToolbar.classList.remove('autohide');
  bottomDock.classList.remove('autohide');
}

function saveHistoryState() {
  historyStep++;
  if (historyStep < historyStack.length) {
    historyStack = historyStack.slice(0, historyStep);
  }
  historyStack.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
    historyStep--;
  }
}

document.getElementById('btn-undo').addEventListener('click', () => {
  if (historyStep > 0) {
    historyStep--;
    drawCtx.putImageData(historyStack[historyStep], 0, 0);
  } else if (historyStep === 0) {
    historyStep = -1;
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
});

document.getElementById('btn-redo').addEventListener('click', () => {
  if (historyStep < historyStack.length - 1) {
    historyStep++;
    drawCtx.putImageData(historyStack[historyStep], 0, 0);
  }
});

const flyoutMenu = document.getElementById('flyout-menu');
document.getElementById('btn-tools-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  flyoutMenu.classList.toggle('open');
});
document.addEventListener('click', () => flyoutMenu.classList.remove('open'));

document.querySelectorAll('.flyout-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.getAttribute('data-action');
    if (['line', 'arrow', 'rect', 'circle'].includes(action)) {
      currentTool = 'shape';
      currentShape = action;
      setActiveBtn(document.getElementById('btn-tools-menu'));
    } else if (action === 'pointer') {
      currentTool = 'pointer';
      setActiveBtn(document.getElementById('btn-tools-menu'));
    } else if (action === 'calculator') {
      document.getElementById('calc-tool').style.display = 'block';
    } else if (action === 'text') {
      currentTool = 'text';
      setActiveBtn(document.getElementById('btn-tools-menu'));
    } else if (action.startsWith('bg-')) {
      const bgMode = action.replace('bg-', '');
      container.className = `bg-${bgMode}`;
      isPdfMode = false;
      renderPage();
    } else if (action === 'clear') {
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      pagesData[currentPageIndex] = null;
      document.querySelectorAll('.sticky-note, .mind-node').forEach(n => n.remove());
      saveHistoryState();
    }
  });
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
  document.getElementById('calc-tool').style.display = 'none';
});

function setActiveBtn(btn) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.getElementById('btn-pen').addEventListener('click', () => {
  currentTool = 'pen';
  currentShape = 'none';
  laserDot.style.display = 'none';
  setActiveBtn(document.getElementById('btn-pen'));
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  currentTool = 'eraser';
  laserDot.style.display = 'none';
  setActiveBtn(document.getElementById('btn-eraser'));
});

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const typedarray = new Uint8Array(this.result);
      pdfjsLib.getDocument(typedarray).promise.then(doc => {
        pdfDoc = doc;
        isPdfMode = true;
        currentPageIndex = 0;
        currentScale = 1.0;
        renderPage();
      });
    };
    fileReader.readAsArrayBuffer(file);
  }
});

function renderPage() {
  saveCurrentDrawing();
  const totalPages = isPdfMode && pdfDoc ? pdfDoc.numPages : pagesData.length;
  document.getElementById('page-num').textContent = `${currentPageIndex + 1}/${totalPages}`;
  document.getElementById('zoom-text').textContent = `${Math.round(currentScale * 100)}%`;

  if (isPdfMode && pdfDoc) {
    if (renderTask) {
      renderTask.cancel();
    }

    pdfDoc.getPage(currentPageIndex + 1).then(page => {
      const viewport = page.getViewport({ scale: currentScale });

      pdfCanvas.height = viewport.height;
      pdfCanvas.width = viewport.width;
      drawCanvas.height = viewport.height;
      drawCanvas.width = viewport.width;

      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;

      pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      const renderContext = { canvasContext: pdfCtx, viewport: viewport };
      renderTask = page.render(renderContext);

      renderTask.promise.then(() => {
        renderTask = null;
        restoreDrawing();
      }).catch(err => {
        if (err.name !== 'RenderingCancelledException') {
          console.error(err);
        }
      });
    });
  } else {
    const width = window.innerWidth * currentScale;
    const height = window.innerHeight * currentScale;

    pdfCanvas.width = width;
    pdfCanvas.height = height;
    drawCanvas.width = width;
    drawCanvas.height = height;

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;

    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    restoreDrawing();
  }
}

function saveCurrentDrawing() {
  pagesData[currentPageIndex] = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
}

function restoreDrawing() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (pagesData[currentPageIndex]) {
    drawCtx.putImageData(pagesData[currentPageIndex], 0, 0);
  }
}

document.getElementById('add-page').addEventListener('click', () => {
  saveCurrentDrawing();
  pagesData.push(null);
  currentPageIndex = pagesData.length - 1;
  isPdfMode = false;
  renderPage();
});

document.getElementById('prev').addEventListener('click', () => { if (currentPageIndex > 0) { currentPageIndex--; renderPage(); } });
document.getElementById('next').addEventListener('click', () => {
  const total = isPdfMode && pdfDoc ? pdfDoc.numPages : pagesData.length;
  if (currentPageIndex < total - 1) { currentPageIndex++; renderPage(); }
});

document.getElementById('zoom-in').addEventListener('click', () => { 
  currentScale += 0.2; 
  renderPage(); 
});

document.getElementById('zoom-out').addEventListener('click', () => { 
  if (currentScale > 0.4) { 
    currentScale -= 0.2; 
    renderPage(); 
  } 
});

function getPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// Distance Helper for Pinch Gesture
function getDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function handleTouchStart(e) {
  if (e.touches.length === 2) {
    // 2 Fingers detected -> Enable Pinch-to-Zoom Mode
    isDrawing = false;
    initialPinchDistance = getDistance(e.touches);
    initialScale = currentScale;
  } else if (e.touches.length === 1) {
    // 1 Finger -> Drawing Mode
    startDraw(e);
  }
}

function handleTouchMove(e) {
  if (e.touches.length === 2 && initialPinchDistance) {
    // Zoom Calculation based on Pinch
    const currentDistance = getDistance(e.touches);
    const newScale = initialScale * (currentDistance / initialPinchDistance);
    
    if (newScale >= 0.4 && newScale <= 3.0) {
      currentScale = newScale;
      renderPage();
    }
  } else if (e.touches.length === 1) {
    draw(e);
  }
}

function handleTouchEnd(e) {
  if (e.touches.length < 2) {
    initialPinchDistance = null;
  }
  stopDraw();
}

function startDraw(e) {
  hideToolbars();
  const pos = getPos(e);
  startX = pos.x;
  startY = pos.y;

  if (currentTool === 'pointer') {
    laserDot.style.display = 'block';
    laserDot.style.left = `${startX - 6}px`;
    laserDot.style.top = `${startY - 6}px`;
    return;
  }

  isDrawing = true;
  drawCtx.beginPath();
  drawCtx.moveTo(startX, startY);
  snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
}

function draw(e) {
  if (!isDrawing) return;
  const pos = getPos(e);

  if (currentTool === 'pointer') {
    laserDot.style.display = 'block';
    laserDot.style.left = `${pos.x - 6}px`;
    laserDot.style.top = `${pos.y - 6}px`;
    return;
  }

  const color = document.getElementById('pen-color').value;

  if (currentTool === 'pen') {
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = 3;
    drawCtx.lineCap = 'round';
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
  } else if (currentTool === 'eraser') {
    drawCtx.clearRect(pos.x - 15, pos.y - 15, 30, 30);
  }
}

function stopDraw() { 
  if (isDrawing) {
    isDrawing = false;
    saveHistoryState(); 
  }
  setTimeout(showToolbars, 1200);
}

// Mouse Listeners
drawCanvas.addEventListener('mousedown', startDraw);
drawCanvas.addEventListener('mousemove', draw);
drawCanvas.addEventListener('mouseup', stopDraw);

// Touch Listeners (Supporting Pinch-to-Zoom)
drawCanvas.addEventListener('touchstart', handleTouchStart, { passive: true });
drawCanvas.addEventListener('touchmove', handleTouchMove, { passive: true });
drawCanvas.addEventListener('touchend', handleTouchEnd);

window.addEventListener('resize', renderPage);
renderPage();
