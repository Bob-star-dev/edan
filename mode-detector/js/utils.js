/**
 * Utility Functions
 * Helper functions for the application
 */

/**
 * Round number to specified decimal places
 * @param {number} value - Value to round
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {number} Rounded value
 */
function round(value, decimals = 0) {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Clamp value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resize canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} targetWidth - Target width
 * @param {number} targetHeight - Target height
 * @param {boolean} inPlace - Whether to resize in place or create new canvas
 * @returns {CanvasRenderingContext2D} Resized context
 */
function resizeCanvasCtx(ctx, targetWidth, targetHeight, inPlace = false) {
  let canvas;

  if (inPlace) {
    canvas = ctx.canvas;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.scale(
      targetWidth / canvas.clientWidth,
      targetHeight / canvas.clientHeight
    );
  } else {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const newCtx = canvas.getContext('2d');
    newCtx.drawImage(ctx.canvas, 0, 0, targetWidth, targetHeight);
    return newCtx;
  }

  return ctx;
}

/**
 * Confidence to color mapping
 * Green (high confidence) to Red (low confidence)
 * @param {number} conf - Confidence value (0-1)
 * @returns {string} RGB color string
 */
function conf2color(conf) {
  const r = Math.round(255 * (1 - conf));
  const g = Math.round(255 * conf);
  return `rgb(${r},${g},0)`;
}

