import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function buildPrisma(stockOk: boolean) {
  const tx: any = {
    shop: { findUnique: jest.fn().mockResolvedValue({ id: 'shop1' }) },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'p1',
        name: 'Phone',
        sellingPrice: 100,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: stockOk ? 1 : 0 }),
    },
    stockHistory: { create: jest.fn() },
    order: {
      create: jest.fn(({ data }: any) =>
        Promise.resolve({ id: 'o1', ...data }),
      ),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn((fn: (t: unknown) => unknown) =>
        Promise.resolve(fn(tx)),
      ),
    } as any,
  };
}

describe('OrdersService.createOrder', () => {
  const baseDto: any = {
    shopId: 'shop1',
    items: [{ productId: 'p1', quantity: 2, price: 1 }],
    subtotal: 1,
    total: 1,
    discount: 9999,
    deliveryCharge: 10,
    deliveryAddress: { line1: 'x' },
  };

  it('ignores client-supplied prices and recomputes totals server-side', async () => {
    const { prisma, tx } = buildPrisma(true);
    const service = new OrdersService(prisma);

    const order: any = await service.createOrder('cust1', baseDto);

    expect(order.subtotal).toBe(200); // 2 x 100 from DB, not the client's "1"
    expect(order.discount).toBe(200); // clamped to subtotal
    expect(order.total).toBe(10); // 200 + 10 delivery - 200 discount
    expect(order.items[0].price).toBe(100);
    expect(tx.stockHistory.create).toHaveBeenCalled();
  });

  it('rejects the order when stock is insufficient (atomic decrement fails)', async () => {
    const { prisma, tx } = buildPrisma(false);
    const service = new OrdersService(prisma);

    await expect(service.createOrder('cust1', baseDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects zero/negative/fractional quantities', async () => {
    const { prisma } = buildPrisma(true);
    const service = new OrdersService(prisma);
    for (const quantity of [0, -3, 1.5]) {
      await expect(
        service.createOrder('cust1', {
          ...baseDto,
          items: [{ productId: 'p1', quantity }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
