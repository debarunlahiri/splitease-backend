import { z } from 'zod';
import { currency, decimal, optionalText, uuid } from './common';

export const CreateSettlement = z.object({
    groupId: uuid,
    payeeId: uuid,
    amount: decimal
        .refine((value) => value.gte('0.01'), 'must be greater than or equal to 0.01')
        .refine((value) => value.decimalPlaces() <= 2, 'must have at most 2 decimal places')
        .refine((value) => value.lt('1e15'), 'is too large'),
    currency,
    note: optionalText(160),
});
