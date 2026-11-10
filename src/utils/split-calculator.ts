import Decimal from 'decimal.js';
import { badRequest } from './errors';

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE';

export interface RequestedShare {
    userId: string;
    /** Ignored for EQUAL; the amount for EXACT; the percentage for PERCENTAGE. */
    value?: Decimal | null;
}

export interface Share {
    userId: string;
    amount: Decimal;
}

const ONE_HUNDRED = new Decimal(100);

/** Turns the requested split into one two-decimal amount per participant. */
export function calculateSplit(total: Decimal, type: SplitType, requested: RequestedShare[]): Share[] {
    if (new Set(requested.map((share) => share.userId)).size !== requested.length) {
        throw badRequest('A user can appear only once in an expense split');
    }
    switch (type) {
        case 'EQUAL':
            return equal(total, requested);
        case 'EXACT':
            return exact(total, requested);
        case 'PERCENTAGE':
            return percentage(total, requested);
    }
}

/** The rounding remainder goes to the first participant. */
function equal(total: Decimal, requested: RequestedShare[]): Share[] {
    const base = total.div(requested.length).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const remainder = total.minus(base.times(requested.length));
    return requested.map((share, index) => ({
        userId: share.userId,
        amount: index === 0 ? base.plus(remainder) : base,
    }));
}

function values(requested: RequestedShare[]): Decimal[] {
    return requested.map((share) => {
        if (share.value === undefined || share.value === null) {
            throw badRequest('Every share needs a value for exact and percentage splits');
        }
        return share.value;
    });
}

function exact(total: Decimal, requested: RequestedShare[]): Share[] {
    const amounts = values(requested);
    if (amounts.some((amount) => amount.decimalPlaces() > 2)) {
        throw badRequest('Exact shares can have at most 2 decimal places');
    }
    const sum = amounts.reduce((left, right) => left.plus(right), new Decimal(0));
    if (!sum.equals(total)) {
        throw badRequest('Exact shares must add up to the expense amount');
    }
    return requested.map((share, index) => ({ userId: share.userId, amount: amounts[index] }));
}

/** The final participant receives whatever rounding leaves over. */
function percentage(total: Decimal, requested: RequestedShare[]): Share[] {
    const percentages = values(requested);
    const sum = percentages.reduce((left, right) => left.plus(right), new Decimal(0));
    if (!sum.equals(ONE_HUNDRED)) {
        throw badRequest('Percentage shares must add up to 100');
    }
    let assigned = new Decimal(0);
    return requested.map((share, index) => {
        const amount =
            index === requested.length - 1
                ? total.minus(assigned)
                : total
                      .times(percentages[index])
                      .div(ONE_HUNDRED)
                      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        assigned = assigned.plus(amount);
        return { userId: share.userId, amount };
    });
}
