import { processPhoto, detectImage, sha256 } from '../src/media/audit-media.js';
import { audits, createEditor } from '../src/features/audits/audit-service.js';
import { createZ2Audit } from '../src/domain/audit-model.js';
import { Z2_TEMPLATE } from '../src/templates/z2-template.js';
import { loadPhoto } from '../src/media/photo-storage.js';
const mediaQA = { processPhoto, detectImage, sha256, audits, createEditor, createZ2Audit, Z2_TEMPLATE, loadPhoto };
declare global { interface Window { mediaQA: typeof mediaQA; } }
window.mediaQA = mediaQA;
