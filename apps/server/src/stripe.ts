import Stripe from 'stripe';
import { config } from './config.js';

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe && config.STRIPE_SECRET_KEY) {
    stripe = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });
  }
  if (!stripe) throw new Error('Stripe is not configured');
  return stripe;
}

export async function createCustomDonation(amount: number, email: string): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Custom Donation',
            description: 'Support Discord Server Leaver development',
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      },
    ],
    success_url: `${config.APP_ORIGIN}/donation/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.APP_ORIGIN}/donation/cancel`,
  });

  return session.url!;
}

export async function createApiKeyPurchase(
  userId: string,
  email: string,
  credits: number,
  priceUsd: number
): Promise<string> {
  const stripe = getStripe();

  const discountPercent = config.PROMO_DISCOUNT_PERCENT;
  const discountedPrice = priceUsd * (1 - discountPercent / 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    client_reference_id: userId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${credits} AI Credits`,
            description: `${discountPercent}% OFF Promo - Access AI with your Discord history`,
          },
          unit_amount: Math.round(discountedPrice * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId,
      credits: credits.toString(),
      type: 'api_key_purchase',
    },
    success_url: `${config.APP_ORIGIN}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.APP_ORIGIN}/purchase/cancel`,
  });

  return session.url!;
}

export async function createSubscription(
  userId: string,
  email: string,
  priceId: string
): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      userId,
      type: 'subscription',
    },
    success_url: `${config.APP_ORIGIN}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.APP_ORIGIN}/subscription/cancel`,
  });

  return session.url!;
}

export async function handleWebhook(body: string, signature: string): Promise<void> {
  const stripe = getStripe();

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    config.STRIPE_WEBHOOK_SECRET
  );

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const { metadata, client_reference_id } = session;

  if (metadata?.type === 'api_key_purchase') {
    const userId = client_reference_id || metadata.userId;
    const credits = parseInt(metadata.credits || '0', 10);

    // This will be handled in the main index.ts to create the API key
    console.log(`API key purchase completed: ${userId}, ${credits} credits`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  // Handle subscription cancellation
  console.log(`Subscription deleted: ${subscription.id}`);
}
