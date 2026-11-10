import type { Request } from 'express';
import { db, Db } from '../database';
import * as settlements from '../services/settlement.service';
import { currentUser, pageRequest, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { CreateSettlement } from '../validators/settlement.validator';

export const record = (req: Request, conn: Db) =>
    settlements.recordSettlement(conn, currentUser(req).id, parseBody(CreateSettlement, req.body));

export const byGroup = (req: Request) =>
    settlements.settlementsByGroup(
        db,
        currentUser(req).id,
        uuidParam(req, 'groupId'),
        pageRequest(req),
    );

export const balances = (req: Request) =>
    settlements.balances(db, currentUser(req).id, uuidParam(req, 'groupId'), req.query.currency);

export const suggestions = (req: Request) =>
    settlements.suggestions(db, currentUser(req).id, uuidParam(req, 'groupId'), req.query.currency);
