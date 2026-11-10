import { z } from 'zod';
import { notBlank } from './common';

export const VerifyPurchase = z.object({
    provider: z.enum(['GOOGLE_PLAY', 'APPLE_APP_STORE'], {
        errorMap: () => ({ message: 'must be GOOGLE_PLAY or APPLE_APP_STORE' }),
    }),
    planCode: notBlank(),
    purchaseToken: notBlank(),
});

export const GooglePush = z.object({
    subscription: notBlank(),
    message: z.object(
        { messageId: notBlank(), data: notBlank() },
        { required_error: 'must not be null', invalid_type_error: 'must be an object' },
    ),
});

export const AppleNotification = z.object({ signedPayload: notBlank() });
