import { BadRequestException } from '@nestjs/common';
import { NegotiationStatus } from '@prisma/client';
import { NegotiationsService } from './negotiations.service';

describe('NegotiationsService.acceptDeal', () => {
  const make = (negotiation: any, updateCount = 1) => {
    const prisma: any = {
      negotiation: {
        findUnique: jest.fn().mockResolvedValue(negotiation),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...negotiation, status: 'ACCEPTED' }),
      },
    };
    return { prisma, service: new NegotiationsService(prisma, {} as any) };
  };

  it('does not let a customer accept their own PENDING offer', async () => {
    const { service, prisma } = make({
      id: 'n1',
      customerId: 'c1',
      status: NegotiationStatus.PENDING,
      offeredPrice: 10,
      counterPrice: null,
    });
    await expect(service.acceptDeal('n1', 'c1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.negotiation.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a COUNTERED offer at the shop counter price', async () => {
    const { service, prisma } = make({
      id: 'n1',
      customerId: 'c1',
      status: NegotiationStatus.COUNTERED,
      offeredPrice: 10,
      counterPrice: 15,
    });
    await service.acceptDeal('n1', 'c1');
    expect(prisma.negotiation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ finalPrice: 15 }),
      }),
    );
  });
});
