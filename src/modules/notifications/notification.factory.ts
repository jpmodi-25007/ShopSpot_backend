import { NotificationType } from '@prisma/client';

export interface NotificationPayload {
  notificationType: NotificationType;
  entityType: string;
  entityId: string;
  actionType: string;
  route: string;
  [key: string]: any;
}

export class NotificationFactory {
  static productOffer(productId: string): NotificationPayload {
    return {
      notificationType: NotificationType.PRICE_DROP,
      entityType: 'PRODUCT',
      entityId: productId,
      actionType: 'OPEN_PRODUCT',
      route: `/product-detail/${productId}`,
    };
  }

  static negotiationMessage(negotiationId: string, shopkeeper: boolean): NotificationPayload {
    return {
      notificationType: NotificationType.NEGOTIATION_RECEIVED,
      entityType: 'NEGOTIATION',
      entityId: negotiationId,
      actionType: 'OPEN_NEGOTIATION',
      route: shopkeeper ? `/retailer/negotiations/${negotiationId}` : `/negotiation/${negotiationId}`,
    };
  }

  static reservationCreated(reservationId: string, productId: string): NotificationPayload {
    return {
      notificationType: NotificationType.RESERVATION_CREATED,
      entityType: 'RESERVATION',
      entityId: reservationId,
      actionType: 'OPEN_RESERVATION',
      route: '/reservations',
    };
  }

  static orderUpdated(orderId: string): NotificationPayload {
    return {
      notificationType: NotificationType.ORDER_STATUS_CHANGED,
      entityType: 'ORDER',
      entityId: orderId,
      actionType: 'OPEN_ORDER',
      route: '/my-orders',
    };
  }

  static influencerBidReceived(campaignId: string): NotificationPayload {
    return {
      notificationType: NotificationType.BID_RECEIVED,
      entityType: 'CAMPAIGN',
      entityId: campaignId,
      actionType: 'OPEN_BIDS',
      route: `/retailer/campaigns/${campaignId}/bids`,
    };
  }

  static campaignCreated(campaignId: string): NotificationPayload {
    return {
      notificationType: NotificationType.CAMPAIGN_PUBLISHED,
      entityType: 'CAMPAIGN',
      entityId: campaignId,
      actionType: 'OPEN_CAMPAIGN',
      route: `/influencer/campaign-details`,
    };
  }
}
