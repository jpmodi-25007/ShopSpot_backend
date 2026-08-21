import { Injectable, Logger } from '@nestjs/common';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, Message, MulticastMessage } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseMessagingProvider {
  private readonly logger = new Logger(FirebaseMessagingProvider.name);
  private isInitialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        initializeApp({
          credential: cert(serviceAccountPath),
        });
        this.isInitialized = true;
        this.logger.log('Firebase Admin SDK initialized successfully.');
      } else {
        this.logger.warn('service-account.json not found. Firebase Admin SDK will not initialize. Push notifications will fail silently.');
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${error.message}`);
    }
  }

  async sendToDevice(token: string, title: string, body: string, data?: Record<string, string>) {
    if (!this.isInitialized) {
      this.logger.warn('Cannot send push notification. Firebase is not initialized.');
      return false;
    }

    try {
      const payload: Message = {
        token,
        notification: {
          title,
          body,
        },
        data: data || {},
      };

      const response = await getMessaging().send(payload);
      this.logger.log(`Successfully sent message to ${token}: ${response}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending message to ${token}: ${error.message}`);
      return false;
    }
  }

  async sendToMultipleDevices(tokens: string[], title: string, body: string, data?: Record<string, string>) {
    if (!this.isInitialized || tokens.length === 0) {
      return false;
    }

    try {
      const payload: MulticastMessage = {
        tokens,
        notification: {
          title,
          body,
        },
        data: data || {},
      };

      const response = await getMessaging().sendEachForMulticast(payload);
      this.logger.log(`Successfully sent multicast message. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending multicast message: ${error.message}`);
      return false;
    }
  }
}
