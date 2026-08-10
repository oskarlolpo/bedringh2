/**
 * Chibi Skin Renderer Helper for Minecraft Launcher (Vue 3 / TypeScript / Rust)
 * 
 * Renders a Chibi Minecraft character sitting at 3/4 Left angle with auto Steve/Alex detection.
 */

import { ChibiSkinMaker } from './minecraft-chibi-skin-maker.js';

export class ChibiLauncherRenderer {
  /**
   * @param {HTMLCanvasElement} canvasElement - Target canvas element to render the chibi avatar onto
   * @param {Object} [options] - Configuration options
   */
  constructor(canvasElement, options = {}) {
    if (!canvasElement) {
      throw new Error('[ChibiLauncherRenderer] Target canvas element is required.');
    }

    this.canvas = canvasElement;
    const targetPose = (options.pose === 'sit') ? 'sitting' : (options.pose || 'sitting');
    this.options = {
      pose: targetPose,           // Default: Sitting pose ('sitting')
      facing: options.facing || '34-left',   // Default: 3/4 Left view
      bgTransparent: options.bgTransparent !== false,
      bgColor: options.bgColor || '#4a4a4a',
      shading: options.shading !== false,
      ...options,
    };

    // Instantiate headless ChibiSkinMaker core
    this.maker = new ChibiSkinMaker({ headless: true });
    this.maker.viewCanvas = this.canvas;
    this.maker.ctx = this.canvas.getContext('2d');
    
    this.maker.facing = this.options.facing;
    this.maker.pose = this.options.pose;
    this.maker.bgShape = 'none';
    this.maker.bgTransparent = true;
    this.maker.outlineWidth = 0;
    this.maker.outlineEnabled = false;

    this.currentModel = 'steve';
    this.isSlim = false;
  }

  /**
   * Loads skin image (from URL, Data URI base64, Blob/File, or Image element).
   * Automatically detects Alex (slim 3px arms) vs Steve (classic 4px arms) and renders to canvas.
   * @param {string|HTMLImageElement|Blob|File} skinInput 
   * @returns {Promise<{ model: string, isSlim: boolean, width: number, height: number }>}
   */
  async loadSkin(skinInput) {
    let img;
    if (skinInput instanceof HTMLImageElement) {
      img = skinInput;
    } else if (typeof skinInput === 'string') {
      img = await this._loadImageFromUrl(skinInput);
    } else if (skinInput instanceof Blob || skinInput instanceof File) {
      const url = URL.createObjectURL(skinInput);
      img = await this._loadImageFromUrl(url);
      URL.revokeObjectURL(url);
    } else {
      throw new Error('[ChibiLauncherRenderer] Unsupported skin input format.');
    }

    // Auto-detect Alex (slim 3px arms) vs Steve (classic 4px arms)
    this.isSlim = this.maker._detectSlim(img);
    this.currentModel = this.isSlim ? 'alex' : 'steve';
    
    this.maker.currentModelType = this.currentModel;
    this.maker.currentSkinImage = img;
    
    // Ensure transparent background and no outline
    this.maker.facing = this.options.facing;
    this.maker.pose = (this.options.pose === 'sit') ? 'sitting' : (this.options.pose || 'sitting');
    this.maker.bgShape = 'none';
    this.maker.bgTransparent = true;
    this.maker.outlineWidth = 0;
    this.maker.outlineEnabled = false;

    // Refresh skin sprite and paint to target canvas
    this.maker._refreshSkinTexture();
    this.maker._draw();

    return {
      model: this.currentModel,
      isSlim: this.isSlim,
      width: img.width || img.naturalWidth,
      height: img.height || img.naturalHeight,
    };
  }

  /**
   * Set custom pose (e.g. 'sitting', 'waving', 'zombie', 'crouch')
   * @param {string} pose 
   */
  setPose(pose) {
    this.maker.pose = (pose === 'sit') ? 'sitting' : pose;
    this.maker._refreshSkinTexture();
    this.maker._draw();
  }

  /**
   * Set custom view angle (e.g. '34-left', '34-right', 'front', 'back')
   * @param {string} facing 
   */
  setFacing(facing) {
    this.maker.facing = facing;
    this.maker._refreshSkinTexture();
    this.maker._draw();
  }

  /**
   * Trigger Minecraft hurt animation on click
   * @param {number} [clientX] 
   * @param {number} [clientY] 
   */
  triggerHurt(clientX, clientY) {
    if (this.maker.triggerHurt) {
      this.maker.triggerHurt(clientX, clientY);
    }
  }

  _loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }
}

/**
 * Convenient single-call function for rendering a chibi skin onto a canvas
 */
export async function renderLauncherChibi(canvas, skinSource, options = {}) {
  const renderer = new ChibiLauncherRenderer(canvas, options);
  const info = await renderer.loadSkin(skinSource);
  return { renderer, ...info };
}
