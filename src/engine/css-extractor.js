/**
 * CSSExtractor — Parses document.styleSheets to extract @keyframes,
 * @font-face, CSS custom properties, animations, and transitions.
 */

export class CSSExtractor {
  constructor() {
    this.keyframes = [];
    this.fontFaces = [];
    this.customProperties = [];
    this.animationRules = [];
    this.transitionRules = [];
    this.mediaQueries = [];
    this.allRules = [];
  }

  /**
   * Extract all CSS rules from the page's stylesheets, including Shadow DOM content.
   */
  async extract(page) {
    const extracted = await page.evaluate(() => {
      const keyframes = [];
      const fontFaces = [];
      const customProperties = new Map();
      const animationRules = [];
      const transitionRules = [];
      const mediaQueries = [];
      const allCSSText = [];

      function processRules(rules, sheetHref) {
        if (!rules) return;
        for (const rule of rules) {
          try {
            // @keyframes
            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              keyframes.push({ name: rule.name, cssText: rule.cssText, source: sheetHref });
            }
            // @font-face
            else if (rule.type === CSSRule.FONT_FACE_RULE) {
              fontFaces.push({ cssText: rule.cssText, source: sheetHref });
            }
            // @media
            else if (rule.type === CSSRule.MEDIA_RULE) {
              mediaQueries.push({ conditionText: rule.conditionText || rule.media?.mediaText || '', cssText: rule.cssText, source: sheetHref });
              processRules(rule.cssRules, sheetHref);
            }
            // @supports, @layer, or nested rules
            else if (rule.type === CSSRule.SUPPORTS_RULE || rule.type === 7 /* LAYER_BLOCK */ || rule.type === 12 /* LAYER_STATEMENT */) {
              if (rule.cssText) allCSSText.push(rule.cssText);
              if (rule.cssRules) processRules(rule.cssRules, sheetHref);
            }
            // Standard style rules
            else if (rule.type === CSSRule.STYLE_RULE) {
              const style = rule.style;
              for (let i = 0; i < style.length; i++) {
                const prop = style[i];
                if (prop.startsWith('--')) {
                  customProperties.set(prop, style.getPropertyValue(prop));
                }
              }
            }
          } catch (e) {}
        }
      }

      function scanSheets(root) {
        if (!root) return;
        const sheets = root.styleSheets || [];
        for (const sheet of sheets) {
          try { processRules(sheet.cssRules, sheet.href || 'inline'); } catch (e) {}
        }
        // Recursive Shadow DOM scan (V7 Extreme Fidelity)
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode();
        while (node) {
          if (node.shadowRoot) {
            scanSheets(node.shadowRoot);
          }
          node = walker.nextNode();
        }
      }

      // Initial Pass: Global Sheets
      scanSheets(document);

      // V7 Holographic Pass: Capture all active Computed CSS Variables from root
      const rootComputed = window.getComputedStyle(document.documentElement);
      // Modern browsers allow iteration over computed style properties (including custom ones in Chrome/Safari)
      for (let i = 0; i < rootComputed.length; i++) {
        const prop = rootComputed[i];
        if (prop.startsWith('--')) {
          customProperties.set(prop, rootComputed.getPropertyValue(prop));
        }
      }

      return { keyframes, fontFaces, customProperties: Object.fromEntries(customProperties), animationRules, transitionRules, mediaQueries };
    });

    this.keyframes = extracted.keyframes;
    this.fontFaces = extracted.fontFaces;
    this.customProperties = extracted.customProperties;
    this.animationRules = extracted.animationRules;
    this.transitionRules = extracted.transitionRules;
    this.mediaQueries = extracted.mediaQueries;

    return extracted;
  }

  /**
   * Generate a standalone CSS file with all extracted animations.
   */
  generateAnimationsCSS() {
    let css = '/* ===== EXTRACTED ANIMATIONS & KEYFRAMES ===== */\n\n';

    // Custom properties
    if (Object.keys(this.customProperties).length > 0) {
      css += ':root {\n';
      for (const [prop, value] of Object.entries(this.customProperties)) {
        css += `  ${prop}: ${value};\n`;
      }
      css += '}\n\n';
    }

    // @font-face rules
    for (const ff of this.fontFaces) {
      css += ff.cssText + '\n\n';
    }

    // @keyframes rules
    for (const kf of this.keyframes) {
      css += kf.cssText + '\n\n';
    }

    return css;
  }

  /**
   * Manually parse CSS text for keyframes and font-faces.
   * Useful for cross-origin stylesheets where rules are inaccessible via DOM.
   */
  manualParse(assetMap) {
    const keyframesRegex = /@(?:-webkit-)?keyframes\s+([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/gi;
    const fontFaceRegex = /@font-face\s*\{((?:[^{}]|\{[^{}]*\})*)\}/gi;

    for (const [url, asset] of assetMap) {
      if (asset.category === 'css' && asset.content) {
        // Find keyframes
        let match;
        // Reset regex state for each file
        keyframesRegex.lastIndex = 0;
        while ((match = keyframesRegex.exec(asset.content)) !== null) {
          const name = match[1].trim();
          const cssText = match[0];
          
          // Avoid duplicates
          if (!this.keyframes.some(k => k.name === name)) {
            this.keyframes.push({ name, cssText, source: url });
          }
        }

        // Find font-faces
        let ffMatch;
        fontFaceRegex.lastIndex = 0;
        while ((ffMatch = fontFaceRegex.exec(asset.content)) !== null) {
          const cssText = ffMatch[0];
          if (!this.fontFaces.some(f => f.cssText === cssText)) {
            this.fontFaces.push({ cssText, source: url });
          }
        }
      }
    }
  }

  /**
   * Get extraction summary stats.
   */
  getStats() {
    return {
      keyframes: this.keyframes.length,
      fontFaces: this.fontFaces.length,
      customProperties: Object.keys(this.customProperties).length,
      animationRules: this.animationRules.length,
      transitionRules: this.transitionRules.length,
      mediaQueries: this.mediaQueries.length,
    };
  }
}

