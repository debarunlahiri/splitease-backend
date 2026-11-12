import { z } from 'zod';
import { currency, decimal, isoDate, notBlank, optionalText, uuid } from './common';

const Share = z.object({
    userId: uuid,
    /** This person's own due date (optional). */
    payByDate: isoDate.nullish(),
    value: decimal
        .refine((value) => value.gte(0), 'must be greater than or equal to 0.00')
        .nullish(),
});

const Receipt = z.object({
    name: notBlank(255),
    contentType: notBlank(120),
    storageKey: notBlank(500),
});

const expenseFields = {
    paidBy: uuid,
    description: notBlank(160),
    amount: decimal
        .refine((value) => value.gte('0.01'), 'must be greater than or equal to 0.01')
        .refine((value) => value.decimalPlaces() <= 2, 'must have at most 2 decimal places')
        .refine((value) => value.lt('1e15'), 'is too large'),
    currency,
    expenseDate: isoDate,
    splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES'], {
        errorMap: () => ({ message: 'must be EQUAL, EXACT, PERCENTAGE or SHARES' }),
    }),
    shares: z
        .array(Share, { required_error: 'must not be empty', invalid_type_error: 'must be a list' })
        .min(1, 'must not be empty'),
    remindAfterDays: z.union([z.literal(2), z.literal(3), z.literal(7)], {
        errorMap: () => ({ message: 'must be 2, 3 or 7' }),
    }).nullish(),
    payByDate: isoDate.nullish(),
    category: optionalText(80),
    notes: optionalText(2000),
    receipt: Receipt.nullish(),
    attachmentIds: z.array(uuid).max(5).refine(
        (ids) => new Set(ids).size === ids.length,
        'attachments must be unique',
    ).optional(),
};

export const CreateExpense = z.object({ groupId: uuid, ...expenseFields });
export const UpdateExpense = z.object(expenseFields);

/** Omit `amount` to mark the person's whole remaining share as paid. */
export const RecordSharePayment = z.object({
    userId: uuid,
    amount: decimal.refine((value) => value.gt(0), 'must be greater than 0').nullish(),
});

export const NudgeUnpaid = z.object({
    userIds: z.array(uuid).max(50).nullish(),
    channels: z.array(z.enum(['PUSH', 'EMAIL'])).min(1, 'choose at least one').max(2),
    message: optionalText(500),
});

/** "I've paid": omit `amount` for the whole remaining share. */
export const CreatePaymentClaim = z.object({
    amount: decimal.refine((value) => value.gt(0), 'must be greater than 0').nullish(),
});
