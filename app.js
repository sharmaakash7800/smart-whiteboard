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

// Undo & Redo History System
let historyStack = [];
let historyStep = -1;
const MAX_HISTORY = 30;

const pdfCanvas = document.getElementById('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const drawCanvas = document.getElementById('draw-canvas');
const drawCtx = drawCanvas.getContext('2d');
const container = document.getElementById('canvas-container');
const laserDot = document.getElementById('laser-dot');

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

// Undo (Back) Action
document.getElementById('btn-undo').addEventListener('click', () => {
  if (historyStep > 0) {
    historyStep--;
    drawCtx.putImageData(historyStack[historyStep], 0, 0);
  } else if (historyStep === 0) {
    historyStep = -1;
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
});

// Redo (Forward) Action
document.getElementById('btn-redo').addEventListener('click', () => {
  if (historyStep < historyStack.length - 1) {
    historyStep++;
    drawCtx.putImageData(historyStack[historyStep], 0, 0);
  }
});

// Keyboard Shortcuts (Ctrl + Z & Ctrl + Y)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    if (e.shiftKey) document.getElementById('btn-redo').click();
    else document.getElementById('btn-undo').click();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
    document.getElementById('btn-redo').click();
  }
});

// Flyout Menu
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
    } else if (action === 'student-signal') {
      alert("✋ Student Raised Hand / Signal Triggered!");
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

document.getElementById('btn-note').addEventListener('click', () => {
  const note = document.createElement('div');
  note.contentEditable = true;
  note.className = 'sticky-note';
  note.style.left = `${window.innerWidth / 2 - 80}px`;
  note.style.top = `${window.innerHeight / 2 - 80}px`;
  note.innerText = 'Type note...';
  makeDraggable(note);
  container.appendChild(note);
});

document.getElementById('btn-mindmap').addEventListener('click', () => {
  const node = document.createElement('div');
  node.contentEditable = true;
  node.className = 'mind-node';
  node.style.left = `${window.innerWidth / 2 - 60}px`;
  node.style.top = `${window.innerHeight / 2 - 20}px`;
  node.innerText = 'New Node';
  makeDraggable(node);
  container.appendChild(node);
});

function makeDraggable(elm) {
  let isDragging = false, offset = [0, 0];
  elm.addEventListener('mousedown', (e) => {
    isDragging = true;
    offset = [elm.offsetLeft - e.clientX, elm.offsetTop - e.clientY];
  });
  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      elm.style.left = (e.clientX + offset[0]) + 'px';
      elm.style.top = (e.clientY + offset[1]) + 'px';
    }
  });
  document.addEventListener('mouseup', () => isDragging = false);
}

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

  const width = window.innerWidth;
  const height = window.innerHeight;

  if (isPdfMode && pdfDoc) {
    pdfDoc.getPage(currentPageIndex + 1).then(page => {
      const viewport = page.getViewport({ scale: currentScale });
      pdfCanvas.height = viewport.height;
      pdfCanvas.width = viewport.width;
      drawCanvas.height = viewport.height;
      drawCanvas.width = viewport.width;

      pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      page.render({ canvasContext: pdfCtx, viewport });
      restoreDrawing();
    });
  } else {
    pdfCanvas.width = width * currentScale;
    pdfCanvas.height = height * currentScale;
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;
    
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

document.getElementById('zoom-in').addEventListener('click', () => { currentScale += 0.15; renderPage(); });
document.getElementById('zoom-out').addEventListener('click', () => { if(currentScale > 0.5) { currentScale -= 0.15; renderPage(); } });

function getPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDraw(e) {
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
  const pos = getPos(e);

  if (currentTool === 'pointer') {
    laserDot.style.display = 'block';
    laserDot.style.left = `${pos.x - 6}px`;
    laserDot.style.top = `${pos.y - 6}px`;
    return;
  }

  if (!isDrawing) return;
  const color = document.getElementById('pen-color').value;

  if (currentTool === 'pen') {
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = 3;
    drawCtx.lineCap = 'round';
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
  } else if (currentTool === 'eraser') {
    drawCtx.clearRect(pos.x - 15, pos.y - 15, 30, 30);
  } else if (currentTool === 'shape') {
    drawCtx.putImageData(snapshot, 0, 0);
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = 3;
    drawCtx.beginPath();

    const w = pos.x - startX;
    const h = pos.y - startY;

    if (currentShape === 'rect') drawCtx.strokeRect(startX, startY, w, h);
    else if (currentShape === 'circle') {
      let radius = Math.sqrt(w*w + h*h);
      drawCtx.arc(startX, startY, radius, 0, 2 * Math.PI);
      drawCtx.stroke();
    } else if (currentShape === 'line') {
      drawCtx.moveTo(startX, startY);
      drawCtx.lineTo(pos.x, pos.y);
      drawCtx.stroke();
    } else if (currentShape === 'arrow') {
      drawCtx.moveTo(startX, startY);
      drawCtx.lineTo(pos.x, pos.y);
      drawCtx.stroke();
      let angle = Math.atan2(h, w);
      drawCtx.lineTo(pos.x - 10 * Math.cos(angle - Math.PI / 6), pos.y - 10 * Math.sin(angle - Math.PI / 6));
      drawCtx.moveTo(pos.x, pos.y);
      drawCtx.lineTo(pos.x - 10 * Math.cos(angle + Math.PI / 6), pos.y - 10 * Math.sin(angle + Math.PI / 6));
      drawCtx.stroke();
    }
  }
}

function stopDraw() { 
  if (isDrawing) {
    isDrawing = false;
    saveHistoryState(); 
  }
}

drawCanvas.addEventListener('mousedown', startDraw);
drawCanvas.addEventListener('mousemove', draw);
drawCanvas.addEventListener('mouseup', stopDraw);

drawCanvas.addEventListener('touchstart', startDraw);
drawCanvas.addEventListener('touchmove', draw);
drawCanvas.addEventListener('touchend', stopDraw);

window.addEventListener('resize', renderPage);
renderPage();