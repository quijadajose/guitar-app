/**
 * Safe DOM helpers: clone inert <template> nodes and fill text slots.
 * Never interpolate untrusted strings into innerHTML.
 */
(function (global) {
  function cloneTemplate(id) {
    const tpl = document.getElementById(id);
    if (!tpl || !tpl.content) {
      throw new Error(`Plantilla HTML no encontrada: #${id}`);
    }
    return tpl.content.cloneNode(true);
  }

  function firstElement(fragment) {
    return fragment.querySelector('*');
  }

  function slot(root, name) {
    return root.querySelector(`[data-slot="${name}"]`);
  }

  function setSlotText(root, name, value) {
    const el = slot(root, name);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function clearChildren(el) {
    if (el) el.replaceChildren();
  }

  global.GuitarDOM = {
    cloneTemplate,
    firstElement,
    slot,
    setSlotText,
    clearChildren
  };
})(window);
