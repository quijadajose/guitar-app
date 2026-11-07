/**
 * Monta las plantillas compartidas de index.html.
 *
 * Los nodos `<div data-mount="tpl-x" data-…>` se reemplazan por el contenido de
 * `<template id="tpl-x">`. Cada `data-nombre` del nodo se usa como token `{{nombre}}`
 * dentro de la plantilla (ej. `data-variant="notes"` cambia `{{variant}}`).
 * Como las plantillas pueden anidar otras, el montaje repite hasta que no quedan nodos.
 *
 * Se importa primero en main.ts para que el DOM esté completo antes de que se
 * inicialicen los módulos de pantalla.
 */

const MAX_PASSES = 8;

function expand(html: string, attrs: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => attrs[key] ?? '');
}

function mountOnce(): number {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-mount]'));
  for (const node of nodes) {
    const id = node.dataset.mount ?? '';
    const tpl = document.getElementById(id);
    if (!(tpl instanceof HTMLTemplateElement)) {
      console.error(`[templates] falta <template id="${id}">`);
      node.remove();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.dataset)) {
      if (key !== 'mount' && value !== undefined) attrs[key] = value;
    }
    const holder = document.createElement('template');
    holder.innerHTML = expand(tpl.innerHTML, attrs);
    node.replaceWith(holder.content);
  }
  return nodes.length;
}

export function mountTemplates(): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (mountOnce() === 0) return;
  }
  console.error('[templates] plantillas anidadas demasiado profundas');
}

mountTemplates();
