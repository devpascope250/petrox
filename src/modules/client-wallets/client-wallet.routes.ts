import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { ClientWalletRepository } from "./client-wallet.repository.js";
import {
  clientWalletParamsSchema,
  transferWalletToCardSchema,
  walletCardTransferSchema,
  buyWalletCouponsSchema,
  createClientWalletSchema,
  createWalletMovementSchema,
  walletMovementQuerySchema
} from "./client-wallet.schema.js";
import { ClientWalletService } from "./client-wallet.service.js";
import { parseWalletMovementMultipart } from "./client-wallet-upload.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ClientWalletService(new ClientWalletRepository(app.prisma));

  app.post(
    "/:id/transfer-to-card",
    { preHandler: [app.authenticate, app.authorize("client.wallets.edit")] },
    async (request, reply) => created(reply, await service.transferToCard(
      parseInput(clientWalletParamsSchema, request.params).id,
      parseInput(transferWalletToCardSchema, request.body),
      request.contextUser!
    ))
  );

  app.get(
    "/:id/main-cards",
    { preHandler: [app.authenticate, app.authorize("client.wallets.read")] },
    async (request) => success(await service.mainCards(
      parseInput(clientWalletParamsSchema, request.params).id,
      request.contextUser!
    ))
  );

  app.post(
    "/:id/card-transfer",
    { preHandler: [app.authenticate, app.authorize("client.wallets.edit")] },
    async (request, reply) => created(reply, await service.cardTransfer(
      parseInput(clientWalletParamsSchema, request.params).id,
      parseInput(walletCardTransferSchema, request.body),
      request.contextUser!
    ))
  );

  app.post(
    "/:id/buy-coupons",
    { preHandler: [app.authenticate, app.authorize("client.wallets.edit")] },
    async (request, reply) => created(reply, await service.buyCoupons(
      parseInput(clientWalletParamsSchema, request.params).id,
      parseInput(buyWalletCouponsSchema, request.body),
      request.contextUser!
    ))
  );

  app.get(
    "/",
    { preHandler: [app.authenticate, app.authorize("client.wallets.read")] },
    async (request) => success(await service.list(
      parseInput(paginationQuerySchema, request.query),
      request.contextUser!
    ))
  );

  app.get(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("client.wallets.read")] },
    async (request) => success(await service.find(
      parseInput(clientWalletParamsSchema, request.params).id,
      request.contextUser!
    ))
  );

  app.post(
    "/",
    { preHandler: [app.authenticate, app.authorize("client.wallets.create")] },
    async (request, reply) => created(reply, await service.create(
      parseInput(createClientWalletSchema, request.body),
      request.contextUser!
    ))
  );


  app.patch(
    "/:id/status",
    { preHandler: [app.authenticate, app.authorize("client.wallets.edit")] },
    async (request) => success(await service.changeStatus(
      parseInput(clientWalletParamsSchema, request.params).id,
      request.contextUser!
    ))
  );

  app.get(
    "/:id/movements",
    { preHandler: [app.authenticate, app.authorize("client.wallets.read")] },
    async (request) => success(await service.listMovements(
      parseInput(clientWalletParamsSchema, request.params).id,
      parseInput(walletMovementQuerySchema, request.query),
      request.contextUser!
    ))
  );

  app.post(
    "/:id/movements",
    { preHandler: [app.authenticate, app.authorize("client.wallets.edit")] },
    async (request, reply) => {
      const body = request.isMultipart()
        ? await parseWalletMovementMultipart(request)
        : request.body;
      return created(reply, await service.createMovement(
        parseInput(clientWalletParamsSchema, request.params).id,
        parseInput(createWalletMovementSchema, body),
        request.contextUser!
      ));
    }
  );
};

export default routes;
