import Decimal from 'decimal.js';

/** NUMERIC(19, 2) column value (string) or Decimal as a JSON number. */
export function toJsonNumber(value: string | Decimal): number {
    return new Decimal(value).toNumber();
}

/** Two-decimal text for database parameters, event payloads and messages. */
export function toAmountText(value: string | Decimal): string {
    return new Decimal(value).toFixed(2);
}
