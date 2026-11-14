import { type CountryCode, getCountries, parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { checkUpiId } from '../utils/upi';
import { email, notBlank } from './common';

export const Register = z.object({
    email,
    displayName: notBlank().refine(
        (value) => value.length >= 2 && value.length <= 100,
        'size must be between 2 and 100',
    ),
    password: notBlank().refine(
        (value) => value.length >= 8 && value.length <= 72,
        'size must be between 8 and 72',
    ),
});

export const Login = z.object({ email, password: notBlank() });
export const RefreshToken = z.object({ refreshToken: notBlank() });
export const VerifyEmail = z.object({ token: notBlank() });
export const ResendVerification = z.object({ email });
export const FirebaseLogin = z.object({ idToken: notBlank(16_000) });

export const UpdateDisplayName = z.object({
    displayName: z.string().trim().min(2).max(100).refine(
        (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value),
        'must be a single line without control characters',
    ),
});

/** A two-letter country code such as IN, or null to clear it. */
export const UpdateCountry = z.object({
    country: z
        .string()
        .nullable()
        .transform((value, ctx) => {
            if (value === null || value.trim() === '') return null;
            const code = value.trim().toUpperCase();
            if (!getCountries().includes(code as CountryCode)) {
                ctx.addIssue({ code: 'custom', message: 'must be a two-letter country code, like IN' });
                return z.NEVER;
            }
            return code;
        }),
});

/** The Firebase ID token from signing in with the SMS code. */
export const VerifyPhone = z.object({ idToken: z.string().trim().min(20).max(4096) });

/** A phone number with its country code, such as +919876543210. An empty value or null removes it. */
export const UpdatePhone = z.object({
    phone: z
        .string()
        .nullable()
        .transform((value, ctx) => {
            if (value === null || value.trim() === '') return null;
            // Must be a real number for its country (right length and prefix), written with the country code.
            const parsed = parsePhoneNumberFromString(value.trim());
            if (!value.trim().startsWith('+') || !parsed?.isValid()) {
                ctx.addIssue({ code: 'custom', message: 'must be a valid number with the country code, like +91 98765 43210' });
                return z.NEVER;
            }
            return parsed.number;
        }),
});

/** A UPI ID such as name@bank. An empty value or null removes it. */
export const UpdateUpiId = z.object({
    upiId: z
        .string()
        .nullable()
        .transform((value, ctx) => {
            if (value === null || value.trim() === '') return null;
            const check = checkUpiId(value);
            if (!check.valid) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.reason ?? 'is not a valid UPI ID' });
                return z.NEVER;
            }
            return check.upiId as string;
        }),
});
