import { z } from 'zod';
import { currency, email, notBlank, optionalText, uuid } from './common';

export const CreateGroup = z.object({ name: notBlank(120), defaultCurrency: currency });

export const Invite = z.object({ email });
export const InviteFriends = z.object({ friendIds: z.array(uuid).min(1).max(20) });

export const JoinLink = z.object({
    token: notBlank().refine(
        (value) => /^[A-Za-z0-9_-]{43}$/.test(value),
        'must match "[A-Za-z0-9_-]{43}"',
    ),
});

/** A person from the phone's contacts, added to the group before they have an account. */
export const AddContactMember = z
    .object({ name: notBlank(100), email: email.nullish(), phone: optionalText(40) })
    .refine((value) => Boolean(value.email) || Boolean(value.phone), {
        message: 'needs an email or a phone number',
        path: ['email'],
    });
