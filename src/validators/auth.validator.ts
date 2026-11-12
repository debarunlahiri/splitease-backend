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
