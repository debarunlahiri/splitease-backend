import type { Request } from 'express';
import { db, Db } from '../database';
import * as expenses from '../services/expense.service';
import { currentUser, pageRequest, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { nudgeUnpaid } from '../services/expense-reminder.service';
import * as claims from '../services/payment-claim.service';
import { CreateExpense, CreatePaymentClaim, NudgeUnpaid, RecordSharePayment, UpdateExpense } from '../validators/expense.validator';

export const create = (req: Request, conn: Db) =>
    expenses.createExpense(conn, currentUser(req).id, parseBody(CreateExpense, req.body));

export const byGroup = (req: Request) =>
    expenses.expensesByGroup(db, currentUser(req).id, uuidParam(req, 'groupId'), pageRequest(req));

export const update = (req: Request, conn: Db) =>
    expenses.updateExpense(
        conn,
        currentUser(req).id,
        uuidParam(req, 'expenseId'),
        parseBody(UpdateExpense, req.body),
    );

export const remove = (req: Request, conn: Db) =>
    expenses.deleteExpense(conn, currentUser(req).id, uuidParam(req, 'expenseId'));

export const history = (req: Request) =>
    expenses.expenseHistory(db, currentUser(req).id, uuidParam(req, 'expenseId'), pageRequest(req));

export const recordPayment = (req: Request, conn: Db) =>
    expenses.recordSharePayment(
        conn,
        currentUser(req).id,
        uuidParam(req, 'expenseId'),
        parseBody(RecordSharePayment, req.body),
    );

export const nudge = (req: Request, conn: Db) => {
    const input = parseBody(NudgeUnpaid, req.body);
    return nudgeUnpaid(conn, currentUser(req).id, uuidParam(req, 'expenseId'), {
        userIds: input.userIds,
        channels: input.channels,
        message: input.message,
    });
};

export const createClaim = (req: Request, conn: Db) =>
    claims.createClaim(conn, currentUser(req).id, uuidParam(req, 'expenseId'), parseBody(CreatePaymentClaim, req.body));

export const pendingClaims = (req: Request) =>
    claims.pendingClaims(db, currentUser(req).id, uuidParam(req, 'groupId'));

export const confirmClaim = (req: Request, conn: Db) =>
    claims.resolveClaim(conn, currentUser(req).id, uuidParam(req, 'claimId'), true);

export const rejectClaim = (req: Request, conn: Db) =>
    claims.resolveClaim(conn, currentUser(req).id, uuidParam(req, 'claimId'), false);
