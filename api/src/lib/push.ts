import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo({ useFcmV1: true });

export async function sendPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;

  const message: ExpoPushMessage = { to: pushToken, title, body, data, sound: 'default' };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch {
    // Non-critical — don't let push failures break the request
  }
}
