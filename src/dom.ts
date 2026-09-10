/** Clone inert <template> nodes and fill text slots. Do not interpolate into innerHTML. */

export function cloneTemplate(id: string): DocumentFragment {
  const tpl = document.getElementById(id);
  if (!(tpl instanceof HTMLTemplateElement)) {
    throw new Error(`Plantilla HTML no encontrada: #${id}`);
  }
  return tpl.content.cloneNode(true) as DocumentFragment;
}

export function firstElement<T extends Element = HTMLElement>(root: ParentNode): T | null {
  return root.querySelector('*') as T | null;
}

export function slot(root: ParentNode, name: string): Element | null {
  return root.querySelector(`[data-slot="${name}"]`);
}

export function setSlotText(root: ParentNode, name: string, value: string | number | null | undefined): void {
  const el = slot(root, name);
  if (el) el.textContent = value == null ? '' : String(value);
}

export function clearChildren(el: Element | null): void {
  el?.replaceChildren();
}

export function fillSvgFromTemplate(el: Element | null, templateId: string): void {
  if (!el) return;
  const frag = cloneTemplate(templateId);
  const sourceSvg = frag.querySelector('svg');
  const nodes = sourceSvg ? Array.from(sourceSvg.childNodes) : Array.from(frag.childNodes);
  el.replaceChildren(...nodes);
}

export function fillFromTemplate(el: Element | null, templateId: string): void {
  if (!el) return;
  el.replaceChildren(cloneTemplate(templateId));
}
