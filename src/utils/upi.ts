/** Handles of the common UPI apps and banks. Others can be valid, so an unknown one is only a warning. */
const KNOWN_HANDLES = new Set([
    'ybl', 'ibl', 'axl', 'okaxis', 'oksbi', 'okhdfcbank', 'okicici', 'paytm', 'pthdfc', 'ptsbi', 'ptyes', 'upi', 'apl',
    'sbi', 'hdfcbank', 'icici', 'axisbank', 'axisb', 'kotak', 'yesbank', 'idfcfirst', 'idfcbank', 'indus', 'federal',
    'fbl', 'rbl', 'pnb', 'boi', 'cnrb', 'canarabank', 'unionbank', 'uboi', 'barodampay', 'aubank', 'jupiteraxis',
    'freecharge', 'mairtel', 'airtel', 'jio', 'postbank', 'ikwik', 'abfspay', 'waicici', 'wahdfcbank', 'wasbi',
    'waaxis', 'slc', 'fam', 'naviaxis', 'ezetap', 'cmsidfc', 'yapl', 'timecosmos', 'tapicici', 'niyoicici', 'ikwik',
]);

export interface UpiCheck {
    valid: boolean;
    /** Normalised (trimmed, lower-case) UPI ID when valid. */
    upiId?: string;
    /** Why it is not valid, in words for the person typing it. */
    reason?: string;
    /** Valid in shape, but the part after @ is not a handle we know: worth a double check. */
    unknownHandle?: boolean;
}

/** Checks the shape of a UPI ID (VPA): name@handle, as defined by NPCI. */
export function checkUpiId(input: string): UpiCheck {
    const value = input.trim().toLowerCase();
    if (value.length === 0) return { valid: false, reason: 'Enter your UPI ID, like name@bank.' };
    if (/\s/.test(value)) return { valid: false, reason: 'A UPI ID cannot contain spaces.' };
    const at = value.indexOf('@');
    if (at === -1) return { valid: false, reason: 'A UPI ID has an @, like name@bank.' };
    if (value.indexOf('@', at + 1) !== -1) return { valid: false, reason: 'A UPI ID has only one @.' };
    const local = value.slice(0, at);
    const handle = value.slice(at + 1);
    if (handle.includes('.')) return { valid: false, reason: 'That looks like an email address, not a UPI ID.' };
    if (local.length < 3) return { valid: false, reason: 'The part before @ needs at least 3 characters.' };
    if (local.length > 100) return { valid: false, reason: 'The part before @ is too long.' };
    if (!/^[a-z0-9._-]+$/.test(local)) {
        return { valid: false, reason: 'Before @ use only letters, numbers, dots, dashes and underscores.' };
    }
    if (!/^[a-z0-9]/.test(local) || /[._-]$/.test(local) || /[._-]{2,}/.test(local)) {
        return { valid: false, reason: 'The part before @ cannot start or end with a symbol or repeat symbols.' };
    }
    if (!/^[a-z][a-z0-9]{1,31}$/.test(handle)) {
        return { valid: false, reason: 'After @ enter your bank or app handle, like ybl, oksbi or paytm.' };
    }
    return { valid: true, upiId: value, unknownHandle: !KNOWN_HANDLES.has(handle) };
}
