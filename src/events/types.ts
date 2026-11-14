// Domain events written to the outbox. Amounts are two-decimal strings so no
// precision is lost in JSON.

export const Topics = {
    expenseCreated: 'expense.created',
    expenseChanged: 'expense.changed',
    settlementRecorded: 'settlement.recorded',
    invitationCreated: 'invitation.created',
    connectionAdded: 'connection.added',
} as const;

export interface EventShare {
    userId: string;
    amount: string;
}

export interface ExpenseSnapshot {
    paidBy: string;
    amount: string;
    currency: string;
    shares: EventShare[];
}

export interface ExpenseCreatedEvent {
    eventId: string;
    /** Who added the expense. Optional because events written before it existed lack it. */
    actorId?: string;
    expenseId: string;
    groupId: string;
    paidBy: string;
    amount: string;
    currency: string;
    shares: EventShare[];
    occurredAt: string;
}

export interface ExpenseChangedEvent {
    eventId: string;
    /** Who edited or deleted the expense. Optional for events written before it existed. */
    actorId?: string;
    expenseId: string;
    groupId: string;
    revision: number;
    previous: ExpenseSnapshot | null;
    /** null when the expense was deleted. */
    current: ExpenseSnapshot | null;
    occurredAt: string;
    /** Another message explains this change (for example a person was removed), so skip the generic one. */
    quiet?: boolean;
}

export interface SettlementRecordedEvent {
    eventId: string;
    settlementId: string;
    groupId: string;
    payerId: string;
    payeeId: string;
    amount: string;
    currency: string;
    occurredAt: string;
}

export interface InvitationCreatedEvent {
    eventId: string;
    invitationId: string;
    groupId: string;
    groupName: string;
    inviteeEmail: string;
    invitedBy: string;
    expiresAt: string;
    occurredAt: string;
}

export interface ConnectionAddedEvent {
    eventId: string;
    actorName: string;
    recipientId: string;
    groupId: string | null;
    groupName: string | null;
}

export function connectionAddedMessage(event: ConnectionAddedEvent): string {
    return event.groupName === null
        ? `${event.actorName} added you as a friend on SplitEase.`
        : `${event.actorName} added you to ${event.groupName} on SplitEase.`;
}
