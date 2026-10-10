import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../index.html', import.meta.url), new URL('../dist/index.html', import.meta.url));
// The legacy cache matches known navigation URLs ignoring query parameters.
// A new path loads the modern shell so its consent-based update UI can activate.
await copyFile(new URL('../dist/frontend/index.html', import.meta.url), new URL('../dist/frontend/update.html', import.meta.url));
