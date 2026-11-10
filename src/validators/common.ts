import Decimal from 'decimal.js';
import { z } from 'zod';
import { validationFailed } from '../utils/errors';

/** Validates a request body; failures become a 400 VALIDATION_FAILED with per-field messages. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
    const result = schema.safeParse(body ?? {});
    if (result.success) return result.data;
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
        const field =
            issue.path
                .map((part, index) =>
                    typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`,
                )
                .join('') || 'body';
        if (!(field in fieldErrors)) fieldErrors[field] = issue.message;
    }
    throw validationFailed(fieldErrors);
}

const REQUIRED = { required_error: 'must not be null', invalid_type_error: 'must be a string' };

export const notBlank = (max: number = Number.MAX_SAFE_INTEGER) =>
    z
        .string(REQUIRED)
        .refine((value) => value.trim().length > 0, 'must not be blank')
        .refine((value) => value.length <= max, `size must be between 0 and ${max}`);

export const optionalText = (max: number) =>
    z
        .string({ invalid_type_error: 'must be a string' })
        .max(max, `size must be between 0 and ${max}`)
        .nullish()
        .transform((value) => value ?? null);

export const email = z
    .string(REQUIRED)
    .refine((value) => value.trim().length > 0, 'must not be blank')
    .refine(
        (value) => value.length <= 320 && z.string().email().safeParse(value.trim()).success,
        'must be a well-formed email address',
    );

export const uuid = z
    .string({ required_error: 'must not be null', invalid_type_error: 'must be a valid UUID' })
    .uuid('must be a valid UUID')
    .transform((value) => value.toLowerCase());

export const currency = z
    .string({ required_error: 'must not be null', invalid_type_error: 'must match "[A-Za-z]{3}"' })
    .regex(/^[A-Za-z]{3}$/, 'must match "[A-Za-z]{3}"')
    .transform((value) => value.toUpperCase());

/** A JSON number (or numeric string) read as an exact decimal. */
export const decimal = z
    .union(
        [
            z.number().finite(),
            z.string().regex(/^-?\d{1,17}(\.\d{1,10})?$/),
        ],
        { errorMap: () => ({ message: 'must be a number' }) },
    )
    .transform((value) => new Decimal(value));

export const isoDate = z
    .string({ required_error: 'must not be null', invalid_type_error: 'must be a date' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
    .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'must be a valid calendar date');
