import { z } from 'zod';
import { optionalText } from './common';

const flag = z.boolean({ invalid_type_error: 'must be true or false' }).nullish();

export const UpdatePreferences = z
    .object({ inboxEnabled: flag, pushEnabled: flag, pushToken: optionalText(500) })
    .transform((value) => ({
        inboxEnabled: value.inboxEnabled ?? false,
        pushEnabled: value.pushEnabled ?? false,
        pushToken: value.pushToken,
    }));
