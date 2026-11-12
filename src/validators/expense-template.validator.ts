import { z } from 'zod';
import { currency, decimal, notBlank, optionalText, uuid } from './common';

export const CreateExpenseTemplate = z.object({
    groupId: uuid,
    name: notBlank(80),
    description: notBlank(160),
    amount: decimal.refine((value) => value.gte('0.01'), 'must be greater than or equal to 0.01').nullish(),
    currency,
    splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES']),
    shares: z
        .array(z.object({ userId: uuid, value: decimal.nullish() }))
        .min(1, 'must not be empty'),
    category: optionalText(80),
    notes: optionalText(2000),
    remindAfterDays: z.union([z.literal(2), z.literal(3), z.literal(7)]).nullish(),
});
