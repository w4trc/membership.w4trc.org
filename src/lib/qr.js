/**
 * QR codes as inline SVG, made on the server so printed pages need no scripts.
 */

import qrcode from 'qrcode-generator';

// One SVG path over a grid of modules, with a quiet zone of `margin` modules.
// The SVG scales to whatever size the page gives it.
export function qrSvg(text, { margin = 2, level = 'M' } = {}) {
  const qr = qrcode(0, level); // 0: smallest version that fits
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
