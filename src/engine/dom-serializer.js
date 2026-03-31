/**
 * DOMSerializer — Extracts the fully rendered DOM from a Puppeteer page,
 * including inline styles, shadow DOM, and meta information.
 */

export class DOMSerializer {
  constructor() {
    this.html = '';
    this.inlineStyles = [];
    this.metaInfo = {};
  }

  /**
   * Extract the full rendered HTML from the page, including Shadow DOM.
   */
  async extractHTML(page) {
    this.html = await page.evaluate(() => {
      const SELF_CLOSING = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

      function serializeNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parentTag = node.parentElement && node.parentElement.tagName ? node.parentElement.tagName.toLowerCase() : '';

          // Preserve inline JS/CSS contents during serialization so the cloned page can be more faithfully replayed.
          // We only escape the closing tag token to avoid prematurely ending the parent element in HTML.
          if (parentTag === 'script') {
            return (node.textContent || '').replace(/<\/script/gi, '<\\/script');
          }
          if (parentTag === 'style') {
            return (node.textContent || '').replace(/<\/style/gi, '<\\/style');
          }

          return node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        if (node.nodeType === Node.COMMENT_NODE) {
          return `<!--${node.textContent}-->`;
        }
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) {
          return '';
        }

        let html = '';
        
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          html += `<${tagName}`;

          // Add attributes
          for (const attr of node.attributes) {
            html += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
          }
          html += '>';

          // Handle Declarative Shadow DOM
          if (node.shadowRoot) {
            html += `<template shadowrootmode="${node.shadowRoot.mode || 'open'}">`;
            for (const child of node.shadowRoot.childNodes) {
              html += serializeNode(child);
            }
            html += `</template>`;
          }

          // Handle content
          if (!SELF_CLOSING.includes(tagName)) {
            for (const child of node.childNodes) {
              html += serializeNode(child);
            }
            html += `</${tagName}>`;
          }
        } else {
          // Document or DocumentFragment
          for (const child of node.childNodes) {
            html += serializeNode(child);
          }
        }

        return html;
      }

      // Start from the root html element to preserve attributes/lang
      const htmlEl = document.documentElement;
      let finalHtml = `<!DOCTYPE html>\n<html`;
      for (const attr of htmlEl.attributes) {
        finalHtml += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
      }
      finalHtml += '>\n';
      
      // Serialize heads and body manually to ensure all content is captured
      for (const child of htmlEl.childNodes) {
        finalHtml += serializeNode(child);
      }
      
      finalHtml += '\n</html>';
      return finalHtml;
    });

    return this.html;
  }


  /**
   * Extract all <style> tag contents.
   */
  async extractInlineStyles(page) {
    this.inlineStyles = await page.evaluate(() => {
      const styleTags = document.querySelectorAll('style');
      return Array.from(styleTags).map((style, index) => ({
        index,
        content: style.textContent,
        media: style.getAttribute('media') || '',
      }));
    });

    return this.inlineStyles;
  }

  /**
   * Extract page meta information.
   */
  async extractMeta(page) {
    this.metaInfo = await page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        return el ? el.getAttribute('content') : null;
      };

      return {
        title: document.title,
        description: getMeta('description'),
        ogTitle: getMeta('og:title'),
        ogImage: getMeta('og:image'),
        ogDescription: getMeta('og:description'),
        viewport: getMeta('viewport'),
        charset: document.characterSet,
        lang: document.documentElement.lang || 'en',
        favicon: (() => {
          const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
          return link ? link.href : null;
        })(),
      };
    });

    return this.metaInfo;
  }

  /**
   * Extract computed styles for key elements (fallback for critical elements).
   */
  /**
   * Extract computed styles for visually significant elements (V7 Extreme Fidelity).
   * Instead of a fixed list, it now uses a heuristic to identify the most "important" elements.
   */
  async extractComputedStyles(page) {
    const computedStyles = await page.evaluate(() => {
      const results = {};
      const importantProps = [
        'background-color', 'background-image', 'background-size', 'color', 
        'font-family', 'font-size', 'font-weight', 'line-height',
        'border', 'border-radius', 'box-shadow', 'text-shadow',
        'padding', 'margin', 'width', 'max-width', 'min-height',
        'display', 'position', 'top', 'left', 'right', 'bottom', 'z-index',
        'opacity', 'transform', 'transition', 'animation',
        'backdrop-filter', '-webkit-backdrop-filter', 'mask-image', 'clip-path'
      ];

      // Importance Heuristic: Find elements with specific "Premium" traits
      const allElements = Array.from(document.querySelectorAll('*'));
      const candidates = allElements.filter(el => {
        const style = window.getComputedStyle(el);
        // Elements with transforms, filters, absolute positioning, or custom animations
        return style.transform !== 'none' || 
               style.position === 'absolute' || 
               style.position === 'fixed' ||
               style.display === 'flex' ||
               style.display === 'grid' ||
               style.backdropFilter !== 'none' ||
               (style.animationName !== 'none' && style.animationName !== '');
      }).slice(0, 300); // Limit to top 300 to maintain performance

      for (const el of candidates) {
        const computed = window.getComputedStyle(el);
        const styles = {};
        for (const prop of importantProps) {
          const value = computed.getPropertyValue(prop);
          // Only capture non-default values to keep payload lean
          if (value && value !== 'none' && value !== 'normal' && value !== 'auto' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
            styles[prop] = value;
          }
        }
        
        // Use a unique selector-like key or data-attribute if possible
        const id = el.id || `v7-${Math.random().toString(36).substr(2, 9)}`;
        if (!el.id) el.setAttribute('data-v7-id', id);
        results[el.id ? `#${el.id}` : `[data-v7-id="${id}"]`] = styles;
      }
      return results;
    });

    return computedStyles;
  }

  /**
   * Fully serialize the page — HTML + inline styles + meta.
   */
  async serialize(page) {
    const [html, inlineStyles, metaInfo] = await Promise.all([
      this.extractHTML(page),
      this.extractInlineStyles(page),
      this.extractMeta(page),
    ]);

    return { html, inlineStyles, metaInfo };
  }
}
