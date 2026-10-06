// Shared palette helper — turns a single base colour into the 5-stop gradient
// used by the home-widget character and the AI cursor. Loaded as a plain
// <script> so it works in sandboxed renderers.

(function (global) {
  'use strict';

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToHex({ h, s, l }) {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function derivePalette(hex) {
    const rgb = hexToRgb(hex) || { r: 74, g: 142, b: 224 };
    const hsl = rgbToHsl(rgb);
    return {
      light:  hslToHex({ h: hsl.h, s: Math.min(100, hsl.s + 5), l: Math.min(88, hsl.l + 22) }),
      main:   hex,
      mid:    hslToHex({ h: hsl.h, s: Math.min(100, hsl.s + 2), l: Math.max(16, hsl.l - 10) }),
      dark:   hslToHex({ h: hsl.h, s: Math.min(100, hsl.s + 4), l: Math.max(12, hsl.l - 22) }),
      deep:   hslToHex({ h: hsl.h, s: Math.min(100, hsl.s + 4), l: Math.max(6,  hsl.l - 35) })
    };
  }

  function bodyGradient(hex) {
    const p = derivePalette(hex);
    return `
      radial-gradient(circle at 32% 28%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 32%),
      linear-gradient(160deg, ${p.light} 0%, ${p.main} 30%, ${p.mid} 60%, ${p.dark} 90%, ${p.deep} 100%)
    `;
  }

  global.MagnaPalette = { hexToRgb, rgbToHsl, hslToHex, derivePalette, bodyGradient };
})(window);
