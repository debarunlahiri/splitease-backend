import type { Request } from 'express';
import { db, Db } from '../database';
import * as expenses from '../services/expense.service';
import { currentUser, pageRequest, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { CreateExpense, UpdateExpense } from '../validators/expense.validator';

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
