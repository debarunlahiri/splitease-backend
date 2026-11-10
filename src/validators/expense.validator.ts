import { z } from 'zod';
import { currency, decimal, isoDate, notBlank, optionalText, uuid } from './common';

const Share = z.object({
    userId: uuid,
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
    splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE'], {
        errorMap: () => ({ message: 'must be EQUAL, EXACT or PERCENTAGE' }),
    }),
    shares: z
        .array(Share, { required_error: 'must not be empty', invalid_type_error: 'must be a list' })
        .min(1, 'must not be empty'),
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
