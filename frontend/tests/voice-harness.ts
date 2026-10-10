import * as backup from '../src/features/backup/backup-service.js';
import { captureDocument, loadDocument, listDocuments } from '../src/documents/document-store.js';
import { exportActDocx, renderPrintHtml } from '../src/documents/act-export.js';
import { openDatabase } from '../src/storage/database.js';
import { audits, createEditor } from '../src/features/audits/audit-service.js';
import { createZ2Audit } from '../src/domain/audit-model.js';
import { ZONE_TEMPLATES } from '../src/domain/templates/index.js';
import { Z2_TEMPLATE } from '../src/templates/z2-template.js';
import { voiceDrafts } from '../src/voice/voice-drafts.js';
import { VoiceController } from '../src/features/voice/voice-controller.js';
const voiceQA = { ...backup, ZONE_TEMPLATES, audits, createEditor, createZ2Audit, Z2_TEMPLATE, voiceDrafts, VoiceController, captureDocument, loadDocument, listDocuments, exportActDocx, renderPrintHtml, openDatabase };
declare global { interface Window { voiceQA: typeof voiceQA; } }
window.voiceQA = voiceQA;
