import { Router } from 'express';
import * as settlements from '../controllers/settlement.controller';
import { idempotent } from '../middlewares/idempotency';
import { route } from '../utils/http';

export const settlementsRouter = Router();

settlementsRouter.post('/', idempotent(201, settlements.record));
settlementsRouter.get('/group/:groupId', route(200, settlements.byGroup));
settlementsRouter.get('/group/:groupId/balances', route(200, settlements.balances));
settlementsRouter.get('/group/:groupId/suggestions', route(200, settlements.suggestions));
