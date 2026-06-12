import type { PlatformClient, WebhookPlatform } from '../webhooks/base.js';
import { bitbucketPlatformClient } from './bitbucket/index.js';

const platformClients = new Map<WebhookPlatform, PlatformClient>();

export function registerPlatformClient(platform: WebhookPlatform, client: PlatformClient): void {
  platformClients.set(platform, client);
}

export function getPlatformClient(platform: WebhookPlatform): PlatformClient | undefined {
  return platformClients.get(platform);
}

export function getAllPlatformClients(): Map<WebhookPlatform, PlatformClient> {
  return new Map(platformClients);
}

registerPlatformClient('bitbucket', bitbucketPlatformClient);
