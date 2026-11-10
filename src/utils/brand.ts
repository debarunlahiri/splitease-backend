import { join } from 'node:path';

const filename = 'splitease-logo.png';

export const brandLogoUrl = `/${filename}`;
export const brandLogoPath = join(__dirname, '../../public', filename);
