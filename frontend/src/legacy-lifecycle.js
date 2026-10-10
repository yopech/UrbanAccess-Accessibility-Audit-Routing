let operations = 0;
export function beginLegacyOperation() { operations++; document.documentElement.dataset.legacyOperations = String(operations); }
export function endLegacyOperation() { operations = Math.max(0, operations - 1); document.documentElement.dataset.legacyOperations = String(operations); }
export function legacyFormSaved(form) { document.dispatchEvent(new CustomEvent('legacy:form-saved', { detail: form })); }
export function legacyFormChanged(form) { document.dispatchEvent(new CustomEvent('legacy:form-changed', { detail: form })); }
