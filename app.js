if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentScale = 1.0;
let currentTool = 'off'; // Default: Pen OFF (Scroll/Read Mode)
let activeDrawCanvas = null;
let activeDrawCtx = null;
let isDrawing = false;
let startX = 0, startY = 0;

const renderContainer = document.getElementById('pdf-render-container');
const leftToolbar = document.getElementById('left-toolbar');
const bottomDock = document.getElementById('bottom-dock');
const eyeBtn = document.getElementById('eye-toggle-btn');
const flyoutMenu = document.getElementById('flyout-menu');

// Manual Eye Button Hide/Show Toggle (No Auto-Hide Timer)
eyeBtn.addEventListener('click', () => {
  const isHidden = leftToolbar.classList.toggle('hidden-ui');
  bottomDock.classList.toggle('hidden-ui');
  flyoutMenu.classList.remove('open');
  
  const icon = eyeBtn.querySelector('i');
  if (isHidden) {
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    icon.className = 'fa-solid fa-eye';
  }
});

// PDF File Selection & Continuous Page Render Setup
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

// Render All Pages Vertically for Continuous Scrolling
function renderAllPages() {
  renderContainer.innerHTML = '';
  document.getElementById('zoom-text').textContent = `${Math.round(currentScale * 100)}%`;

  if (!pdfDoc) return;

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

      pageWrapper.appendChild(pCanvas);
      pageWrapper.appendChild(dCanvas);
      renderContainer.appendChild(pageWrapper);

      page.render({ canvasContext: pCtx, viewport: viewport });

      // Add Pointer/Touch Listeners for Drawings
      attachDrawingListeners(dCanvas);
    });
  }
}

// Tool Active Toggles (Pen OFF by Default)
function setActiveBtn(btn) {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

document.getElementById('btn-pen').addEventListener('click', () => {
  if (currentTool === 'pen') {
    currentTool = 'off';
    setActiveBtn(null);
  } else {
    currentTool = 'pen';
    setActiveBtn(document.getElementById('btn-pen'));
  }
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  if (currentTool === 'eraser') {
    currentTool = 'off';
    setActiveBtn(null);
  } else {
    currentTool = 'eraser';
    setActiveBtn(document.getElementById('btn-eraser'));
  }
});

// Flyout Tool Selector
document.getElementById('btn-tools-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  flyoutMenu.classList.toggle('open');
});
document.addEventListener('click', () => flyoutMenu.classList.remove('open'));

document.querySelectorAll('.flyout-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.getAttribute('data-action');
    currentTool = action;
    setActiveBtn(document.getElementById('btn-tools-menu'));
  });
});

// Clear All Drawings across All Pages
document.getElementById('btn-clear').addEventListener('click', () => {
  document.querySelectorAll('.draw-canvas-layer').forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });
});

// Zoom Controls (Continuous Scale Update)
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

// Attach Touch & Mouse Drawing Actions per Page Layer
function attachDrawingListeners(canvas) {
  const ctx = canvas.getContext('2d');

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e) {
    if (currentTool === 'off') return; // Do nothing if Pen is OFF (Scroll Mode)
    
    isDrawing = true;
    activeDrawCanvas = canvas;
    activeDrawCtx = ctx;

    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
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
    }
  }

  function stopDraw() {
    isDrawing = false;
    activeDrawCanvas = null;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: true });
  canvas.addEventListener('touchmove', draw, { passive: true });
  canvas.addEventListener('touchend', stopDraw);
}
