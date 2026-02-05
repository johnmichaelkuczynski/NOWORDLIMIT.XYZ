import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

export const CREDITS_PER_PURCHASE = 1000;

export const CREDIT_COSTS_PER_WORD: Record<string, number> = {
  'deepseek': 1000 / 500000,
  'openai': 1000 / 150000,
  'grok': 1000 / 100000,
  'anthropic': 1000 / 75000,
  'perplexity': 1000 / 75000,
};

export function calculateCreditsForWords(provider: string, wordCount: number): number {
  const costPerWord = CREDIT_COSTS_PER_WORD[provider.toLowerCase()] || CREDIT_COSTS_PER_WORD['openai'];
  return Math.ceil(wordCount * costPerWord);
}

export async function createCheckoutSession(userId: number, userEmail: string | null) {
  const priceId = process.env.STRIPE_PRICE_ID_100_TEXTSURGEON;
  
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID_100_TEXTSURGEON not configured');
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${getBaseUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getBaseUrl()}/payment/cancel`,
    customer_email: userEmail || undefined,
    metadata: {
      userId: userId.toString(),
      credits: CREDITS_PER_PURCHASE.toString(),
    },
  });

  return session;
}

export async function handleWebhookEvent(payload: Buffer, signature: string) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  
  return event;
}

function getBaseUrl(): string {
  return process.env.BASE_URL || 'https://textsurgeon.com';
}

export { stripe };
